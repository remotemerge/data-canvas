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
        'Also return candidate joins inferred from column names and types, scored by confidence. Pass one to create_relationship to make it real.',
    },
  },
  required: [],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
