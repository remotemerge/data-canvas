import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const applyFilterSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    columnId: { type: 'string', minLength: 1, maxLength: 100 },
    operator: {
      type: 'string',
      enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'contains', 'is_null', 'is_not_null'],
    },
    value: {},
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['datasetId', 'columnId', 'operator'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
