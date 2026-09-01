import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { TemporalUnit } from '@/domain/analysis/bin-strategy.ts';
import { TEMPORAL_UNITS } from '@/domain/analysis/bin-strategy.ts';
import type { VisualizationKind } from '@/domain/visualization/visualization.ts';
import { MAX_CHART_POINTS } from '@/application/queries/sampling-policy.ts';
import { MAX_QUERY_LIMIT } from '@/data/compiler/compile-analysis-query.ts';

// Chooses how to reduce a result that exceeds the point budget.

export type SamplingStrategy =
  // The result fits the budget.
  | { kind: 'exact' }
  // Highest-ranked categories plus an aggregate `Other` bucket.
  | { kind: 'topN'; retained: number; otherBucket: true }
  // Leading buckets of a binned dimension, kept in axis order without an `Other` row.
  | { kind: 'binTruncation'; retained: number }
  // A temporal dimension widened to a coarser unit until it fits.
  | { kind: 'temporalWiden'; from: TemporalUnit; to: TemporalUnit }
  // Uniform row sample for scatter-style queries.
  | { kind: 'reservoir'; rate: number }
  // Scanned-row sample under an aggregate, producing an estimate.
  | { kind: 'tablesample'; rate: number };

export interface SamplingDisclosure {
  strategy: SamplingStrategy;
  // Fraction of the source represented by the result, in `(0, 1]`.
  rate: number;
  // Estimated cardinality used for the decision.
  estimatedRows: number;
}

export interface SamplingPlan {
  query: AnalysisQuery;
  // Whole-population query used to derive the `Other` bucket for `topN`.
  totalQuery?: AnalysisQuery;
  disclosure: SamplingDisclosure | null;
}

// Result kinds that must remain exact because they produce a headline value.
const EXACT_ONLY_KINDS: readonly VisualizationKind[] = ['kpi', 'table'] as const;

export const requiresExactResult = (kind: VisualizationKind): boolean => EXACT_ONLY_KINDS.includes(kind);

// Label shown when a temporal axis uses a wider unit than requested.
export const temporalUnitLabel: Readonly<Record<TemporalUnit, string>> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
};

// Approximate periods per year used to choose a temporal bucket unit.
const PERIODS_PER_YEAR: Readonly<Record<TemporalUnit, number>> = {
  day: 365,
  week: 52,
  month: 12,
  quarter: 4,
  year: 1,
};

// Widens a temporal unit until its projected bucket count fits the budget.
export const widenTemporalUnit = (from: TemporalUnit, estimatedRows: number, budget: number): TemporalUnit => {
  const startIndex = TEMPORAL_UNITS.indexOf(from);

  if (startIndex < 0) {
    return from;
  }

  for (let index = startIndex + 1; index < TEMPORAL_UNITS.length; index += 1) {
    const candidate = TEMPORAL_UNITS[index] as TemporalUnit;
    const ratio = PERIODS_PER_YEAR[candidate] / PERIODS_PER_YEAR[from];

    if (estimatedRows * ratio <= budget) {
      return candidate;
    }
  }

  return from;
};

// Estimates a scatter query from its bounded row count.
const isRowLevel = (query: AnalysisQuery): boolean =>
  query.measures.length === 0 && (query.binnedDimensions ?? []).length === 0;

const clampRate = (rate: number): number => Math.min(Math.max(rate, 0.000_01), 1);

export interface SamplingInput {
  query: AnalysisQuery;
  kind: VisualizationKind;
  // Bounded estimate of unsampled result rows.
  estimatedRows: number;
  // Target point count, defaulting to the chart budget.
  budget?: number;
  // Optional display target used only when widening a temporal axis.
  readableBudget?: number;
}

// Chooses a bounded sampling strategy for one query.
export const planSampling = ({
  query,
  kind,
  estimatedRows,
  budget = MAX_CHART_POINTS,
  readableBudget,
}: SamplingInput): SamplingPlan => {
  const exact: SamplingPlan = { query, disclosure: null };

  // Headline values remain exact, and neither kind has an axis to widen.
  if (requiresExactResult(kind)) {
    return exact;
  }

  const temporalBin = (query.binnedDimensions ?? []).find((bin) => bin.strategy.kind === 'temporal');

  // Widening preserves every row and measure, so try it before lossy sampling.
  if (temporalBin !== undefined && temporalBin.strategy.kind === 'temporal') {
    const target = Math.min(budget, readableBudget ?? budget);

    if (estimatedRows > target) {
      const from = temporalBin.strategy.unit;
      const to = widenTemporalUnit(from, estimatedRows, target);

      if (to !== from) {
        return {
          query: {
            ...query,
            binnedDimensions: (query.binnedDimensions ?? []).map((bin) =>
              bin === temporalBin ? { ...bin, strategy: { kind: 'temporal', unit: to } } : bin,
            ),
          },
          // Widening reads every row; only the bucket width changes.
          disclosure: { strategy: { kind: 'temporalWiden', from, to }, rate: 1, estimatedRows },
        };
      }
    }
  }

  // From here, every strategy loses information. Leave results that fit the performance budget exact.
  if (estimatedRows <= budget) {
    return exact;
  }

  // Base the fraction on the compiler's maximum result size, not an uncapped display budget.
  const deliverable = Math.min(budget, MAX_QUERY_LIMIT);
  const rate = clampRate(deliverable / estimatedRows);

  if (isRowLevel(query)) {
    return {
      query: { ...query, limit: deliverable },
      disclosure: { strategy: { kind: 'reservoir', rate }, rate, estimatedRows },
    };
  }

  // Without dimensions, the query already returns one aggregate row; only row sampling is available.
  if (query.dimensions.length === 0 && (query.binnedDimensions ?? []).length === 0) {
    return {
      query,
      disclosure: { strategy: { kind: 'tablesample', rate }, rate, estimatedRows },
    };
  }

  /*
   * An `Other` bucket only means something for categorical groups. Folding the tail of a binned
   * dimension into one row would place a synthetic category on a continuous or temporal axis and
   * describe the chart as top-N categories, so bounded binned results are truncated in axis order
   * instead. `binCount` bounds keep this path rare.
   */
  if ((query.binnedDimensions ?? []).length > 0) {
    return {
      query: { ...query, limit: deliverable },
      disclosure: { strategy: { kind: 'binTruncation', retained: deliverable }, rate, estimatedRows },
    };
  }

  // Reserve one row for `Other`, so the returned group count stays within the budget.
  const retained = Math.max(deliverable - 1, 1);
  const firstMeasure = query.measures[0];

  // Rank by the leading measure when available; otherwise preserve the query's order.
  const rankable = firstMeasure?.alias !== undefined;

  return {
    query: {
      ...query,
      ...(rankable ? { orderBy: [{ measureAlias: firstMeasure.alias as string, direction: 'desc' as const }] } : {}),
      limit: retained,
    },
    // Whole-population aggregate used to compute the `Other` row.
    totalQuery: { ...query, dimensions: [], binnedDimensions: [], orderBy: [], limit: 1 },
    disclosure: { strategy: { kind: 'topN', retained, otherBucket: true }, rate: 1, estimatedRows },
  };
};
