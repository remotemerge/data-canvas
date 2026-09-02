import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const listRelationshipsSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Limits the list to relationships touching this dataset. Omit to list all relationships.',
    },
    includeSuggestions: {
      type: 'boolean',
      description:
        'Also return candidate joins inferred from column names and types, each with a confidence score. Suggestions are proposals only; pass one to create_relationship to make it real. Defaults to false.',
    },
  },
  required: [],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
