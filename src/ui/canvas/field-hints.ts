/**
 * Plain-language descriptions of the analytical terms the chart and relationship forms use.
 *
 * The vocabulary of dimensions, measures, aggregates, and join types is the main barrier for someone
 * who is comfortable with their data but not with analytics tooling. These attach to labels as
 * tooltips: the builder wraps equal-height fields, so a paragraph under one control staggers the row.
 */
export const FIELD_HINT = {
  dimension: 'The column to group by, such as Region or Category. One mark appears per distinct value.',
  measure: 'The numeric column to summarize, such as Sales or Profit.',
  series: 'The column forming the other axis of the grid, giving one row per distinct value.',
  aggregate: 'How values are combined within each group: sum totals them, avg averages them.',
  join: 'Inner keeps only rows matched in both datasets; left keeps every row from the first.',
  cardinality: 'How many rows on each side share a key value, which determines whether a join can duplicate rows.',
} as const;
