import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

/**
 * The agent names datasets and columns; the compiler decides the SQL.
 *
 * There is deliberately no field here for a join condition, an expression, or a join kind beyond the
 * two the domain supports. An agent cannot describe a join the application would not have built for
 * a human doing the same thing through the relationship editor.
 */
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
