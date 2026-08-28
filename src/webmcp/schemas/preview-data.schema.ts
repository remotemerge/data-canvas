import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const previewDataSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    columnIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      maxItems: 50,
      uniqueItems: true,
    },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  required: ['datasetId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
