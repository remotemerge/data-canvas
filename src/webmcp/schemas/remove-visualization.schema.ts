import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const removeVisualizationSchema = {
  type: 'object',
  properties: {
    visualizationId: { type: 'string', minLength: 1, maxLength: 100 },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['visualizationId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
