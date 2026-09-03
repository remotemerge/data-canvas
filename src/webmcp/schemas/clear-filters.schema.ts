import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';
import { expectedRevisionSchema } from '@/webmcp/schemas/expected-revision.schema.ts';

export const clearFiltersSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description:
        'Clears only filters on this dataset. Omit to clear every filter in the workspace, including ones a human applied.',
    },
    expectedRevision: expectedRevisionSchema,
  },
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
