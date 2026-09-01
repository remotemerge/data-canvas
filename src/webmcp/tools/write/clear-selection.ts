import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

export const createClearSelectionTool = (deps: ToolDependencies): DataCanvasTool => ({
  name: 'clear_selection',
  description: 'Clear the current selection for one dataset, or clear all selections when no dataset ID is supplied.',
  schema: toolSchemas.clear_selection,
  annotations: { readOnlyHint: false },
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
