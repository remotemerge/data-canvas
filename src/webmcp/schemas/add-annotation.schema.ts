import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

// Anchor coordinates are chart-space values, so they stay scalar and bounded.
const anchorValue = {
  anyOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
} as const;

export const addAnnotationSchema = {
  type: 'object',
  properties: {
    visualizationId: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Visualization to annotate. Obtain from get_workspace.',
    },
    text: {
      type: 'string',
      minLength: 1,
      maxLength: 280,
      description: 'Plain-text note shown on the chart. Rendered as text, never as markup.',
    },
    anchor: {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['data'] },
            dimension: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
              description: 'Column ID whose value the note attaches to.',
            },
            value: anchorValue,
          },
          required: ['kind', 'dimension', 'value'],
          additionalProperties: false,
          description: 'Attaches the note to one value of a named column.',
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['point'] }, x: anchorValue, y: anchorValue },
          required: ['kind', 'x', 'y'],
          additionalProperties: false,
          description: 'Attaches the note to one x and y coordinate, such as a spike in a line chart.',
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['range'] }, from: anchorValue, to: anchorValue },
          required: ['kind', 'from', 'to'],
          additionalProperties: false,
          description: 'Attaches the note to a span along the x axis, such as a date range.',
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['category'] }, value: anchorValue },
          required: ['kind', 'value'],
          additionalProperties: false,
          description: 'Attaches the note to one category of a bar or donut chart.',
        },
      ],
      description: 'Where the note attaches to the chart. Pick the branch matching the chart kind.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      description:
        'Workspace revision this call assumes. The call fails with STALE_WORKSPACE_REVISION if the workspace moved on, which prevents annotating a chart a human just changed. Omit to apply unconditionally.',
    },
  },
  required: ['visualizationId', 'text', 'anchor'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
