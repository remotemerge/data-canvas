import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const getDatasetSchemaSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    // Include columns from directly related datasets.
    includeRelated: { type: 'boolean' },
  },
  required: ['datasetId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
