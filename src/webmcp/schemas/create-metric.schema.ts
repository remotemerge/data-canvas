import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

// Window transformations supported by metric creation.
const modifier = {
  oneOf: [
    {
      type: 'object',
      properties: { kind: { const: 'none' } },
      required: ['kind'],
      additionalProperties: false,
      description: 'Plain aggregate with no window transformation.',
    },
    {
      type: 'object',
      properties: { kind: { const: 'percentOfTotal' } },
      required: ['kind'],
      additionalProperties: false,
      description: 'Expresses each value as a share of the overall total.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'runningTotal' },
        orderBy: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: 'Column defining accumulation order, usually a date column.',
        },
      },
      required: ['kind', 'orderBy'],
      additionalProperties: false,
      description: 'Accumulates the aggregate in the order given by orderBy.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'timeComparison' },
        dateColumnId: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: 'Date column the comparison shifts along.',
        },
        unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
        offset: {
          type: 'integer',
          minimum: 1,
          maximum: 104,
          description: 'How many units back to compare against, such as 1 for the prior period.',
        },
        as: {
          type: 'string',
          enum: ['absolute', 'difference', 'percentChange'],
          description: 'Report the prior value, the raw change, or the percentage change.',
        },
      },
      required: ['kind', 'dateColumnId', 'unit', 'offset', 'as'],
      additionalProperties: false,
      description: 'Compares each period against an earlier one, for period-over-period reporting.',
    },
  ],
} as const;

export const createMetricSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Dataset the metric is computed over. Obtain from get_workspace.',
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      description: 'Display name for the metric, such as "Total revenue".',
    },
    aggregate: {
      type: 'string',
      enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median', 'stddev'],
      description: 'Aggregate applied to columnId. Use "count" to count rows without a column.',
    },
    columnId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Column to aggregate. Required for every aggregate except "count".',
    },
    filterIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      maxItems: 50,
      uniqueItems: true,
      description:
        'Existing filter IDs from get_workspace that scope this metric, for figures like revenue in one region. Omit to follow the workspace filters in effect.',
    },
    modifier: { ...modifier, description: 'Optional window transformation. Defaults to a plain aggregate.' },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents overwriting a concurrent human edit. Omit to apply unconditionally.',
    },
  },
  required: ['datasetId', 'name', 'aggregate'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
