import type { JsonSchemaForInference } from '@mcp-b/webmcp-types';

/**
 * The recursive expression-node schema.
 *
 * Ajv resolves `#/$defs/expression` recursively, so the tree's *shape* is fully described here. What
 * JSON Schema cannot express is a maximum recursion depth or a total node count, so both are
 * enforced in domain validation instead. Ajv accepting a tree is necessary, not sufficient.
 *
 * Every node's `kind` is a closed enum and no branch carries free-form text that becomes SQL. The
 * only strings are literal values and identifiers, and both are bound as parameters.
 */
// No `type` on the wrapper: each branch already declares `type: 'object'`, and repeating it here
// would be an object node with no properties of its own to bound.
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
    /*
     * One branch per literal type rather than a union `type`.
     *
     * Ajv's strict mode rejects a union type keyword, and `allowUnionTypes` would relax it for
     * every schema rather than this one field. Separate branches also let the string case carry its
     * own `maxLength`, which a union cannot express.
     */
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
