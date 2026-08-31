import { DEFAULT_LAYOUT_COLUMNS, type WorkspaceLayoutItem } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Default chart height in grid rows.
export const DEFAULT_ITEM_HEIGHT = 4;

// Places a new visualization in the first available grid slot.
export const placeNewVisualization = (
  items: readonly WorkspaceLayoutItem[],
  visualizationId: EntityId,
  columns: number = DEFAULT_LAYOUT_COLUMNS,
): WorkspaceLayoutItem[] => {
  // Floor the half-width so paired charts stay equal when the grid has an odd column count.
  const paired = Math.max(Math.floor(columns / 2), 1);

  if (items.length === 0) {
    return [{ visualizationId, x: 0, y: 0, width: columns, height: DEFAULT_ITEM_HEIGHT }];
  }

  // Narrow the full-width chart and place the new chart beside it.
  if (items.length === 1) {
    const [solo] = items as [WorkspaceLayoutItem];

    return [
      { ...solo, x: 0, width: paired },
      { visualizationId, x: paired, y: solo.y, width: paired, height: solo.height },
    ];
  }

  // Add later charts below the current content at half width.
  const bottom = items.reduce((lowest, item) => Math.max(lowest, item.y + item.height), 0);

  return [...items, { visualizationId, x: 0, y: bottom, width: paired, height: DEFAULT_ITEM_HEIGHT }];
};
