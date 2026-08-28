import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { AnalysisResult } from '@/application/ports/data-engine-port.ts';
import { boundChartRows, MAX_CHART_POINTS } from '@/application/queries/sampling-policy.ts';
import type { ResultColumn } from '@/data/compiler/result-columns.ts';
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
  const selection = visualization.linkedSelection
    ? Object.values(workspace.selections).find((item) => item.datasetId === visualization.datasetId)
    : undefined;

  return {
    ...visualization.query,
    filters: [
      ...visualization.query.filters,
      ...filters,
      ...(selection?.predicate === undefined ? [] : [selection.predicate]),
    ],
    limit: Math.min(visualization.query.limit ?? MAX_CHART_POINTS + 1, MAX_CHART_POINTS + 1),
  };
};

export const executeVisualizationQuery = async (
  visualization: Visualization,
  workspace: Workspace,
): Promise<Result<ChartResult, DomainError>> => {
  const result: Result<AnalysisResult, DomainError> = await measureAsync('visualization-query', () =>
    registeredDataEngine.executeAnalysis(resolveVisualizationQuery(visualization, workspace)),
  );
  if (!result.ok) return result;
  recordRowsReturned('visualization-query', result.value.rows.length);
  const bounded = boundChartRows(result.value.rows);
  return ok({
    columns: result.value.columns,
    rows: bounded.rows,
    rowCount: result.value.rows.length,
    sampled: bounded.sampled,
  });
};
