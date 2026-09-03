import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const getWorkspaceSchema = {
  type: 'object',
  properties: {
    section: {
      type: 'string',
      enum: ['datasets', 'relationships', 'visualizations', 'filters', 'metrics', 'selections'],
      description:
        'Return only this section, paged with offset and limit, when the overview reports more entries than it returned. Omit for all sections.',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      description: 'Index of the first entry to return from section. Defaults to 0.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 50,
      description: 'Maximum entries to return from section. Defaults to 25.',
    },
  },
  required: [],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
