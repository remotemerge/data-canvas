import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';
import { expectedRevisionSchema } from '@/webmcp/schemas/expected-revision.schema.ts';

export const removeVisualizationSchema = {
  type: 'object',
  properties: {
    visualizationId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description:
        'Visualization to delete, along with its annotations. Obtain from get_workspace. Reversible with undo.',
    },
    expectedRevision: expectedRevisionSchema,
  },
  required: ['visualizationId'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
