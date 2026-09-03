import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';
import { binStrategySchema } from '@/webmcp/schemas/bin-strategy.schema.ts';
import { expectedRevisionSchema } from '@/webmcp/schemas/expected-revision.schema.ts';

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
        'Chart type, deciding how column channels are read. histogram requires binX. scatter, boxplot, and kpi use only the first yColumnIds entry.',
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
    binX: { ...binStrategySchema, description: 'Buckets xColumnId. Required for a histogram, optional elsewhere.' },
    binSeries: { ...binStrategySchema, description: 'Buckets groupByColumnId. Mainly useful for a heatmap.' },
    expectedRevision: expectedRevisionSchema,
  },
  required: ['datasetId', 'kind', 'title'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
