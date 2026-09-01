import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

// Window transformations supported by metric creation.
const modifier = {
  oneOf: [
    { type: 'object', properties: { kind: { const: 'none' } }, required: ['kind'], additionalProperties: false },
    {
      type: 'object',
      properties: { kind: { const: 'percentOfTotal' } },
      required: ['kind'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'runningTotal' },
        orderBy: { type: 'string', minLength: 1, maxLength: 100 },
      },
      required: ['kind', 'orderBy'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'timeComparison' },
        dateColumnId: { type: 'string', minLength: 1, maxLength: 100 },
        unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
        offset: { type: 'integer', minimum: 1, maximum: 104 },
        as: { type: 'string', enum: ['absolute', 'difference', 'percentChange'] },
      },
      required: ['kind', 'dateColumnId', 'unit', 'offset', 'as'],
      additionalProperties: false,
    },
  ],
} as const;

export const createMetricSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    aggregate: {
      type: 'string',
      enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median', 'stddev'],
    },
    columnId: { type: 'string', minLength: 1, maxLength: 100 },
    filterIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      maxItems: 50,
      uniqueItems: true,
    },
    modifier,
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['datasetId', 'name', 'aggregate'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
