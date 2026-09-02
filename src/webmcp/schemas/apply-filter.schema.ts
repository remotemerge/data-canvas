import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

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
        'Comparison to apply. "between" takes a two-element [low, high] value; "in" and "not_in" take an array; "is_null" and "is_not_null" take no value; "contains" matches a substring of a text column.',
    },
    value: {
      description:
        'Value to compare against, shaped by operator: a scalar for eq/neq/gt/gte/lt/lte/contains, a two-element array for between, an array for in/not_in. Omit entirely for is_null and is_not_null. Values are bound as parameters and never become SQL text.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents overwriting a concurrent human edit. Omit to apply unconditionally.',
    },
  },
  required: ['datasetId', 'columnId', 'operator'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
