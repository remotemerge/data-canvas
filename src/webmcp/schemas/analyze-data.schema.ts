import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const analyzeDataSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Dataset to aggregate. Obtain from get_workspace.',
    },
    relationshipIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      maxItems: 4,
      uniqueItems: true,
      description:
        'Restricts join-path resolution to these relationships when columns come from more than one dataset. Omit to let the engine resolve the path; supply when an ambiguous path returned NO_JOIN_PATH.',
    },
    dimensions: {
      type: 'array',
      items: {
        anyOf: [
          {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Column ID to group by verbatim.',
          },
          {
            type: 'object',
            properties: {
              columnId: { type: 'string', minLength: 1, maxLength: 100 },
              timeGrain: {
                type: 'string',
                enum: ['day', 'week', 'month', 'quarter', 'year'],
                description: 'Truncates a date or timestamp column to this grain before grouping.',
              },
            },
            required: ['columnId', 'timeGrain'],
            additionalProperties: false,
            description: 'Date column bucketed to a time grain, for trends over time.',
          },
        ],
      },
      maxItems: 3,
      uniqueItems: true,
      description:
        'Group-by columns. Omit or leave empty for a single total row across the dataset. Use the object form for dates to get one row per period.',
    },
    measures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          columnId: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            description: 'Column to aggregate. Omit only when aggregate is "count".',
          },
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
      description: 'At least one aggregate to compute. Use {"aggregate":"count"} to count rows.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      description: 'Maximum aggregate rows to return. Defaults to 50.',
    },
  },
  required: ['datasetId', 'measures'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
