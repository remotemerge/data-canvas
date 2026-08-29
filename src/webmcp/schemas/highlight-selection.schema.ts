import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const highlightSelectionSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    columnId: { type: 'string', minLength: 1, maxLength: 100 },
    values: { type: 'array', items: {}, minItems: 1, maxItems: 100 },
    label: { type: 'string', maxLength: 160 },
    additive: {
      type: 'boolean',
      description: 'Adds to the current selection instead of replacing it.',
    },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['datasetId', 'columnId', 'values'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
