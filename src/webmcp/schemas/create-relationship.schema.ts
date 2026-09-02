import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

// Agents supply dataset and column IDs; the application builds the join.
export const createRelationshipSchema = {
  type: 'object',
  properties: {
    leftDatasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Left dataset of the join, the "many" side for many_to_one. Obtain from get_workspace.',
    },
    rightDatasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Right dataset of the join, the "one" side for many_to_one. Obtain from get_workspace.',
    },
    on: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          leftColumnId: { type: 'string', minLength: 1, maxLength: 100, description: 'Key column in leftDatasetId.' },
          rightColumnId: { type: 'string', minLength: 1, maxLength: 100, description: 'Key column in rightDatasetId.' },
        },
        required: ['leftColumnId', 'rightColumnId'],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 4,
      description: 'Key column pairs matched to join the datasets. Supply several pairs for a composite key.',
    },
    kind: {
      type: 'string',
      enum: ['one_to_one', 'one_to_many', 'many_to_one'],
      description:
        'Cardinality from left to right. many_to_one is the common case, such as orders to customers. Choosing wrongly can multiply rows and inflate aggregates.',
    },
    join: {
      type: 'string',
      enum: ['inner', 'left'],
      description:
        'inner keeps only rows matched on both sides; left keeps every left row and leaves unmatched right columns null.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents overwriting a concurrent human edit. Omit to apply unconditionally.',
    },
  },
  required: ['leftDatasetId', 'rightDatasetId', 'on', 'kind', 'join'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
