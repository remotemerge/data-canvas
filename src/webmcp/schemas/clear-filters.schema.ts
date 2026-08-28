import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const clearFiltersSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
