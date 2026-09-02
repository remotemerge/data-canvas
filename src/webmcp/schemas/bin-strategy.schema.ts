// Bin strategies shared by the visualization tools so a chart is created and re-binned with the same shape.
export const binStrategySchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'equalWidth' },
        binCount: { type: 'integer', minimum: 2, maximum: 100 },
      },
      required: ['kind', 'binCount'],
      additionalProperties: false,
      description: 'Splits the range into binCount buckets of equal width.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'equalWidthOf' },
        width: { type: 'number', exclusiveMinimum: 0 },
      },
      required: ['kind', 'width'],
      additionalProperties: false,
      description: 'Buckets of a fixed width in column units, such as 10-year age bands.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'quantile' },
        quantiles: { type: 'integer', minimum: 2, maximum: 20 },
      },
      required: ['kind', 'quantiles'],
      additionalProperties: false,
      description: 'Buckets holding equal row counts, such as 4 for quartiles.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'explicit' },
        breaks: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 100 },
      },
      required: ['kind', 'breaks'],
      additionalProperties: false,
      description: 'Buckets split at these exact boundary values.',
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'temporal' },
        unit: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'] },
      },
      required: ['kind', 'unit'],
      additionalProperties: false,
      description: 'Truncates a date or timestamp column to this calendar unit.',
    },
  ],
} as const;
