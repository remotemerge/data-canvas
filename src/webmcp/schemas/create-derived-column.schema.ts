import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

// Recursive expression-node schema. Runtime depth and node-count limits are domain validation.
// Each branch declares its own object type; the wrapper needs no duplicate type.
const binStrategy = {
  oneOf: [
    {
      type: 'object',
      properties: { kind: { const: 'equalWidth' }, binCount: { type: 'integer', minimum: 2, maximum: 100 } },
      required: ['kind', 'binCount'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'equalWidthOf' }, width: { type: 'number', exclusiveMinimum: 0 } },
      required: ['kind', 'width'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'quantile' }, quantiles: { type: 'integer', minimum: 2, maximum: 20 } },
      required: ['kind', 'quantiles'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'explicit' },
        breaks: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 100 },
      },
      required: ['kind', 'breaks'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'temporal' },
        unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
      },
      required: ['kind', 'unit'],
      additionalProperties: false,
    },
  ],
} as const;

const expressionNode = {
  oneOf: [
    {
      type: 'object',
      properties: { kind: { const: 'column' }, columnId: { type: 'string', minLength: 1, maxLength: 100 } },
      required: ['kind', 'columnId'],
      additionalProperties: false,
    },
    // Use one schema branch per literal type so string length can be bounded.
    {
      type: 'object',
      properties: { kind: { const: 'literal' }, value: { type: 'number' } },
      required: ['kind', 'value'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'literal' }, value: { type: 'string', maxLength: 200 } },
      required: ['kind', 'value'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'literal' }, value: { type: 'boolean' } },
      required: ['kind', 'value'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { const: 'literal' }, value: { type: 'null' } },
      required: ['kind', 'value'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'arithmetic' },
        op: { type: 'string', enum: ['add', 'sub', 'mul', 'div'] },
        left: { $ref: '#/$defs/expression' },
        right: { $ref: '#/$defs/expression' },
      },
      required: ['kind', 'op', 'left', 'right'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'case' },
        when: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              left: { $ref: '#/$defs/expression' },
              operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] },
              right: { $ref: '#/$defs/expression' },
              result: { $ref: '#/$defs/expression' },
            },
            required: ['left', 'operator', 'right', 'result'],
            additionalProperties: false,
          },
        },
        otherwise: { $ref: '#/$defs/expression' },
      },
      required: ['kind', 'when', 'otherwise'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'datePart' },
        part: { type: 'string', enum: ['year', 'quarter', 'month', 'week', 'day', 'hour', 'dayOfWeek'] },
        columnId: { type: 'string', minLength: 1, maxLength: 100 },
      },
      required: ['kind', 'part', 'columnId'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'bin' },
        columnId: { type: 'string', minLength: 1, maxLength: 100 },
        strategy: { $ref: '#/$defs/binStrategy' },
      },
      required: ['kind', 'columnId', 'strategy'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'cast' },
        to: { type: 'string', enum: ['number', 'string', 'date'] },
        expr: { $ref: '#/$defs/expression' },
      },
      required: ['kind', 'to', 'expr'],
      additionalProperties: false,
    },
  ],
} as const;

export const createDerivedColumnSchema = {
  type: 'object',
  properties: {
    datasetId: { type: 'string', minLength: 1, maxLength: 100 },
    name: { type: 'string', minLength: 1, maxLength: 80, description: 'Display label for the new column.' },
    expression: { $ref: '#/$defs/expression' },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['datasetId', 'name', 'expression'],
  additionalProperties: false,
  $defs: { expression: expressionNode, binStrategy },
} as const satisfies JsonSchemaForInference;
