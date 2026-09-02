import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const removeVisualizationSchema = {
  type: 'object',
  properties: {
    visualizationId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description:
        'Visualization to delete, along with its annotations. Obtain from get_workspace. Reversible with undo.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents deleting a chart a human just changed. Omit to apply unconditionally.',
    },
  },
  required: ['visualizationId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
