import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const listRelationshipsSchema = {
  type: 'object',
  properties: {
    /** Omitted lists every relationship; supplied narrows to those touching one dataset. */
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    /** Suggestions are proposals only. Listing them never creates anything. */
    includeSuggestions: { type: 'boolean' },
  },
  required: [],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
