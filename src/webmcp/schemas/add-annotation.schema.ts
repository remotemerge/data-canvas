import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

export const addAnnotationSchema = {
  type: 'object',
  properties: {
    visualizationId: { type: 'string', minLength: 1, maxLength: 100 },
    text: { type: 'string', minLength: 1, maxLength: 280 },
    anchor: {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['data'] },
            dimension: { type: 'string', minLength: 1, maxLength: 100 },
            value: {},
          },
          required: ['kind', 'dimension', 'value'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['point'] }, x: {}, y: {} },
          required: ['kind', 'x', 'y'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['range'] }, from: {}, to: {} },
          required: ['kind', 'from', 'to'],
          additionalProperties: false,
        },
      ],
    },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['visualizationId', 'text', 'anchor'],
  additionalProperties: false,
} as const satisfies JsonSchemaForInference;
