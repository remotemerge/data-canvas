import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

// Agents supply dataset and column IDs; the application builds the join.
export const createRelationshipSchema = {
  type: 'object',
  properties: {
    leftDatasetId: { type: 'string', minLength: 1, maxLength: 100 },
    rightDatasetId: { type: 'string', minLength: 1, maxLength: 100 },
    on: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          leftColumnId: { type: 'string', minLength: 1, maxLength: 100 },
          rightColumnId: { type: 'string', minLength: 1, maxLength: 100 },
        },
        required: ['leftColumnId', 'rightColumnId'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 4,
    },
    kind: { type: 'string', enum: ['one_to_one', 'one_to_many', 'many_to_one'] },
    join: { type: 'string', enum: ['inner', 'left'] },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['leftDatasetId', 'rightDatasetId', 'on', 'kind', 'join'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
