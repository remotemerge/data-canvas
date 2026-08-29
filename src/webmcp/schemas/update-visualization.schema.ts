import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const updateVisualizationSchema = {
  type: 'object',
  properties: {
    visualizationId: { type: 'string', minLength: 1, maxLength: 100 },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    kind: {
      type: 'string',
      enum: ['line', 'bar', 'area', 'scatter', 'donut', 'kpi', 'table', 'histogram', 'boxplot', 'heatmap'],
    },
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
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['visualizationId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
