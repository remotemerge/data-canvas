import type { Filter } from '@/domain/filter/filter.ts';
import type { AnalysisQuery, MeasureSpec } from '@/domain/analysis/analysis-query.ts';
import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { ToolDependencies, DataCanvasTool } from '@/webmcp/registry/tool-types.ts';
import { PRESERVE_COLUMNS_KEY } from '@/webmcp/results/enforce-output-budget.ts';
import { TOOL_CONTRACT_VERSION, toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { createGetColumnStatisticsTool } from '@/webmcp/tools/read/get-column-statistics.ts';
import { createListRelationshipsTool } from '@/webmcp/tools/read/list-relationships.ts';
import { asInput, boundedCell, failure, invalidEntity, success } from '@/webmcp/tools/tool-helpers.ts';

const filtersFor = (deps: ToolDependencies, datasetId: string): Filter[] =>
  Object.values(deps.getWorkspace().filters).filter((filter) => filter.datasetId === datasetId && filter.enabled);

// Agent aggregates use the same enabled filters as the table and metric reads.
const analysisFiltersFor = (deps: ToolDependencies, datasetId: string): AnalysisQuery['filters'] =>
  filtersFor(deps, datasetId).map((filter) => ({
    kind: 'comparison',
    columnId: filter.columnId,
    operator: filter.operator,
    ...(filter.value === undefined ? {} : { value: filter.value }),
  }));

export const createReadTools = (deps: ToolDependencies): DataCanvasTool[] => [
  createListRelationshipsTool(deps),
  createGetColumnStatisticsTool(deps),
  {
    name: 'get_workspace',
    description:
      'Summarize the current workspace, its revision, datasets, charts, filters, metrics, and selections without returning row values. Also reports toolContractVersion, which changes when tool argument shapes change.',
    schema: toolSchemas.get_workspace,
    annotations: { readOnlyHint: true },
    needsDataset: false,
    handler: async () => {
      const workspace = deps.getWorkspace();
      const relationships = Object.values(workspace.relationships);
      return success({
        revision: workspace.revision,
        toolContractVersion: TOOL_CONTRACT_VERSION,
        summary: `Workspace ${workspace.name} has ${Object.keys(workspace.datasets).length} datasets, ${relationships.length} relationships, and ${Object.keys(workspace.visualizations).length} visualizations.`,
        workspaceId: workspace.id,
        datasets: Object.values(workspace.datasets).map(({ id, name, importStatus, rowCount }) => ({
          id,
          name,
          importStatus,
          rowCount,
        })),
        relationships: relationships.map(({ id, leftDatasetId, rightDatasetId, kind, join }) => ({
          id,
          leftDatasetId,
          rightDatasetId,
          kind,
          join,
        })),
        visualizations: Object.values(workspace.visualizations).map(({ id, datasetId, title, kind }) => ({
          id,
          datasetId,
          title,
          kind,
        })),
        metrics: Object.values(workspace.metrics),
        selections: Object.values(workspace.selections),
        filters: Object.values(workspace.filters).map(
          ({ id, datasetId, columnId, operator, value, enabled, origin }) => ({
            id,
            datasetId,
            columnId,
            operator,
            ...(value === undefined
              ? {}
              : {
                  value: Array.isArray(value)
                    ? value.map((item) => boundedCell(item as Parameters<typeof boundedCell>[0]))
                    : boundedCell(value as Parameters<typeof boundedCell>[0]),
                }),
            enabled,
            origin,
          }),
        ),
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
      const workspace = deps.getWorkspace();
      const dataset = workspace.datasets[input.datasetId as string];
      if (!dataset) {
        return invalidEntity('DATASET_NOT_FOUND', `Dataset '${String(input.datasetId)}' does not exist.`);
      }

      const offset = Math.trunc((input.offset as number | undefined) ?? 0);
      const limit = Math.trunc((input.limit as number | undefined) ?? 5);
      const columns = dataset.columns.slice(offset, offset + limit);
      // Page primary columns; only directly related schemas are included when requested.
      const related =
        input.includeRelated === true
          ? Object.values(workspace.relationships)
              .flatMap((relationship) => {
                const otherId = relatedDatasetId(relationship, dataset.id);
                const other = otherId === undefined ? undefined : workspace.datasets[otherId];

                return other === undefined ? [] : [{ relationshipId: relationship.id, dataset: other }];
              })
              .map(({ relationshipId, dataset: other }) => ({
                relationshipId,
                datasetId: other.id,
                name: other.name,
                columns: other.columns.map(({ id, name, logicalType }) => ({ id, name, logicalType })),
              }))
          : [];

      return success({
        revision: workspace.revision,
        summary: `${dataset.name} has ${dataset.columns.length} columns and ${dataset.rowCount ?? 0} rows${related.length === 0 ? '' : `, and is related to ${related.length} other datasets`}.`,
        datasetId: dataset.id,
        name: dataset.name,
        rowCount: dataset.rowCount,
        columns: columns.map(({ id, name, logicalType, databaseType, nullable }) => ({
          id,
          name,
          logicalType,
          databaseType,
          nullable,
        })),
        columnsReturned: columns.length,
        columnsTotal: dataset.columns.length,
        offset,
        nextOffset: offset + columns.length < dataset.columns.length ? offset + columns.length : null,
        ...(related.length === 0 ? {} : { related }),
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
      if (!dataset) {
        return invalidEntity('DATASET_NOT_FOUND', `Dataset '${datasetId}' does not exist.`);
      }
      const requested = input.columnIds as string[] | undefined;
      if (requested?.some((id) => !dataset.columns.some((column) => column.id === id))) {
        return invalidEntity('COLUMN_NOT_FOUND', 'One or more requested columns do not exist in the dataset.');
      }
      const result = await deps.fetchTableWindow({
        datasetId,
        offset: 0,
        limit: Math.min((input.limit as number | undefined) ?? 20, 100),
        filters: filtersFor(deps, datasetId),
      });
      if (!result.ok) {
        return failure(result.error);
      }
      const indexes =
        requested?.map((id) => result.value.columnIds.indexOf(id)) ?? result.value.columnIds.map((_, index) => index);
      const rows = result.value.rows.map((row) => indexes.map((index) => boundedCell(row[index] ?? null)));
      return success({
        revision: deps.getWorkspace().revision,
        summary: `Returned ${rows.length} of ${result.value.totalRowCount} rows.`,
        columnIds: indexes.map((index) => result.value.columnIds[index]),
        rows,
        rowsTotal: result.value.totalRowCount,
        /*
         * An explicitly requested projection is preserved when the response exceeds the budget: the
         * agent named these columns, so returning fewer rows keeps the answer usable, whereas dropping
         * a column forces a second call to recover a field it already asked for.
         */
        ...(requested === undefined ? {} : { [PRESERVE_COLUMNS_KEY]: true }),
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
      const workspace = deps.getWorkspace();
      const dataset = workspace.datasets[datasetId];
      if (!dataset) {
        return invalidEntity('DATASET_NOT_FOUND', `Dataset '${datasetId}' does not exist.`);
      }
      const dimensionInputs =
        (input.dimensions as
          | (string | { columnId: string; timeGrain: 'day' | 'week' | 'month' | 'quarter' | 'year' })[]
          | undefined) ?? [];
      const dimensions = dimensionInputs.flatMap((dimension) => (typeof dimension === 'string' ? [dimension] : []));
      const binnedDimensions = dimensionInputs.flatMap((dimension) =>
        typeof dimension === 'string'
          ? []
          : [{ columnId: dimension.columnId, strategy: { kind: 'temporal' as const, unit: dimension.timeGrain } }],
      );
      const measures = input.measures as MeasureSpec[];
      const columnIds = [
        ...dimensions,
        ...binnedDimensions.map((dimension) => dimension.columnId),
        ...measures.flatMap((measure) => (measure.columnId ? [measure.columnId] : [])),
      ];

      // Let the compiler report unreachable columns with NO_JOIN_PATH.
      const known = new Set(
        Object.values(workspace.datasets).flatMap((candidate) => candidate.columns.map((column) => column.id)),
      );
      if (columnIds.some((id) => !known.has(id))) {
        return invalidEntity('COLUMN_NOT_FOUND', 'One or more analysis columns do not exist in this workspace.');
      }

      const relationshipIds = input.relationshipIds as string[] | undefined;
      const query: AnalysisQuery = {
        datasetId,
        ...(relationshipIds === undefined ? {} : { relationshipIds }),
        dimensions,
        ...(binnedDimensions.length === 0 ? {} : { binnedDimensions }),
        measures,
        filters: analysisFiltersFor(deps, dataset.id),
        limit: Math.min((input.limit as number | undefined) ?? 50, 200),
      };
      const result = await deps.executeAnalysis(query);
      if (!result.ok) {
        return failure(result.error);
      }
      return success({
        revision: deps.getWorkspace().revision,
        summary: `Returned ${result.value.rows.length} aggregate rows.${result.value.warning === undefined ? '' : ` ${result.value.warning}`}`,
        columns: result.value.columns,
        rows: result.value.rows.map((row) => row.map(boundedCell)),
      });
    },
  },
];
