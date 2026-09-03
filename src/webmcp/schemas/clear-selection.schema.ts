import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';
import { expectedRevisionSchema } from '@/webmcp/schemas/expected-revision.schema.ts';

export const clearSelectionSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description:
        'Clears only the selection on this dataset. Omit to clear every selection in the workspace, including one a human made.',
    },
    expectedRevision: expectedRevisionSchema,
  },
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
