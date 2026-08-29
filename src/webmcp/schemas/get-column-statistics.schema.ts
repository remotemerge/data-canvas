import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const getColumnStatisticsSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    columnId: { type: 'string', minLength: 1, maxLength: 100 },
    topValueLimit: {
      type: 'integer',
      minimum: 1,
      maximum: 20,
      description: 'Frequent values to return for a text column. Values are dataset content.',
    },
  },
  required: ['datasetId', 'columnId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
