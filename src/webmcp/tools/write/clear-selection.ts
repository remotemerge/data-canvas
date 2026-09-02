import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

export const createClearSelectionTool = (deps: ToolDependencies): DataCanvasTool => ({
  name: 'clear_selection',
  title: 'Clear selection',
  description:
    'Remove the row emphasis created by highlight_selection, returning every chart to its unselected state. Pass a datasetId to clear one dataset, or omit it to clear every selection, including one a human made. This affects highlighting only and never removes filters; use clear_filters for those.',
  schema: toolSchemas.clear_selection,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  needsDataset: false,
  handler: async (raw) => {
    const input = asInput(raw);
    const datasetId = input.datasetId as string | undefined;
    const expectedRevision = input.expectedRevision as number | undefined;
    const result = await deps.dispatcher.execute(
      {
        type: 'selection.clear',
        payload: datasetId === undefined ? {} : { datasetId },
      },
      {
        actor: 'agent',
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      },
    );

    return result.ok ? success({ ...result.value }) : failure(result.error);
  },
});
