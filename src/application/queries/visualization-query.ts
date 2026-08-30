import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { AnalysisResult, DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { planSampling, requiresExactResult } from '@/application/queries/adaptive-sampling.ts';
import type { SamplingDisclosure } from '@/application/queries/adaptive-sampling.ts';
import { foldOtherBucket, isAdditiveAggregate } from '@/application/queries/sampling-disclosure.ts';
import { boundChartRows, MAX_CHART_POINTS, readableChartPoints } from '@/application/queries/sampling-policy.ts';
import { propagateSelection } from '@/application/selection/propagate-selection.ts';
import type { ResultColumn } from '@/data/compiler/result-columns.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { ok } from '@/shared/result/result.ts';
import { measureAsync, recordRowsReturned } from '@/shared/perf/performance-marks.ts';
import type { Result } from '@/shared/result/result.ts';

export interface ChartResult {
  columns: ResultColumn[];
  rows: readonly (string | number | boolean | null)[][];
  rowCount: number;
  sampled: boolean;
  /**
   * How the result was reduced, when it was.
   *
   * Present exactly when `sampled` is true. The UI renders it as a badge with an explanation; a
   * sampled result with no disclosure would be the silent approximation this design forbids.
   */
  disclosure?: SamplingDisclosure;
  /** True when a newer query for the same chart superseded this one. The caller discards it. */
  stale?: boolean;
}

export const resolveVisualizationQuery = (visualization: Visualization, workspace: Workspace) => {
  const filters: FilterExpression[] = Object.values(workspace.filters)
    .filter((filter) => filter.datasetId === visualization.datasetId && filter.enabled)
    .map((filter) => ({
      kind: 'comparison',
      columnId: filter.columnId,
      operator: filter.operator,
      ...(filter.value === undefined ? {} : { value: filter.value }),
    }));
  // Only `filter` mode changes the query. `highlight` keeps the full result and dims unselected
  // marks in the renderer, so the chart's totals stay stable while showing what is selected.
  const propagated = propagateSelection(workspace, visualization);
  const selectionFilter =
    propagated.effect === 'filter' && propagated.predicate !== undefined ? [propagated.predicate] : [];

  return {
    ...visualization.query,
    filters: [...visualization.query.filters, ...filters, ...selectionFilter],
    limit: Math.min(visualization.query.limit ?? MAX_CHART_POINTS + 1, MAX_CHART_POINTS + 1),
  };
};

/**
 * Estimates how many rows the chart query would return, so sampling can be decided before running it.
 *
 * A `count_distinct` over the grouped dimensions rather than a full run: it returns one row whatever
 * the dataset's size, which is what makes asking the question cheaper than answering it. A query
 * with no dimensions groups to a single row and needs no estimate at all.
 *
 * A failed estimate returns `undefined` and the caller proceeds unsampled. Failing to predict the
 * size must not fail the query.
 */
const estimateResultRows = async (engine: DataEnginePort, query: AnalysisQuery): Promise<number | undefined> => {
  const grouped = [...query.dimensions, ...(query.binnedDimensions ?? []).map((bin) => bin.columnId)];

  if (grouped.length === 0) return undefined;

  const estimate = await engine.executeAnalysis({
    datasetId: query.datasetId,
    ...(query.relationshipIds === undefined ? {} : { relationshipIds: query.relationshipIds }),
    dimensions: [],
    measures: grouped.map((columnId) => ({ columnId, aggregate: 'count_distinct' as const })),
    filters: query.filters,
    limit: 1,
  });

  if (!estimate.ok) return undefined;

  const row = estimate.value.rows[0];

  if (row === undefined) return undefined;

  // Distinct counts multiply across dimensions in the worst case. Over-estimating only makes the
  // policy more cautious, which is the safe direction: it never silently under-samples.
  return row.reduce<number>((product, value) => product * Math.max(Number(value) || 0, 1), 1);
};

export const executeVisualizationQuery = async (
  visualization: Visualization,
  workspace: Workspace,
  engine: DataEnginePort = registeredDataEngine,
  signal?: AbortSignal,
  /**
   * The rendered plot's width in pixels, when the caller has measured it.
   *
   * Only ever narrows a temporal chart's buckets to what the panel can legibly show. Omitted by
   * every non-rendering caller — a WebMCP tool has no plot — and those keep the point budget alone.
   */
  plotWidth?: number,
): Promise<Result<ChartResult, DomainError>> => {
  const resolved = resolveVisualizationQuery(visualization, workspace);

  // Keyed per visualization, so changing a filter aborts this chart's in-flight query while leaving
  // every other chart's alone. Without the key a superseded query would run to completion in the
  // worker and only have its result discarded, which is the cost this is here to avoid.
  const scheduling = { key: `visualization:${visualization.id}`, ...(signal === undefined ? {} : { signal }) };

  // A KPI or table is never approximated, so it skips the estimate entirely rather than computing
  // one it would refuse to act on.
  const estimatedRows = requiresExactResult(visualization.kind)
    ? undefined
    : await estimateResultRows(engine, resolved);

  const plan =
    estimatedRows === undefined
      ? { query: resolved, disclosure: null }
      : planSampling({
          query: resolved,
          kind: visualization.kind,
          estimatedRows,
          ...(plotWidth === undefined ? {} : { readableBudget: readableChartPoints(plotWidth) }),
        });

  const result: Result<AnalysisResult, DomainError> = await measureAsync('visualization-query', () =>
    engine.executeAnalysis(plan.query, scheduling),
  );

  if (!result.ok) return result;

  // A superseded query yields no rows. Returning an empty chart result would blank the canvas, so
  // the stale marker is passed through and the caller keeps what it is already showing.
  if (result.value.stale === true) {
    return ok({ columns: result.value.columns, rows: [], rowCount: 0, sampled: false, stale: true });
  }

  recordRowsReturned('visualization-query', result.value.rows.length);

  const strategy = plan.disclosure?.strategy;

  // Top-N is the one strategy needing post-processing: the engine returned the retained groups, and
  // the population total is what turns the remainder into a bucket the chart's total reconciles with.
  if (strategy?.kind === 'topN' && plan.totalQuery !== undefined) {
    const totals = await engine.executeAnalysis(plan.totalQuery);
    const measureStartIndex = plan.query.dimensions.length + (plan.query.binnedDimensions ?? []).length;
    const additive = plan.query.measures.map((measure) => isAdditiveAggregate(measure.aggregate));

    // Without the total there is nothing to subtract from, so the retained groups are returned as
    // they are. A missing bucket is honest; a fabricated one is not.
    const rows = totals.ok
      ? foldOtherBucket(result.value.rows, measureStartIndex, totals.value.rows[0] ?? [], additive)
      : result.value.rows;

    return ok({
      columns: result.value.columns,
      rows,
      rowCount: rows.length,
      sampled: true,
      disclosure: plan.disclosure as SamplingDisclosure,
    });
  }

  const bounded = boundChartRows(result.value.rows);

  return ok({
    columns: result.value.columns,
    rows: bounded.rows,
    rowCount: result.value.rows.length,
    sampled: bounded.sampled || plan.disclosure !== null,
    ...(plan.disclosure === null ? {} : { disclosure: plan.disclosure }),
  });
};
