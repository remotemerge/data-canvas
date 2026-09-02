import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const historySchema = {
  type: 'object',
  properties: {
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents reverting an edit made after the one you intended to undo. Omit to apply unconditionally.',
    },
  },
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
