import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const createMetricSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    aggregate: { type: 'string', enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median'] },
    columnId: { type: 'string', minLength: 1, maxLength: 100 },
    filterIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      maxItems: 50,
      uniqueItems: true,
    },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['datasetId', 'name', 'aggregate'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
