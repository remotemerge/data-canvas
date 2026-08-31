// Modes for responding to selections made elsewhere.
export type SelectionLinkMode =
  // Ignores selection entirely.
  | 'none'
  // Dims unselected marks while keeping the full result.
  | 'highlight'
  // Re-queries with the selection applied as a filter.
  | 'filter';

export const SELECTION_LINK_MODES: readonly SelectionLinkMode[] = ['none', 'highlight', 'filter'] as const;

// Default mode for new visualizations.
export const DEFAULT_SELECTION_LINK_MODE: SelectionLinkMode = 'highlight';

export const isSelectionLinkMode = (value: unknown): value is SelectionLinkMode =>
  typeof value === 'string' && SELECTION_LINK_MODES.includes(value as SelectionLinkMode);
