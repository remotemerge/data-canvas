import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const getDatasetSchemaSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    // Keep schema pages small; callers use nextOffset to request more columns.
    offset: { type: 'integer', minimum: 0, maximum: 199 },
    limit: { type: 'integer', minimum: 1, maximum: 5 },
    // Include columns from directly related datasets.
    includeRelated: { type: 'boolean' },
  },
  required: ['datasetId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
