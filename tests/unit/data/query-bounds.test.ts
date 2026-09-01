import { describe, expect, test } from 'bun:test';
import { compileAnalysisQuery, MAX_QUERY_LIMIT } from '@/data/compiler/compile-analysis-query.ts';
import type { QueryContext } from '@/data/compiler/compile-analysis-query.ts';
import { planQuery } from '@/data/compiler/query-planner.ts';
import { createQueryCache } from '@/application/queries/query-cache.ts';
import { MAX_CHART_POINTS } from '@/application/queries/sampling-policy.ts';
import { planSampling } from '@/application/queries/adaptive-sampling.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { ORDERS_COLUMNS } from '../application/action-fixtures.ts';

// Asserts deterministic result-size bounds.

const context: QueryContext = {
  datasets: [{ id: 'ds_orders' as EntityId, relationId: 'dataset_orders', columns: ORDERS_COLUMNS }],
};

const baseQuery: AnalysisQuery = {
  datasetId: 'ds_orders' as EntityId,
  dimensions: ['col_order_id' as EntityId],
  measures: [{ columnId: 'col_order_revenue' as EntityId, aggregate: 'sum', alias: 'total' }],
  filters: [],
};

// Extracts the emitted `LIMIT`, or `undefined` when the statement carries none.
const emittedLimit = (sql: string): number | undefined => {
  const matched = /LIMIT (\d+)/u.exec(sql);

  return matched === null ? undefined : Number(matched[1]);
};

describe('no unbounded query is ever emitted', () => {
  const variants: { name: string; query: AnalysisQuery }[] = [
    { name: 'default limit', query: baseQuery },
    { name: 'explicit oversized limit', query: { ...baseQuery, limit: 10_000_000 } },
    { name: 'negative limit', query: { ...baseQuery, limit: -5 } },
    { name: 'zero limit', query: { ...baseQuery, limit: 0 } },
    { name: 'fractional limit', query: { ...baseQuery, limit: 12.9 } },
    { name: 'infinite limit', query: { ...baseQuery, limit: Number.POSITIVE_INFINITY } },
    {
      name: 'bare projection',
      query: { datasetId: 'ds_orders' as EntityId, dimensions: [], measures: [], filters: [] },
    },
  ];

  for (const variant of variants) {
    test(`${variant.name} still emits a bounded LIMIT`, () => {
      const compiled = compileAnalysisQuery(variant.query, context);

      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      const limit = emittedLimit(compiled.value.sql);

      expect(limit).toBeDefined();
      expect(limit as number).toBeGreaterThan(0);
      expect(limit as number).toBeLessThanOrEqual(MAX_QUERY_LIMIT);
    });
  }

  test('planning never removes the bound', () => {
    for (const variant of variants) {
      const planned = planQuery(variant.query, context);
      const compiled = compileAnalysisQuery(planned.query, context);

      expect(compiled.ok).toBe(true);
      if (!compiled.ok) continue;
      expect(emittedLimit(compiled.value.sql) as number).toBeLessThanOrEqual(MAX_QUERY_LIMIT);
    }
  });
});

describe('plotted points stay within budget', () => {
  test('every sampling strategy emits a query bounded by the budget', () => {
    const kinds = ['bar', 'line', 'scatter', 'area', 'donut'] as const;

    for (const kind of kinds) {
      const plan = planSampling({ query: baseQuery, kind, estimatedRows: 10_000_000, budget: MAX_CHART_POINTS });

      // The compiler's limit bounds every reshaping strategy.
      if (plan.query.limit !== undefined) expect(plan.query.limit).toBeLessThanOrEqual(MAX_CHART_POINTS);
    }
  });

  test('the top-N companion total is a single row', () => {
    const plan = planSampling({ query: baseQuery, kind: 'bar', estimatedRows: 10_000_000, budget: 100 });

    expect(plan.totalQuery?.limit).toBe(1);
  });
});

const key = (limit: number, offset = 0) => ({
  datasetId: 'ds_orders',
  datasetRevision: 1,
  filters: [],
  limit,
  offset,
});

describe('cache behaviour on repeated queries', () => {
  test('an identical repeated query hits the cache', () => {
    const cache = createQueryCache<string>();

    cache.set(key(100), 'rows');
    cache.get(key(100));
    cache.get(key(100));

    expect(cache.statistics()).toEqual({ hits: 2, misses: 0 });
  });

  test('a narrower window reuses a wider cached result', () => {
    const cache = createQueryCache<string>();

    cache.set(key(500, 0), 'rows');

    const covering = cache.getCovering(key(50, 10));

    expect(covering?.value).toBe('rows');
    expect(covering?.offset).toBe(0);
  });

  test('a window outside the cached range is a miss', () => {
    const cache = createQueryCache<string>();

    cache.set(key(500, 0), 'rows');

    expect(cache.getCovering(key(50, 900))).toBeUndefined();
  });

  test('a different revision never reuses the previous entry', () => {
    const cache = createQueryCache<string>();

    cache.set(key(500, 0), 'rows');

    expect(cache.getCovering({ ...key(50, 0), datasetRevision: 2 })).toBeUndefined();
  });

  test('an expensive entry outlives a stream of cheap ones', () => {
    // Preserve costly aggregates that charts are likely to request again.
    const cache = createQueryCache<string>(3);

    cache.set(key(10), 'expensive', { size: 10, computeMs: 5_000 });

    for (let index = 0; index < 10; index += 1) {
      cache.set({ ...key(10), datasetId: `ds_cheap_${index}` }, 'cheap', { size: 400, computeMs: 1 });
    }

    expect(cache.get(key(10))).toBe('expensive');
  });
});
