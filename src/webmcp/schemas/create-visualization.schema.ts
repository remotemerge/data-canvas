import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

/**
 * Bin strategies an agent may request.
 *
 * Duplicated rather than shared with `create-derived-column.schema.ts` because Ajv compiles each
 * tool schema independently and a `$ref` across files would need a resolver the registry does not
 * have. The bounds are asserted against the domain constants in the schema tests.
 */
const binStrategy = {
  oneOf: [
    {
      type: 'object',
      properties: { kind: { const: 'equalWidth' }, binCount: { type: 'integer', minimum: 2, maximum: 100 } },
      required: ['kind', 'binCount'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'equalWidthOf' }, width: { type: 'number', exclusiveMinimum: 0 } },
      required: ['kind', 'width'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'quantile' }, quantiles: { type: 'integer', minimum: 2, maximum: 20 } },
      required: ['kind', 'quantiles'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'explicit' },
        breaks: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 100 },
      },
      required: ['kind', 'breaks'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'temporal' },
        unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
      },
      required: ['kind', 'unit'],
      additionalProperties: false,
    },
  ],
} as const;

export const createVisualizationSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100, description: 'Dataset to visualize.' },
    kind: {
      type: 'string',
      enum: ['line', 'bar', 'area', 'scatter', 'donut', 'kpi', 'table', 'histogram', 'boxplot', 'heatmap'],
    },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    xColumnId: { type: 'string', minLength: 1, maxLength: 100 },
    yColumnIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    },
    groupByColumnId: { type: 'string', minLength: 1, maxLength: 100 },
    aggregate: {
      type: 'string',
      enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median', 'stddev'],
    },
    binX: { ...binStrategy, description: 'Buckets the x column. Required for a histogram.' },
    binSeries: { ...binStrategy, description: 'Buckets the grouping column. Only meaningful for a heatmap.' },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['datasetId', 'kind', 'title'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
