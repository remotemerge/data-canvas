import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const analyzeDataSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    // Optional relationship IDs used to constrain join-path resolution.
    relationshipIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      maxItems: 4,
      uniqueItems: true,
    },
    dimensions: {
      type: 'array',
      items: {
        anyOf: [
          { type: 'string', minLength: 1, maxLength: 100 },
          {
            type: 'object',
            properties: {
              columnId: { type: 'string', minLength: 1, maxLength: 100 },
              timeGrain: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
            },
            required: ['columnId', 'timeGrain'],
            additionalProperties: false,
          },
        ],
      },
      maxItems: 3,
      uniqueItems: true,
    },
    measures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          columnId: { type: 'string', minLength: 1, maxLength: 100 },
          aggregate: {
            type: 'string',
            enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median', 'stddev'],
          },
        },
        required: ['aggregate'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 6,
    },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  },
  required: ['datasetId', 'measures'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
