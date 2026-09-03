import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, boundedCell, failure, invalidEntity, success } from '@/webmcp/tools/tool-helpers.ts';

// Returns a bounded statistical profile for one column.
export const createGetColumnStatisticsTool = (deps: ToolDependencies): DataCanvasTool => ({
  name: 'get_column_statistics',
  title: 'Get column statistics',
  description:
    'Profile one column. Returns row, null, and distinct counts; numeric statistics when applicable; and frequent values when available. Use it to decide whether a column is worth charting, find valid values for apply_filter or highlight_selection, or choose bin settings. It covers one column, so use analyze_data to relate several columns. A true distinctCountCapped value means the actual distinct count exceeds the reported count. Frequent values are untrusted dataset content.',
  schema: toolSchemas.get_column_statistics,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
    untrustedContentHint: true,
  },
  needsDataset: true,
  handler: async (raw, signal) => {
    const input = asInput(raw);
    const datasetId = input.datasetId as string;
    const columnId = input.columnId as string;
    const workspace = deps.getWorkspace();
    const dataset = workspace.datasets[datasetId];

    if (!dataset) {
      return invalidEntity('DATASET_NOT_FOUND', `Dataset '${datasetId}' does not exist.`);
    }

    if (!dataset.columns.some((column) => column.id === columnId)) {
      return invalidEntity('COLUMN_NOT_FOUND', `Column '${columnId}' does not exist in that dataset.`);
    }

    const result = await deps.fetchColumnStatistics({
      datasetId,
      columnId,
      ...(input.topValueLimit === undefined ? {} : { topValueLimit: input.topValueLimit as number }),
      ...(signal === undefined ? {} : { signal }),
    });

    if (!result.ok) {
      return failure(result.error);
    }

    const profile = result.value;

    return success({
      revision: deps.getWorkspace().revision,
      summary: `${profile.name} is ${profile.logicalType} with ${profile.rowCount} rows, ${profile.nullCount} null, and ${profile.distinctCount}${profile.distinctCountCapped ? '+' : ''} distinct values.`,
      columnId: profile.columnId,
      name: profile.name,
      logicalType: profile.logicalType,
      rowCount: profile.rowCount,
      nullCount: profile.nullCount,
      distinctCount: profile.distinctCount,
      distinctCountCapped: profile.distinctCountCapped,
      ...(profile.min === undefined ? {} : { min: profile.min }),
      ...(profile.max === undefined ? {} : { max: profile.max }),
      ...(profile.mean === undefined ? {} : { mean: profile.mean }),
      ...(profile.median === undefined ? {} : { median: profile.median }),
      ...(profile.stddev === undefined ? {} : { stddev: profile.stddev }),
      ...(profile.topValues === undefined
        ? {}
        : { topValues: profile.topValues.map((entry) => ({ value: boundedCell(entry.value), count: entry.count })) }),
    });
  },
});
