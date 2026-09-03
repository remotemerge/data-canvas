/**
 * Canvas density: how many charts share one row.
 *
 * The canvas grid divides a single width into `columns` equal fractions, so a chart's on-screen size
 * comes from the fraction it spans, not from the column count alone. Scaling spans in proportion to a
 * new column count therefore leaves every chart exactly as wide as before, which makes the density
 * control appear to do nothing. Density instead changes how many charts fit on a row.
 *
 * Columns stay a multiple of `COLUMNS_PER_CHART` so every preset divides evenly and no row leaves a
 * partial column unused.
 */

// Grid columns one chart spans. Shared by every preset so charts stay a consistent proportion.
export const COLUMNS_PER_CHART = 6;

export interface CanvasDensity {
  label: string;
  // Total grid columns, which is `chartsPerRow * COLUMNS_PER_CHART`.
  columns: number;
  chartsPerRow: number;
}

// Presets offered by the density control, ordered from widest charts to most charts per row.
export const CANVAS_DENSITIES: readonly CanvasDensity[] = [
  { label: 'Comfortable', columns: COLUMNS_PER_CHART, chartsPerRow: 1 },
  { label: 'Balanced', columns: COLUMNS_PER_CHART * 2, chartsPerRow: 2 },
  { label: 'Compact', columns: COLUMNS_PER_CHART * 3, chartsPerRow: 3 },
] as const;

/**
 * Charts that share a row on a canvas of this width.
 *
 * A column count outside the presets still needs an answer, because the layout WebMCP tool and a
 * restored workspace may both carry one. Such a count divides by the per-chart span, which keeps
 * charts the same proportion the presets use, and clamps to at least one chart per row so a canvas
 * narrower than a single chart still renders it.
 */
export const chartsPerRow = (columns: number): number => {
  const preset = CANVAS_DENSITIES.find((density) => density.columns === columns);

  return preset?.chartsPerRow ?? Math.max(Math.floor(columns / COLUMNS_PER_CHART), 1);
};
