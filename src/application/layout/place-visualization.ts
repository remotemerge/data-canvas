import { DEFAULT_LAYOUT_COLUMNS, type WorkspaceLayoutItem } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/** Row span of a placed chart. Four rows is where a plot stops being a strip and reads as a chart. */
export const DEFAULT_ITEM_HEIGHT = 4;

/**
 * Places a newly created visualization, widening a lone chart to the full canvas.
 *
 * A single chart spans every column. Rendering it at half width because the grid *supports* two
 * columns wastes the canvas's main axis and is the layout's most visible flaw — a lone time series
 * gets half the horizontal resolution it could have. Once a second chart exists the two share a row
 * at half width each, and the first is narrowed to match so the pair stays even.
 *
 * Placement only: sizing an existing chart the user has deliberately resized is not this function's
 * business, which is why it is called on creation rather than on every layout change.
 */
export const placeNewVisualization = (
  items: readonly WorkspaceLayoutItem[],
  visualizationId: EntityId,
  columns: number = DEFAULT_LAYOUT_COLUMNS,
): WorkspaceLayoutItem[] => {
  // An odd column count rounds down and leaves the spare column unused, which keeps a pair even
  // rather than making one chart wider than its neighbour for no analytical reason.
  const paired = Math.max(Math.floor(columns / 2), 1);

  if (items.length === 0) {
    return [{ visualizationId, x: 0, y: 0, width: columns, height: DEFAULT_ITEM_HEIGHT }];
  }

  // The second chart turns a full-width solo chart into a pair, so the incumbent is narrowed and
  // the newcomer takes the other half of its row.
  if (items.length === 1) {
    const [solo] = items as [WorkspaceLayoutItem];

    return [
      { ...solo, x: 0, width: paired },
      { visualizationId, x: paired, y: solo.y, width: paired, height: solo.height },
    ];
  }

  // Beyond a pair, new charts stack below everything placed so far at half width, which lets the
  // grid flow them two per row.
  const bottom = items.reduce((lowest, item) => Math.max(lowest, item.y + item.height), 0);

  return [...items, { visualizationId, x: 0, y: bottom, width: paired, height: DEFAULT_ITEM_HEIGHT }];
};
