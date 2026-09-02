import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { AnalysisResult, DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { planSampling, requiresExactResult } from '@/application/queries/adaptive-sampling.ts';
import type { SamplingDisclosure } from '@/application/queries/adaptive-sampling.ts';
import { foldOtherBucket, isAdditiveAggregate } from '@/application/queries/sampling-disclosure.ts';
import { boundChartRows, MAX_CHART_POINTS, readableChartPoints } from '@/application/queries/sampling-policy.ts';
import { propagateSelection } from '@/application/selection/propagate-selection.ts';
import type { ResultColumn } from '@/data/compiler/result-columns.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import { maxBinCardinality } from '@/domain/analysis/bin-strategy.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import { measureAsync, recordRowsReturned } from '@/shared/perf/performance-marks.ts';
import type { Result } from '@/shared/result/result.ts';

export interface ChartResult {
  columns: ResultColumn[];
  rows: readonly (string | number | boolean | null)[][];
  rowCount: number;
  sampled: boolean;
  // Reduction applied to an approximate result, present when `sampled` is true.
  disclosure?: SamplingDisclosure;
  // True when a newer query superseded this result; callers must discard it.
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
  // Filter changes the query; highlight keeps all rows and dims unmatched marks in the renderer.
  const propagated = propagateSelection(workspace, visualization);
  const selectionFilter =
    propagated.effect === 'filter' && propagated.predicate !== undefined ? [propagated.predicate] : [];

  return {
    ...visualization.query,
    filters: [...visualization.query.filters, ...filters, ...selectionFilter],
    limit: Math.min(visualization.query.limit ?? MAX_CHART_POINTS + 1, MAX_CHART_POINTS + 1),
  };
};

/*
 * Estimates grouped result size before running the chart query.
 *
 * Binned dimensions bucket their column, so the strategy caps their group count regardless of how many
 * distinct values the column holds. Counting distinct raw values instead would treat a 20-bucket
 * histogram over a high-cardinality column as an oversized categorical result and mislabel it as
 * top-N sampled. Only temporal bins lack a static bound and still need a measured count.
 */
const estimateResultRows = async (engine: DataEnginePort, query: AnalysisQuery): Promise<number | undefined> => {
  const binned = (query.binnedDimensions ?? []).map((bin) => ({ bin, bound: maxBinCardinality(bin.strategy) }));

  if (query.dimensions.length === 0 && binned.length === 0) {
    return undefined;
  }

  // Columns whose group count must come from the engine.
  const measured = [
    ...query.dimensions,
    ...binned.flatMap((entry) => (entry.bound === undefined ? [entry.bin.columnId] : [])),
  ];

  // Product of the statically bounded bins; a chart with only bounded bins needs no engine round trip.
  const staticBound = binned.reduce<number>((product, entry) => product * (entry.bound ?? 1), 1);

  if (measured.length === 0) {
    return staticBound;
  }

  const estimate = await engine.executeAnalysis({
    datasetId: query.datasetId,
    ...(query.relationshipIds === undefined ? {} : { relationshipIds: query.relationshipIds }),
    dimensions: [],
    measures: measured.map((columnId) => ({ columnId, aggregate: 'count_distinct' as const })),
    filters: query.filters,
    limit: 1,
  });

  if (!estimate.ok) {
    return undefined;
  }

  const row = estimate.value.rows[0];

  if (row === undefined) {
    return undefined;
  }

  // Multiplying distinct counts overestimates safely; it can trigger sampling, but never under-sample.
  return row.reduce<number>((product, value) => product * Math.max(Number(value) || 0, 1), staticBound);
};

const resolveBinRanges = async (
  engine: DataEnginePort,
  query: AnalysisQuery,
): Promise<Result<AnalysisQuery, DomainError>> => {
  const unresolved = (query.binnedDimensions ?? []).filter(
    (bin) => bin.range === undefined && (bin.strategy.kind === 'equalWidth' || bin.strategy.kind === 'equalWidthOf'),
  );

  if (unresolved.length === 0) {
    return ok(query);
  }

  const rangeResult = await engine.executeAnalysis({
    datasetId: query.datasetId,
    ...(query.relationshipIds === undefined ? {} : { relationshipIds: query.relationshipIds }),
    dimensions: [],
    measures: unresolved.flatMap((bin) => [
      { columnId: bin.columnId, aggregate: 'min' as const },
      { columnId: bin.columnId, aggregate: 'max' as const },
    ]),
    filters: query.filters,
    limit: 1,
  });

  if (!rangeResult.ok) {
    return err(rangeResult.error);
  }

  const row = rangeResult.value.rows[0] ?? [];
  return ok({
    ...query,
    binnedDimensions: (query.binnedDimensions ?? []).map((bin) => {
      const index = unresolved.indexOf(bin);
      if (index < 0) {
        return bin;
      }

      const min = Number(row[index * 2]);
      const max = Number(row[index * 2 + 1]);
      return {
        ...bin,
        range: {
          min: Number.isFinite(min) ? min : 0,
          max: Number.isFinite(max) ? max : 0,
        },
      };
    }),
  });
};

export const executeVisualizationQuery = async (
  visualization: Visualization,
  workspace: Workspace,
  engine: DataEnginePort = registeredDataEngine,
  signal?: AbortSignal,
  // Optional rendered width used to choose a legible temporal bucket.
  plotWidth?: number,
): Promise<Result<ChartResult, DomainError>> => {
  const resolvedResult = await resolveBinRanges(engine, resolveVisualizationQuery(visualization, workspace));
  if (!resolvedResult.ok) {
    return resolvedResult;
  }
  const resolved = resolvedResult.value;

  // Scope supersession to this visualization so one chart's filter does not cancel another's query.
  const scheduling = { key: `visualization:${visualization.id}`, ...(signal === undefined ? {} : { signal }) };

  // KPI and table results are exact and do not need a sampling estimate.
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

  if (!result.ok) {
    return result;
  }

  // Preserve the stale marker so callers keep the previous chart while empty rows are ignored.
  if (result.value.stale === true) {
    return ok({ columns: result.value.columns, rows: [], rowCount: 0, sampled: false, stale: true });
  }

  recordRowsReturned('visualization-query', result.value.rows.length);

  const strategy = plan.disclosure?.strategy;

  // Top-N needs the population total to build its `Other` bucket.
  if (strategy?.kind === 'topN' && plan.totalQuery !== undefined) {
    const totals = await engine.executeAnalysis(plan.totalQuery);
    const measureStartIndex = plan.query.dimensions.length + (plan.query.binnedDimensions ?? []).length;
    const additive = plan.query.measures.map((measure) => isAdditiveAggregate(measure.aggregate));

    // Without a total, return retained groups without inventing an `Other` value.
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
