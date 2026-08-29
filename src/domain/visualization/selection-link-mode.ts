/**
 * How a visualization responds to a selection made elsewhere in the workspace.
 *
 * Replaces an earlier `linkedSelection` boolean, which conflated *whether* a chart responds with
 * *how* it responds. Those are separate decisions: a chart may want to show the selected subset in
 * context (`highlight`) or restrict its analysis to it (`filter`), and the boolean could express
 * neither distinctly.
 */
export type SelectionLinkMode =
  /** Ignores selection entirely. */
  | 'none'
  /** Dims unselected marks while keeping the full result. */
  | 'highlight'
  /** Re-queries with the selection applied as a filter. */
  | 'filter';

export const SELECTION_LINK_MODES: readonly SelectionLinkMode[] = ['none', 'highlight', 'filter'] as const;

/**
 * The default for a newly created visualization.
 *
 * `highlight` keeps the chart's own totals stable while showing what is selected. `filter` changes
 * the numbers a chart reports, which is a stronger claim than a new chart should make unasked.
 */
export const DEFAULT_SELECTION_LINK_MODE: SelectionLinkMode = 'highlight';

export const isSelectionLinkMode = (value: unknown): value is SelectionLinkMode =>
  typeof value === 'string' && SELECTION_LINK_MODES.includes(value as SelectionLinkMode);
