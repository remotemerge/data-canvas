import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

// Bin strategies accepted by visualization creation.
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
      description: 'Buckets of a fixed width in column units, such as 10-year age bands.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'quantile' },
        quantiles: { type: 'integer', minimum: 2, maximum: 20 },
      },
      required: ['kind', 'quantiles'],
      additionalProperties: false,
      description: 'Buckets holding equal row counts, such as 4 for quartiles.',
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

export const createVisualizationSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Dataset to visualize. Obtain from get_workspace.',
    },
    kind: {
      type: 'string',
      enum: ['line', 'bar', 'area', 'scatter', 'donut', 'kpi', 'table', 'histogram', 'boxplot', 'heatmap'],
      description:
        'Chart type, which decides how the column channels are read. line/area: trend of yColumnIds over xColumnId. bar/donut: yColumnIds aggregated per xColumnId category. scatter: one mark per row, xColumnId against the first yColumnIds entry, not aggregated. kpi: a single aggregated value from yColumnIds. table: rows of the chosen columns. histogram: distribution of xColumnId, requires binX. boxplot: spread of the first yColumnIds entry, optionally split by xColumnId. heatmap: yColumnIds aggregated across xColumnId and groupByColumnId.',
    },
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      description: 'Human-readable chart title shown in the workspace.',
    },
    xColumnId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description:
        'Column on the x axis: the category for bar/donut, the time axis for line/area, the binned column for histogram, the grouping category for boxplot.',
    },
    yColumnIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      description:
        'Measure columns on the y axis, aggregated with aggregate. Omit to plot a row count instead. scatter, boxplot, and kpi use only the first entry.',
    },
    groupByColumnId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Splits the data into one series per distinct value, and forms the second axis of a heatmap.',
    },
    aggregate: {
      type: 'string',
      enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median', 'stddev'],
      description:
        'How yColumnIds are aggregated per x value. Defaults to sum. Ignored by scatter and histogram, which do not aggregate.',
    },
    binX: { ...binStrategy, description: 'Buckets xColumnId. Required for a histogram, optional elsewhere.' },
    binSeries: { ...binStrategy, description: 'Buckets groupByColumnId. Mainly useful for a heatmap.' },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents overwriting a concurrent human edit. Omit to apply unconditionally.',
    },
  },
  required: ['datasetId', 'kind', 'title'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
