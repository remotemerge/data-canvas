import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const highlightSelectionSchema = {
  type: 'object',
  properties: {
    datasetId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Dataset whose rows to highlight. Obtain from get_workspace.',
    },
    columnId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Column the values are matched against. Obtain from get_dataset_schema.',
    },
    // Selection values are compared against a single column, so only scalars are accepted.
    values: {
      type: 'array',
      items: {
        anyOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
      },
      minItems: 1,
      maxItems: 100,
      description:
        'Values to match in columnId; rows matching any of them are highlighted. Use get_column_statistics topValues to discover valid values.',
    },
    additive: {
      type: 'boolean',
      description:
        'Adds these rows to the existing selection instead of replacing it. Defaults to false, which replaces the selection.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents overwriting a concurrent human edit. Omit to apply unconditionally.',
    },
  },
  required: ['datasetId', 'columnId', 'values'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
