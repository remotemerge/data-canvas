import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const previewDataSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Dataset to sample. Obtain from get_workspace.',
    },
    columnIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      maxItems: 50,
      uniqueItems: true,
      description:
        'Columns to return, in order. Omit for all columns. Naming the few columns you need keeps rows from being dropped by the output budget.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: 'Maximum rows to return. Defaults to 20. Fewer rows may return if the output budget is reached.',
    },
  },
  required: ['datasetId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
