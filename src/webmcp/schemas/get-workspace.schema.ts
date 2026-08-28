import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const getWorkspaceSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
