import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';
import { expectedRevisionSchema } from '@/webmcp/schemas/expected-revision.schema.ts';

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
        'Cardinality from left to right. many_to_one is common, such as orders to customers. Choosing wrongly multiplies rows and inflates aggregates.',
    },
    join: {
      type: 'string',
      enum: ['inner', 'left'],
      description:
        'inner keeps only rows matched on both sides; left keeps every left row and leaves unmatched right columns null.',
    },
    expectedRevision: expectedRevisionSchema,
  },
  required: ['leftDatasetId', 'rightDatasetId', 'on', 'kind', 'join'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
