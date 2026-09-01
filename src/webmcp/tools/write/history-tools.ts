import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

const createHistoryTool = (deps: ToolDependencies, operation: 'undo' | 'redo'): DataCanvasTool => ({
  name: operation,
  description:
    operation === 'undo'
      ? 'Undo the latest reversible workspace action.'
      : 'Redo the latest workspace action that was undone.',
  schema: toolSchemas[operation],
  annotations: { readOnlyHint: false },
  needsDataset: false,
  handler: async (raw) => {
    if (deps.history === undefined) {
      return failure(domainError('UNSUPPORTED_OPERATION', 'Workspace history is unavailable.'));
    }

    const input = asInput(raw);
    const result = await deps.history[operation](input.expectedRevision as number | undefined);
    return result.ok ? success({ ...result.value }) : failure(result.error);
  },
});

export const createHistoryTools = (deps: ToolDependencies): DataCanvasTool[] => [
  createHistoryTool(deps, 'undo'),
  createHistoryTool(deps, 'redo'),
];
