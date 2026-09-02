import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const getDatasetSchemaSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Dataset whose columns to describe. Obtain from get_workspace.',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      maximum: 199,
      description: 'Index of the first column to return. Pass the nextOffset from the previous page.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 5,
      description: 'Columns per page, at most 5. Defaults to 5. Page until nextOffset is null.',
    },
    includeRelated: {
      type: 'boolean',
      description:
        'Also return columns of directly related datasets, so cross-dataset analysis can be planned in one call. Defaults to false.',
    },
  },
  required: ['datasetId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
