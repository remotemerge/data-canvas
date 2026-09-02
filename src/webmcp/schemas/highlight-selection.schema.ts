import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const highlightSelectionSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    columnId: { type: 'string', minLength: 1, maxLength: 100 },
    // Selection values are compared against a single column, so only scalars are accepted.
    values: {
      type: 'array',
      items: {
        anyOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
      },
      minItems: 1,
      maxItems: 100,
    },
    operator: { type: 'string', enum: ['in'] },
    additive: {
      type: 'boolean',
      description: 'Adds to the current selection instead of replacing it.',
    },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['datasetId', 'columnId', 'values'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
