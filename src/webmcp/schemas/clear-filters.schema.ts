import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const clearFiltersSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description:
        'Clears only filters on this dataset. Omit to clear every filter in the workspace, including ones a human applied.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents overwriting a concurrent human edit. Omit to apply unconditionally.',
    },
  },
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
