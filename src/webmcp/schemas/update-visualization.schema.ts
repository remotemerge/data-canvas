import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';
import { binStrategySchema } from '@/webmcp/schemas/bin-strategy.schema.ts';
import { expectedRevisionSchema } from '@/webmcp/schemas/expected-revision.schema.ts';

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
    binX: { ...binStrategySchema, description: 'Replaces the bucketing of the x column.' },
    binSeries: { ...binStrategySchema, description: 'Replaces the bucketing of the grouping column.' },
    linkMode: {
      type: 'string',
      enum: ['none', 'highlight', 'filter'],
      description:
        'How this chart reacts to a selection made elsewhere: ignore it, dim rows outside it, or filter down to it.',
    },
    expectedRevision: expectedRevisionSchema,
  },
  required: ['visualizationId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
