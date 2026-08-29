import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const getDatasetSchemaSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    /** Includes columns from directly related datasets, so an agent can plan a join in one call. */
    includeRelated: { type: 'boolean' },
  },
  required: ['datasetId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
