import { describe, expect, test } from 'bun:test';
import {
  planSampling,
  requiresExactResult,
  temporalUnitLabel,
  widenTemporalUnit,
} from '@/application/queries/adaptive-sampling.ts';
import { describeSampling, foldOtherBucket, isAdditiveAggregate } from '@/application/queries/sampling-disclosure.ts';
import { MAX_QUERY_LIMIT } from '@/data/compiler/compile-analysis-query.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

const columnId = (name: string) => `col_${name}` as EntityId;

const groupedQuery = (): AnalysisQuery => ({
  datasetId: 'ds_1' as EntityId,
  dimensions: [columnId('region')],
  measures: [{ columnId: columnId('revenue'), aggregate: 'sum', alias: 'revenue' }],
  filters: [],
});

const temporalQuery = (): AnalysisQuery => ({
  datasetId: 'ds_1' as EntityId,
  dimensions: [],
  binnedDimensions: [{ columnId: columnId('date'), strategy: { kind: 'temporal', unit: 'day' } }],
  measures: [{ columnId: columnId('revenue'), aggregate: 'sum', alias: 'revenue' }],
  filters: [],
});

describe('adaptive sampling policy', () => {
  test('leaves a result within the budget exact', () => {
    const plan = planSampling({ query: groupedQuery(), kind: 'bar', estimatedRows: 40, budget: 100 });

    expect(plan.disclosure).toBeNull();
    expect(plan.query).toEqual(groupedQuery());
  });

  test('never approximates a KPI, whatever the estimate claims', () => {
    const plan = planSampling({ query: groupedQuery(), kind: 'kpi', estimatedRows: 10_000_000, budget: 100 });

    expect(plan.disclosure).toBeNull();
  });

  test('never approximates a table', () => {
    expect(requiresExactResult('kpi')).toBe(true);
    expect(requiresExactResult('table')).toBe(true);
    expect(requiresExactResult('bar')).toBe(false);
  });

  test('chooses top-N with an Other bucket for an oversized categorical dimension', () => {
    const plan = planSampling({ query: groupedQuery(), kind: 'bar', estimatedRows: 500_000, budget: 100 });

    expect(plan.disclosure?.strategy).toEqual({ kind: 'topN', retained: 99, otherBucket: true });
    // Every row is read, so the retained values are exact even though the categories are not all shown.
    expect(plan.disclosure?.rate).toBe(1);
    expect(plan.query.limit).toBe(99);
    expect(plan.query.orderBy).toEqual([{ measureAlias: 'revenue', direction: 'desc' }]);
  });

  test('never claims to retain more groups than the compiler will return', () => {
    // Caught in a browser run: the badge read "Top 4,999" while the compiler's own row cap meant
    // only 500 arrived. A disclosure that overstates what was kept is worse than no disclosure.
    const plan = planSampling({ query: groupedQuery(), kind: 'bar', estimatedRows: 500_000 });
    const strategy = plan.disclosure?.strategy;

    expect(strategy?.kind).toBe('topN');
    if (strategy?.kind !== 'topN') return;

    expect(plan.query.limit).toBe(strategy.retained);
    expect(strategy.retained).toBeLessThanOrEqual(MAX_QUERY_LIMIT);
    // The bucket still fits alongside the retained groups.
    expect(strategy.retained + 1).toBeLessThanOrEqual(MAX_QUERY_LIMIT + 1);
  });

  test('reports a sampling rate the delivered rows actually reflect', () => {
    const scatter: AnalysisQuery = {
      datasetId: 'ds_1' as EntityId,
      dimensions: [columnId('x'), columnId('y')],
      measures: [],
      filters: [],
    };
    const plan = planSampling({ query: scatter, kind: 'scatter', estimatedRows: 1_000_000 });

    expect(plan.query.limit).toBeLessThanOrEqual(MAX_QUERY_LIMIT);
    // rate × estimate must equal the rows that can arrive, not the rows the budget would allow.
    expect(Math.round((plan.disclosure?.rate ?? 0) * 1_000_000)).toBe(plan.query.limit ?? 0);
  });

  test('top-N pairs the retained query with a whole-population total', () => {
    const plan = planSampling({ query: groupedQuery(), kind: 'bar', estimatedRows: 500_000, budget: 100 });

    expect(plan.totalQuery?.dimensions).toEqual([]);
    expect(plan.totalQuery?.limit).toBe(1);
    expect(plan.totalQuery?.measures).toEqual(groupedQuery().measures);
  });

  test('widens a temporal bucket rather than dropping periods', () => {
    // Ten years of daily buckets is about 3,650 rows, which fits a monthly regrouping at 120.
    const plan = planSampling({ query: temporalQuery(), kind: 'line', estimatedRows: 3_650, budget: 200 });

    expect(plan.disclosure?.strategy).toEqual({ kind: 'temporalWiden', from: 'day', to: 'month' });
    expect(plan.query.binnedDimensions?.[0]?.strategy).toEqual({ kind: 'temporal', unit: 'month' });
  });

  /*
   * A year and a half of daily points is far inside the 5,000-point performance budget and still
   * unreadable in a 900px panel. The readable budget is what turns that into a weekly series.
   */
  test('widens a temporal bucket to what the plot can legibly show', () => {
    const plan = planSampling({
      query: temporalQuery(),
      kind: 'line',
      estimatedRows: 550,
      budget: 5_000,
      readableBudget: 180,
    });

    expect(plan.disclosure?.strategy).toEqual({ kind: 'temporalWiden', from: 'day', to: 'week' });
  });

  test('a temporal result the plot can already show is left exact', () => {
    const plan = planSampling({
      query: temporalQuery(),
      kind: 'line',
      estimatedRows: 90,
      budget: 5_000,
      readableBudget: 180,
    });

    expect(plan.disclosure).toBeNull();
  });

  /*
   * Readability must never cost data. Widening is exempt because it keeps every row, but a narrow
   * panel must not start folding categories into an "Other" bucket — that is a fidelity decision,
   * and only the performance budget makes it.
   */
  test('a narrow plot never triggers lossy reduction of a categorical result', () => {
    const plan = planSampling({
      query: groupedQuery(),
      kind: 'bar',
      estimatedRows: 400,
      budget: 5_000,
      readableBudget: 60,
    });

    expect(plan.disclosure).toBeNull();
    expect(plan.query).toEqual(groupedQuery());
  });

  test('the performance budget still applies when it is the tighter of the two', () => {
    const plan = planSampling({
      query: temporalQuery(),
      kind: 'line',
      estimatedRows: 3_650,
      budget: 200,
      readableBudget: 5_000,
    });

    expect(plan.disclosure?.strategy).toEqual({ kind: 'temporalWiden', from: 'day', to: 'month' });
  });

  test('widening picks the narrowest unit that fits', () => {
    expect(widenTemporalUnit('day', 3_650, 200)).toBe('month');
    expect(widenTemporalUnit('day', 3_650, 600)).toBe('week');
    expect(widenTemporalUnit('year', 100, 10)).toBe('year');
  });

  test('samples rows for a row-level scatter query', () => {
    const scatter: AnalysisQuery = {
      datasetId: 'ds_1' as EntityId,
      dimensions: [columnId('x'), columnId('y')],
      measures: [],
      filters: [],
    };
    const plan = planSampling({ query: scatter, kind: 'scatter', estimatedRows: 1_000_000, budget: 5_000 });

    expect(plan.disclosure?.strategy.kind).toBe('reservoir');
    // Capped by the compiler's row limit rather than the nominal budget, so the plan asks only for
    // rows that can actually come back.
    expect(plan.query.limit).toBe(Math.min(5_000, MAX_QUERY_LIMIT));
  });
});

describe('sampling disclosure', () => {
  test('every strategy produces a label and an explanation', () => {
    const strategies = [
      { kind: 'exact' as const },
      { kind: 'topN' as const, retained: 99, otherBucket: true as const },
      { kind: 'temporalWiden' as const, from: 'day' as const, to: 'month' as const },
      { kind: 'reservoir' as const, rate: 0.005 },
      { kind: 'tablesample' as const, rate: 0.01 },
    ];

    for (const strategy of strategies) {
      const text = describeSampling({ strategy, rate: 1, estimatedRows: 10 });

      expect(text.label.length).toBeGreaterThan(0);
      expect(text.explanation.length).toBeGreaterThan(0);
    }
  });

  test('the widening explanation names the granularity actually used', () => {
    const text = describeSampling({
      strategy: { kind: 'temporalWiden', from: 'day', to: 'month' },
      rate: 1,
      estimatedRows: 3_650,
    });

    expect(text.label).toContain(temporalUnitLabel.month);
    expect(text.explanation).toContain('month');
  });
});

describe('other bucket', () => {
  test('reconciles the total from the population aggregate', () => {
    const rows = [
      ['North', 400],
      ['South', 300],
    ];
    const folded = foldOtherBucket(rows, 1, [1_000], [true]);

    expect(folded).toHaveLength(3);
    expect(folded[2]).toEqual(['Other', 300]);
    // The whole point: the bars still add up to the figure the user knows.
    expect(folded.reduce((sum, row) => sum + Number(row[1]), 0)).toBe(1_000);
  });

  test('leaves a non-summable measure blank rather than fabricating one', () => {
    const rows = [['North', 40]];
    const folded = foldOtherBucket(rows, 1, [55], [false]);

    expect(folded[1]).toEqual(['Other', null]);
  });

  test('clamps a negative remainder caused by rounding', () => {
    const folded = foldOtherBucket([['North', 100.000_000_1]], 1, [100], [true]);

    expect(folded[1]?.[1]).toBe(0);
  });

  test('only count and sum reconcile by subtraction', () => {
    expect(isAdditiveAggregate('sum')).toBe(true);
    expect(isAdditiveAggregate('count')).toBe(true);
    expect(isAdditiveAggregate('avg')).toBe(false);
    expect(isAdditiveAggregate('median')).toBe(false);
    // A value in two groups would be counted twice, so this cannot be summed across groups.
    expect(isAdditiveAggregate('count_distinct')).toBe(false);
  });
});
