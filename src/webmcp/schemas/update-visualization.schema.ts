import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

// Mirrors the bin strategies accepted by create_visualization so a chart can be re-binned in place.
const binStrategy = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'equalWidth' },
        binCount: { type: 'integer', minimum: 2, maximum: 100 },
      },
      required: ['kind', 'binCount'],
      additionalProperties: false,
      description: 'Splits the range into binCount buckets of equal width.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'equalWidthOf' },
        width: { type: 'number', exclusiveMinimum: 0 },
      },
      required: ['kind', 'width'],
      additionalProperties: false,
      description: 'Buckets of a fixed width in column units.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'quantile' },
        quantiles: { type: 'integer', minimum: 2, maximum: 20 },
      },
      required: ['kind', 'quantiles'],
      additionalProperties: false,
      description: 'Buckets holding equal row counts.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'explicit' },
        breaks: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 100 },
      },
      required: ['kind', 'breaks'],
      additionalProperties: false,
      description: 'Buckets split at these exact boundary values.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'temporal' },
        unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
      },
      required: ['kind', 'unit'],
      additionalProperties: false,
      description: 'Truncates a date or timestamp column to this calendar unit.',
    },
  ],
} as const;

export const updateVisualizationSchema = {
  type: 'object',
  properties: {
    visualizationId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Visualization to modify. Obtain from get_workspace.',
    },
    title: { type: 'string', minLength: 1, maxLength: 120, description: 'Replaces the chart title.' },
    kind: {
      type: 'string',
      enum: ['line', 'bar', 'area', 'scatter', 'donut', 'kpi', 'table', 'histogram', 'boxplot', 'heatmap'],
      description:
        'Replaces the chart type, reinterpreting the existing column channels. See create_visualization for how each kind reads them.',
    },
    xColumnId: { type: 'string', minLength: 1, maxLength: 100, description: 'Replaces the x-axis column.' },
    yColumnIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      description: 'Replaces the measure columns.',
    },
    groupByColumnId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Replaces the series-splitting column.',
    },
    aggregate: {
      type: 'string',
      enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median', 'stddev'],
      description: 'Replaces how the measure columns are aggregated.',
    },
    binX: { ...binStrategy, description: 'Replaces the bucketing of the x column.' },
    binSeries: { ...binStrategy, description: 'Replaces the bucketing of the grouping column.' },
    linkMode: {
      type: 'string',
      enum: ['none', 'highlight', 'filter'],
      description:
        'How this chart reacts to a selection made elsewhere: ignore it, dim rows outside it, or filter down to it.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents overwriting a concurrent human edit. Omit to apply unconditionally.',
    },
  },
  required: ['visualizationId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
