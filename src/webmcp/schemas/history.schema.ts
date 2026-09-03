import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const historySchema = {
  type: 'object',
  properties: {
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Revision from get_workspace this call assumes. Fails with STALE_WORKSPACE_REVISION if it moved on, so a later edit is not reverted by mistake.',
    },
  },
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
