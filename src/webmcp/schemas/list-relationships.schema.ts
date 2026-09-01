import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const listRelationshipsSchema = {
  type: 'object',
  properties: {
    // Omitted lists all relationships; a dataset ID limits the list.
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    // Suggestions are proposals; listing them creates nothing.
    includeSuggestions: { type: 'boolean' },
  },
  required: [],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
