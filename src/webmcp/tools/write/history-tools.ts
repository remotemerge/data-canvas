import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

const createHistoryTool = (deps: ToolDependencies, operation: 'undo' | 'redo'): DataCanvasTool => ({
  name: operation,
  title: operation === 'undo' ? 'Undo workspace change' : 'Redo workspace change',
  description:
    operation === 'undo'
      ? 'Reverse the most recent reversible workspace change, whether a human or agent made it. Each call steps back one action, so call it repeatedly to unwind several. Prefer a targeted correction such as update_visualization or clear_filters when you know what to change, because undo may revert a later human edit.'
      : 'Reapply the change most recently reversed by undo. Use it only after undo. A new workspace change clears the redo history.',
  schema: toolSchemas[operation],
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
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
