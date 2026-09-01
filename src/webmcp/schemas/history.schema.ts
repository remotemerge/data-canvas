import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const historySchema = {
  type: 'object',
  properties: {
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
