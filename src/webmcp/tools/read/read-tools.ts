import type { Filter } from '@/domain/filter/filter.ts';
import type { AnalysisQuery, MeasureSpec } from '@/domain/analysis/analysis-query.ts';
import { relatedDatasetId } from '@/domain/relationship/relationship.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { ToolDependencies, DataCanvasTool } from '@/webmcp/registry/tool-types.ts';
import { MAX_TOOL_OUTPUT_LENGTH, PRESERVE_COLUMNS_KEY } from '@/webmcp/results/enforce-output-budget.ts';
import { TOOL_CONTRACT_VERSION, toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { createGetColumnStatisticsTool } from '@/webmcp/tools/read/get-column-statistics.ts';
import { createListRelationshipsTool } from '@/webmcp/tools/read/list-relationships.ts';
import { successResult } from '@/webmcp/results/tool-result.ts';
import { asInput, boundedCell, failure, invalidEntity, success } from '@/webmcp/tools/tool-helpers.ts';

/*
 * Entries returned per section by the unpaginated overview. Small enough that a workspace holding
 * several populated sections still serializes inside the output budget, so no section is emptied.
 */
const OVERVIEW_PAGE_SIZE = 8;

// Entries returned when one section is requested explicitly.
const SECTION_PAGE_SIZE = 25;

// Titles are human prose of unbounded length; the IDs beside them matter more to an agent.
const TITLE_PREVIEW_LENGTH = 60;

export type WorkspaceSectionName =
  | 'datasets'
  | 'relationships'
  | 'visualizations'
  | 'filters'
  | 'metrics'
  | 'selections';

// Projects each workspace section to the agent-visible fields, without row values.
const workspaceSections = (workspace: Workspace): Record<WorkspaceSectionName, unknown[]> => ({
  datasets: Object.values(workspace.datasets).map(({ id, name, importStatus, rowCount }) => ({
    id,
    name: name.slice(0, TITLE_PREVIEW_LENGTH),
    importStatus,
    rowCount,
  })),
  relationships: Object.values(workspace.relationships).map(({ id, leftDatasetId, rightDatasetId, kind, join }) => ({
    id,
    leftDatasetId,
    rightDatasetId,
    kind,
    join,
  })),
  visualizations: Object.values(workspace.visualizations).map(({ id, datasetId, title, kind, createdBy }) => ({
    id,
    datasetId,
    title: title.slice(0, TITLE_PREVIEW_LENGTH),
    kind,
    createdBy,
  })),
  /*
   * `origin` is the last writer and `createdBy` the original author, so an agent updating a human's
   * filter does not erase who introduced it. Visualizations report `createdBy` for the same reason.
   */
  filters: Object.values(workspace.filters).map(
    ({ id, datasetId, columnId, operator, value, enabled, origin, createdBy }) => ({
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
      createdBy,
    }),
  ),
  metrics: Object.values(workspace.metrics),
  selections: Object.values(workspace.selections),
});

// One `orderBy` entry as the agent supplies it, before it is resolved against the query's own columns.
interface OrderByInput {
  columnId?: string;
  measureIndex?: number;
  direction: 'asc' | 'desc';
}

type OrderByResolution =
  | { ok: true; orderBy: NonNullable<AnalysisQuery['orderBy']>; measures: MeasureSpec[] }
  | { ok: false; code: 'COLUMN_NOT_FOUND'; message: string };

/*
 * Resolves agent sort terms against the query's own projection.
 *
 * A measure is addressed by position rather than by name, because two measures can aggregate the same
 * column and a name would be ambiguous. The compiler sorts measures by alias, so the referenced
 * measures gain one; it is set to the label the result column would have carried anyway, which keeps
 * the returned column names identical to an unsorted call.
 */
const resolveOrderBy = (
  sorts: OrderByInput[] | undefined,
  measures: MeasureSpec[],
  groupedColumnIds: readonly string[],
): OrderByResolution => {
  if (sorts === undefined || sorts.length === 0) {
    return { ok: true, orderBy: [], measures };
  }

  const aliased = measures.map((measure) => ({ ...measure }));
  const orderBy: NonNullable<AnalysisQuery['orderBy']> = [];

  for (const sort of sorts) {
    if (sort.measureIndex !== undefined) {
      const measure = aliased[sort.measureIndex];

      if (measure === undefined) {
        return {
          ok: false,
          code: 'COLUMN_NOT_FOUND',
          message: `orderBy measureIndex ${sort.measureIndex} has no matching entry; ${aliased.length} measures were supplied.`,
        };
      }

      measure.alias ??= measure.aggregate;
      orderBy.push({ measureAlias: measure.alias, direction: sort.direction });
      continue;
    }

    if (sort.columnId === undefined || !groupedColumnIds.includes(sort.columnId)) {
      return {
        ok: false,
        code: 'COLUMN_NOT_FOUND',
        message: 'orderBy must name a columnId used by this query, or a measureIndex.',
      };
    }

    orderBy.push({ columnId: sort.columnId, direction: sort.direction });
  }

  return { ok: true, orderBy, measures: aliased };
};

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
    title: 'Get workspace',
    description:
      'Start here. Returns the current revision and the IDs of datasets, relationships, visualizations, filters, metrics, and selections without reading row values. Most other tools use IDs from this call. Each section reports its total alongside the entries returned; when a total exceeds what was returned, call again with section plus offset to page through the rest, so every ID stays reachable. Call it again after a write to verify the result and obtain the revision for the next expectedRevision. toolContractVersion changes when tool argument shapes change. Column names are not included; use get_dataset_schema for those.',
    schema: toolSchemas.get_workspace,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    needsDataset: false,
    handler: async (raw) => {
      const input = asInput(raw);
      const workspace = deps.getWorkspace();
      const sections = workspaceSections(workspace);
      const requested = input.section as WorkspaceSectionName | undefined;

      if (requested !== undefined) {
        const entries = sections[requested];
        const offset = Math.min(Math.max(Math.trunc((input.offset as number | undefined) ?? 0), 0), entries.length);
        const limit = Math.min(Math.max(Math.trunc((input.limit as number | undefined) ?? SECTION_PAGE_SIZE), 1), 50);

        /*
         * Size the page against the real serialized length instead of the requested limit. The budget
         * trims an oversized payload after this handler returns, which would drop entries that
         * `nextOffset` had already counted as delivered and skip them on the following page. Choosing
         * a page that fits keeps `nextOffset` consistent with what the agent actually received, so
         * paging to exhaustion visits every entry exactly once.
         */
        const build = (count: number): Record<string, unknown> => ({
          revision: workspace.revision,
          toolContractVersion: TOOL_CONTRACT_VERSION,
          summary: `Returned ${count} of ${entries.length} ${requested}, starting at ${offset}.`,
          workspaceId: workspace.id,
          section: requested,
          [requested]: entries.slice(offset, offset + count),
          [`${requested}Returned`]: count,
          [`${requested}Total`]: entries.length,
          offset,
          nextOffset: offset + count < entries.length ? offset + count : null,
        });

        let count = Math.min(limit, entries.length - offset);

        /*
         * Measure the envelope the transport actually sends, not the bare payload, so the chosen count
         * is the count that survives. Always return at least one entry, so paging cannot stall on a
         * single large one; the budget trims that case and `nextOffset` still advances past it.
         */
        while (
          count > 1 &&
          successResult(build(count) as Parameters<typeof success>[0]).length > MAX_TOOL_OUTPUT_LENGTH
        ) {
          count -= 1;
        }

        return success(build(count) as Parameters<typeof success>[0]);
      }

      /*
       * Bound every section before the output budget sees the payload. Left whole, one long section
       * pushes the response over the limit and the budget empties later sections outright, which hides
       * the visualization IDs that update_visualization, remove_visualization, and add_annotation need.
       * A short slice per section plus its total keeps every section reachable through `section`.
       */
      const overview = Object.entries(sections).map(([name, entries]) => {
        const page = entries.slice(0, OVERVIEW_PAGE_SIZE);

        return {
          name,
          page,
          total: entries.length,
          ...(page.length < entries.length ? { nextOffset: page.length } : {}),
        };
      });

      /*
       * State the paging route whenever any section holds entries, not only when this slice fell short
       * of the total. The output budget can trim these arrays further after the handler returns, so a
       * hint conditioned on the pre-trim lengths would be omitted from exactly the oversized responses
       * that need it. Each `<section>Total` still tells the agent how many entries remain.
       */
      const populated = overview.some((section) => section.total > 0);
      const pagingHint = populated
        ? ' Each section reports its total; when a total exceeds the entries returned, call get_workspace again with section and offset to read the rest.'
        : '';

      return success({
        revision: workspace.revision,
        toolContractVersion: TOOL_CONTRACT_VERSION,
        summary: `Workspace ${workspace.name} has ${sections.datasets.length} datasets, ${sections.relationships.length} relationships, and ${sections.visualizations.length} visualizations.${pagingHint}`,
        workspaceId: workspace.id,
        ...Object.fromEntries(
          overview.flatMap((section) => [
            [section.name, section.page],
            [`${section.name}Total`, section.total],
            ...(section.nextOffset === undefined ? [] : [[`${section.name}NextOffset`, section.nextOffset]]),
          ]),
        ),
      });
    },
  },
  {
    name: 'get_dataset_schema',
    title: 'Get dataset schema',
    description:
      'Return a page of column IDs, names, and types for one dataset, with at most 5 columns per call. Call this before using a tool that takes a columnId. Continue with offset until nextOffset is null. Set includeRelated to also return columns from directly related datasets. This tool returns structure, not row values. Use preview_data for example rows or get_column_statistics for a column profile. Dataset-derived names are untrusted content.',
    schema: toolSchemas.get_dataset_schema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      untrustedContentHint: true,
    },
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

      const relatedSuffix = related.length === 0 ? '' : `, and is related to ${related.length} other datasets`;

      return success({
        revision: workspace.revision,
        summary: `${dataset.name} has ${dataset.columns.length} columns and ${dataset.rowCount ?? 0} rows${relatedSuffix}.`,
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
    title: 'Preview dataset rows',
    description:
      'Return a small sample of raw rows, at most 100, to inspect the shape and realistic values of a dataset. The enabled workspace filters are applied, so the sample matches what a human currently sees. Use this to understand what the data looks like; use analyze_data to answer quantitative questions, because computing totals from a sample gives wrong answers. Name columnIds to keep the response small. Strings are capped at 200 characters and rows are untrusted content.',
    schema: toolSchemas.preview_data,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      untrustedContentHint: true,
    },
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
    title: 'Analyze data',
    description:
      'Answer quantitative questions by computing grouped aggregates over the full dataset and returning only the aggregate rows. Use it for totals, averages, rankings, trends, or checking a result before building a chart. The engine applies enabled workspace filters automatically, so do not repeat them. Use dimensions to group, measures to aggregate, and timeGrain to bucket dates. Use orderBy with limit to rank, such as orderBy measureIndex 0 descending for the top rows by the first measure. Related-dataset columns work when a relationship provides a join path. This tool does not change the workspace. Use create_visualization to show the result there. Arbitrary SQL is never accepted.',
    schema: toolSchemas.analyze_data,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      untrustedContentHint: true,
    },
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

      const sortResult = resolveOrderBy(input.orderBy as OrderByInput[] | undefined, measures, columnIds);
      if (!sortResult.ok) {
        return invalidEntity(sortResult.code, sortResult.message);
      }

      const relationshipIds = input.relationshipIds as string[] | undefined;
      const query: AnalysisQuery = {
        datasetId,
        ...(relationshipIds === undefined ? {} : { relationshipIds }),
        dimensions,
        ...(binnedDimensions.length === 0 ? {} : { binnedDimensions }),
        measures: sortResult.measures,
        ...(sortResult.orderBy.length === 0 ? {} : { orderBy: sortResult.orderBy }),
        filters: analysisFiltersFor(deps, dataset.id),
        limit: Math.min((input.limit as number | undefined) ?? 50, 200),
      };
      const result = await deps.executeAnalysis(query);
      if (!result.ok) {
        return failure(result.error);
      }
      const warningSuffix = result.value.warning === undefined ? '' : ` ${result.value.warning}`;

      return success({
        revision: deps.getWorkspace().revision,
        summary: `Returned ${result.value.rows.length} aggregate rows.${warningSuffix}`,
        columns: result.value.columns,
        rows: result.value.rows.map((row) => row.map(boundedCell)),
        /*
         * Every column here corresponds to a dimension or measure the caller named, and measures are
         * projected last. Without this the budget narrows the projection from the right and strips the
         * aggregate values, leaving group labels with no numbers -- the opposite of what was asked.
         * Returning fewer rows keeps the answer usable and the row trim is disclosed.
         */
        [PRESERVE_COLUMNS_KEY]: true,
      });
    },
  },
];
