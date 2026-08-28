import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const createVisualizationSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100, description: 'Dataset to visualize.' },
    kind: { type: 'string', enum: ['line', 'bar', 'area', 'scatter', 'donut', 'kpi', 'table'] },
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
    aggregate: { type: 'string', enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'median'] },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['datasetId', 'kind', 'title'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
