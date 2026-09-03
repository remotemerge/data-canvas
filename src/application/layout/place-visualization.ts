import { chartsPerRow } from '@/application/layout/canvas-density.ts';
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

  /*
   * Later charts fill the half-width slot beside the chart on the bottom row before opening a new
   * one, so the canvas keeps two charts per row instead of leaving every row after the first pair
   * half empty.
   */
  const bottom = items.reduce((lowest, item) => Math.max(lowest, item.y + item.height), 0);
  const lastRow = items.filter((item) => item.y + item.height === bottom);
  const rowWidth = lastRow.reduce((used, item) => Math.max(used, item.x + item.width), 0);
  const rowTop = lastRow.reduce((highest, item) => Math.min(highest, item.y), bottom);
  const fits = rowWidth + paired <= columns;

  return [
    ...items,
    {
      visualizationId,
      x: fits ? rowWidth : 0,
      y: fits ? rowTop : bottom,
      width: paired,
      // A chart joining an existing row matches its height so the pair stays aligned.
      height: fits ? bottom - rowTop : DEFAULT_ITEM_HEIGHT,
    },
  ];
};

// Tallest chart on a row, which decides where the row below it begins.
const rowHeight = (row: readonly WorkspaceLayoutItem[]): number =>
  row.reduce((tallest, item) => Math.max(tallest, item.height), DEFAULT_ITEM_HEIGHT);

/**
 * Reflows layout items onto a canvas with a different column count.
 *
 * A density change previously altered only the column count, leaving items at coordinates measured
 * against the old grid: a chart at `x: 6` overflowed a 6-column canvas, which the layout action
 * rejects and the renderer draws as a sliver at the edge.
 *
 * Items keep their reading order and flow left to right, so a denser canvas fits more charts per row
 * and each one is visibly narrower. See `canvas-density.ts` for why density changes charts per row
 * rather than rescaling each span.
 */
export const refitLayoutColumns = (
  items: readonly WorkspaceLayoutItem[],
  fromColumns: number,
  toColumns: number,
): WorkspaceLayoutItem[] => {
  if (fromColumns === toColumns || items.length === 0) {
    return [...items];
  }

  const perRow = chartsPerRow(toColumns);
  // Divide the canvas evenly; a column count that is not a multiple leaves the remainder unused.
  const width = Math.max(Math.floor(toColumns / perRow), 1);
  /*
   * Reading order lives in the stored coordinates rather than the array order, which the store keys
   * by insertion. Sorting by row then column keeps a reflow from shuffling the canvas.
   */
  const ordered = items.toSorted((left, right) => left.y - right.y || left.x - right.x);

  let y = 0;

  return ordered.map((item, index) => {
    const column = index % perRow;

    // Each new row clears the tallest chart on the row above, so a resized chart is never overlapped.
    if (column === 0 && index > 0) {
      y += rowHeight(ordered.slice(index - perRow, index));
    }

    return { ...item, x: column * width, y, width };
  });
};
