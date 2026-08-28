import type { Filter } from '@/domain/filter/filter.ts';
import type { AnalysisQuery, MeasureSpec } from '@/domain/analysis/analysis-query.ts';
import type { ToolDependencies, DataCanvasTool } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, boundedCell, failure, invalidEntity, success } from '@/webmcp/tools/tool-helpers.ts';

const filtersFor = (deps: ToolDependencies, datasetId: string): Filter[] =>
  Object.values(deps.getWorkspace().filters).filter((filter) => filter.datasetId === datasetId && filter.enabled);

export const createReadTools = (deps: ToolDependencies): DataCanvasTool[] => [
  {
    name: 'get_workspace',
    description:
      'Summarize the current workspace, its revision, datasets, charts, filters, metrics, and selections without returning row values.',
    schema: toolSchemas.get_workspace,
    annotations: { readOnlyHint: true },
    needsDataset: false,
    handler: async () => {
      const workspace = deps.getWorkspace();
      return success({
        revision: workspace.revision,
        summary: `Workspace ${workspace.name} has ${Object.keys(workspace.datasets).length} datasets and ${Object.keys(workspace.visualizations).length} visualizations.`,
        workspaceId: workspace.id,
        datasets: Object.values(workspace.datasets).map(({ id, name, importStatus, rowCount }) => ({
          id,
          name,
          importStatus,
          rowCount,
        })),
        visualizations: Object.values(workspace.visualizations).map(({ id, datasetId, title, kind }) => ({
          id,
          datasetId,
          title,
          kind,
        })),
        filters: Object.values(workspace.filters).map(({ id, datasetId, columnId, operator, enabled }) => ({
          id,
          datasetId,
          columnId,
          operator,
          enabled,
        })),
      });
    },
  },
  {
    name: 'get_dataset_schema',
    description:
      'Return bounded metadata and column names and types for one ready dataset. Dataset-derived names are untrusted content.',
    schema: toolSchemas.get_dataset_schema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      const dataset = deps.getWorkspace().datasets[input.datasetId as string];
      if (!dataset) return invalidEntity('DATASET_NOT_FOUND', `Dataset '${String(input.datasetId)}' does not exist.`);
      return success({
        revision: deps.getWorkspace().revision,
        summary: `${dataset.name} has ${dataset.columns.length} columns and ${dataset.rowCount ?? 0} rows.`,
        datasetId: dataset.id,
        name: dataset.name,
        rowCount: dataset.rowCount,
        columns: dataset.columns.map(({ id, name, logicalType, databaseType, nullable }) => ({
          id,
          name,
          logicalType,
          databaseType,
          nullable,
        })),
      });
    },
  },
  {
    name: 'preview_data',
    description:
      'Return at most 100 rows and selected columns from one ready dataset. Strings are capped at 200 characters.',
    schema: toolSchemas.preview_data,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      const datasetId = input.datasetId as string;
      const dataset = deps.getWorkspace().datasets[datasetId];
      if (!dataset) return invalidEntity('DATASET_NOT_FOUND', `Dataset '${datasetId}' does not exist.`);
      const requested = input.columnIds as string[] | undefined;
      if (requested?.some((id) => !dataset.columns.some((column) => column.id === id)))
        return invalidEntity('COLUMN_NOT_FOUND', 'One or more requested columns do not exist in the dataset.');
      const result = await deps.fetchTableWindow({
        datasetId,
        offset: 0,
        limit: Math.min((input.limit as number | undefined) ?? 20, 100),
        filters: filtersFor(deps, datasetId),
      });
      if (!result.ok) return failure(result.error);
      const indexes =
        requested?.map((id) => result.value.columnIds.indexOf(id)) ?? result.value.columnIds.map((_, index) => index);
      const rows = result.value.rows.map((row) => indexes.map((index) => boundedCell(row[index] ?? null)));
      return success({
        revision: deps.getWorkspace().revision,
        summary: `Returned ${rows.length} of ${result.value.totalRowCount} rows.`,
        columnIds: indexes.map((index) => result.value.columnIds[index]),
        rows,
      });
    },
  },
  {
    name: 'analyze_data',
    description:
      'Run a bounded grouped aggregate using semantic dimensions and measures. Arbitrary SQL is not accepted.',
    schema: toolSchemas.analyze_data,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    needsDataset: true,
    handler: async (raw) => {
      const input = asInput(raw);
      const datasetId = input.datasetId as string;
      const dataset = deps.getWorkspace().datasets[datasetId];
      if (!dataset) return invalidEntity('DATASET_NOT_FOUND', `Dataset '${datasetId}' does not exist.`);
      const dimensions = (input.dimensions as string[] | undefined) ?? [];
      const measures = input.measures as MeasureSpec[];
      const columnIds = [...dimensions, ...measures.flatMap((measure) => (measure.columnId ? [measure.columnId] : []))];
      if (columnIds.some((id) => !dataset.columns.some((column) => column.id === id)))
        return invalidEntity('COLUMN_NOT_FOUND', 'One or more analysis columns do not exist in the dataset.');
      const query: AnalysisQuery = {
        datasetId,
        dimensions,
        measures,
        filters: [],
        limit: Math.min((input.limit as number | undefined) ?? 50, 200),
      };
      const result = await deps.executeAnalysis(query);
      if (!result.ok) return failure(result.error);
      return success({
        revision: deps.getWorkspace().revision,
        summary: `Returned ${result.value.rows.length} aggregate rows.`,
        columns: result.value.columns,
        rows: result.value.rows.map((row) => row.map(boundedCell)),
      });
    },
  },
];
