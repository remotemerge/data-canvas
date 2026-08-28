export const buildDonutSeries = (dimension: string | undefined, measure: string | undefined) => [
  {
    type: 'pie' as const,
    radius: ['45%', '70%'],
    encode: { itemName: dimension, value: measure, tooltip: [dimension, measure] },
  },
];
