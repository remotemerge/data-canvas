import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { TemporalUnit } from '@/domain/analysis/bin-strategy.ts';
import { TEMPORAL_UNITS } from '@/domain/analysis/bin-strategy.ts';
import type { VisualizationKind } from '@/domain/visualization/visualization.ts';
import { MAX_CHART_POINTS } from '@/application/queries/sampling-policy.ts';
import { MAX_QUERY_LIMIT } from '@/data/compiler/compile-analysis-query.ts';

/**
 * Chooses how a result larger than the point budget is reduced.
 *
 * The decision is made from the query's shape plus an estimated result cardinality, never from the
 * rows themselves — reading the rows to decide how to avoid reading the rows would defeat the
 * purpose. The estimate comes from a bounded `COUNT` cached against the dataset revision.
 *
 * Every strategy other than `exact` produces an approximate answer, so each carries enough
 * information for the UI to say precisely what was done. Sampling here is a fidelity trade the user
 * is told about; it is never a silent shortcut.
 */

export type SamplingStrategy =
  /** The result fits the budget. No approximation of any kind. */
  | { kind: 'exact' }
  /**
   * The highest-ranked categories by the query's first measure, plus one aggregated bucket holding
   * everything else. The bucket keeps the total reconciling, which a plain `LIMIT` would not.
   */
  | { kind: 'topN'; retained: number; otherBucket: true }
  /** A temporal dimension re-bucketed to a coarser unit until the period count fits. */
  | { kind: 'temporalWiden'; from: TemporalUnit; to: TemporalUnit }
  /** A uniform row sample, for scatter-style queries where every row is a mark. */
  | { kind: 'reservoir'; rate: number }
  /** A scanned-row sample under an aggregate, whose result is a scaled estimate. */
  | { kind: 'tablesample'; rate: number };

export interface SamplingDisclosure {
  strategy: SamplingStrategy;
  /**
   * The fraction of the source the result reflects, in `(0, 1]`.
   *
   * `1` for `topN` and `temporalWiden`: both read every row and reshape the grouping, so the
   * measure values are exact even though the categories or periods are not the ones requested.
   */
  rate: number;
  /** Cardinality the decision was made from. Estimated, so callers must not present it as a count. */
  estimatedRows: number;
}

export interface SamplingPlan {
  query: AnalysisQuery;
  /**
   * A companion single-row query the caller must also run, present only for `topN`.
   *
   * It computes the same measures over the whole filtered population, which is what lets the "Other"
   * bucket be derived by subtraction instead of by reading every remaining group.
   */
  totalQuery?: AnalysisQuery;
  disclosure: SamplingDisclosure | null;
}

/**
 * Kinds whose headline number must never be silently approximate.
 *
 * A KPI is a single figure a user reads as fact. Approximating it produces misinformation rather
 * than a faster chart, so these kinds return exact results or nothing — they are small by
 * construction anyway, since they collapse to one row.
 */
const EXACT_ONLY_KINDS: readonly VisualizationKind[] = ['kpi', 'table'] as const;

export const requiresExactResult = (kind: VisualizationKind): boolean => EXACT_ONLY_KINDS.includes(kind);

/**
 * The label a widened axis carries.
 *
 * Widening changes the question the chart answers, so the axis has to say which granularity produced
 * the marks. A chart labelled "daily" that is actually monthly is worse than a slower chart.
 */
export const temporalUnitLabel: Readonly<Record<TemporalUnit, string>> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
};

/**
 * Approximate periods per year for each unit.
 *
 * Used only to predict how many buckets a widening step yields, so calendar irregularity does not
 * matter: the widened query is re-checked against the budget rather than trusted from this table.
 */
const PERIODS_PER_YEAR: Readonly<Record<TemporalUnit, number>> = {
  day: 365,
  week: 52,
  month: 12,
  quarter: 4,
  year: 1,
};

/**
 * Widens a temporal unit until the projected bucket count fits the budget.
 *
 * Returns the original unit when even `year` would overflow, which means the span is implausibly
 * long; the caller then falls back to `topN` rather than pretending a wider unit exists.
 */
export const widenTemporalUnit = (from: TemporalUnit, estimatedRows: number, budget: number): TemporalUnit => {
  const startIndex = TEMPORAL_UNITS.indexOf(from);

  if (startIndex < 0) return from;

  for (let index = startIndex + 1; index < TEMPORAL_UNITS.length; index += 1) {
    const candidate = TEMPORAL_UNITS[index] as TemporalUnit;
    const ratio = PERIODS_PER_YEAR[candidate] / PERIODS_PER_YEAR[from];

    if (estimatedRows * ratio <= budget) return candidate;
  }

  return from;
};

/**
 * A scatter query plots one mark per row, so its cardinality is the row count rather than a group
 * count. Sampling rows is the only reduction that preserves the shape of the cloud; a `LIMIT` would
 * return whichever rows the engine happened to scan first.
 */
const isRowLevel = (query: AnalysisQuery): boolean =>
  query.measures.length === 0 && (query.binnedDimensions ?? []).length === 0;

const clampRate = (rate: number): number => Math.min(Math.max(rate, 0.000_01), 1);

export interface SamplingInput {
  query: AnalysisQuery;
  kind: VisualizationKind;
  /** Bounded estimate of the rows the unsampled query would return. */
  estimatedRows: number;
  /** Defaults to the chart point budget; overridable so tests need no large fixtures. */
  budget?: number;
  /**
   * The point count the plot can legibly show, when the caller knows its width.
   *
   * Applies to temporal widening alone. Widening is the one reduction that stays exact — it reads
   * every row and only changes the bucket width — so it is safe to apply for readability before
   * anything is over budget. Every other strategy discards or estimates data and therefore stays
   * governed by `budget`, so a narrow panel can never silently drop categories or rows.
   */
  readableBudget?: number;
}

/**
 * Decides the strategy for one query.
 *
 * Ordered by fidelity, best first: an exact result beats a reshaped one, a reshaped one beats a
 * sampled one. Each branch only applies when the query's shape actually supports it, so a strategy
 * is never chosen that the compiler cannot express.
 */
export const planSampling = ({
  query,
  kind,
  estimatedRows,
  budget = MAX_CHART_POINTS,
  readableBudget,
}: SamplingInput): SamplingPlan => {
  const exact: SamplingPlan = { query, disclosure: null };

  // A headline figure is never approximated, and neither kind has an axis to widen.
  if (requiresExactResult(kind)) return exact;

  const temporalBin = (query.binnedDimensions ?? []).find((bin) => bin.strategy.kind === 'temporal');

  // Widening is checked first and against the tighter of the two budgets. It is the only reduction
  // that keeps every row and every measure exact, so applying it for legibility costs no fidelity —
  // a year of daily points becomes weekly or monthly instead of hundreds of overlapping spikes.
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
          // Widening reads every row; only the bucket width changed, so the measures stay exact.
          disclosure: { strategy: { kind: 'temporalWiden', from, to }, rate: 1, estimatedRows },
        };
      }
    }
  }

  // Past here every strategy loses information, so the performance budget alone decides. A result
  // that merely reads densely is left intact rather than being thinned into an approximation.
  if (estimatedRows <= budget) return exact;

  // The rows that can actually arrive, not the rows the budget would allow. The compiler clamps
  // every statement to `MAX_QUERY_LIMIT`, so a rate computed from a larger budget would describe a
  // sample the user never received — and a disclosure that misstates the rate is worse than none.
  const deliverable = Math.min(budget, MAX_QUERY_LIMIT);
  const rate = clampRate(deliverable / estimatedRows);

  if (isRowLevel(query)) {
    return {
      query: { ...query, limit: deliverable },
      disclosure: { strategy: { kind: 'reservoir', rate }, rate, estimatedRows },
    };
  }

  // A grouped query with no dimension is already one row per group of nothing — an aggregate over
  // the whole relation. Only a scanned-row sample can reduce it, and the result is an estimate.
  if (query.dimensions.length === 0 && (query.binnedDimensions ?? []).length === 0) {
    return {
      query,
      disclosure: { strategy: { kind: 'tablesample', rate }, rate, estimatedRows },
    };
  }

  // Top-N keeps the largest groups and folds the rest into one bucket. The retained count leaves
  // room for that bucket, so the emitted result still fits the budget exactly.
  //
  // Quoted from what can actually arrive: asking for more groups than the compiler will return
  // would retain fewer rows than the badge then claims, and a disclosure that overstates what was
  // kept is the exact failure this feature exists to prevent.
  const retained = Math.max(deliverable - 1, 1);
  const firstMeasure = query.measures[0];

  // Ordering by the leading measure is what makes "top" mean largest rather than whichever groups
  // the engine happened to emit first. Ranking needs a measure alias to sort by; without one there
  // is nothing to rank, so the query keeps its own order and the fold takes the leading groups.
  const rankable = firstMeasure?.alias !== undefined;

  return {
    query: {
      ...query,
      ...(rankable ? { orderBy: [{ measureAlias: firstMeasure.alias as string, direction: 'desc' as const }] } : {}),
      limit: retained,
    },
    /**
     * The whole-population aggregate, run alongside the retained groups.
     *
     * "Other" is the difference between this total and the sum of the retained rows, which is exact
     * and costs one extra single-row query. Reading the remaining groups to sum them directly would
     * mean an unbounded read — precisely what the point budget exists to prevent.
     */
    totalQuery: { ...query, dimensions: [], binnedDimensions: [], orderBy: [], limit: 1 },
    disclosure: { strategy: { kind: 'topN', retained, otherBucket: true }, rate: 1, estimatedRows },
  };
};
