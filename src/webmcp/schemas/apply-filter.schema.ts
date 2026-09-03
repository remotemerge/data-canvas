import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';
import { expectedRevisionSchema } from '@/webmcp/schemas/expected-revision.schema.ts';

export const applyFilterSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Dataset to filter. Obtain from get_workspace.',
    },
    columnId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Column to filter on. Obtain from get_dataset_schema.',
    },
    operator: {
      type: 'string',
      enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'contains', 'is_null', 'is_not_null'],
      description:
        'Comparison to apply. "contains" matches a substring of a text column. See value for the shape each operator expects.',
    },
    value: {
      description:
        'Per operator: a scalar for eq/neq/gt/gte/lt/lte/contains, a [low, high] pair for between, an array for in/not_in, omitted for is_null/is_not_null.',
    },
    expectedRevision: expectedRevisionSchema,
  },
  required: ['datasetId', 'columnId', 'operator'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
