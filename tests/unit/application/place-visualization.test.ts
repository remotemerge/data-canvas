import { describe, expect, test } from 'bun:test';
import { CANVAS_DENSITIES, chartsPerRow, COLUMNS_PER_CHART } from '@/application/layout/canvas-density.ts';
import { placeNewVisualization, refitLayoutColumns } from '@/application/layout/place-visualization.ts';
import { suggestVisualizationTitle } from '@/application/layout/visualization-title.ts';
import { DEFAULT_LAYOUT_COLUMNS, type WorkspaceLayoutItem } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

const id = (name: string) => name as EntityId;

describe('canvas placement', () => {
  test('a lone visualization spans the whole canvas', () => {
    const items = placeNewVisualization([], id('vis_1'));

    expect(items).toEqual([{ visualizationId: 'vis_1', x: 0, y: 0, width: DEFAULT_LAYOUT_COLUMNS, height: 4 }]);
  });

  test('a second visualization narrows the first so the pair shares one row', () => {
    const items = placeNewVisualization(placeNewVisualization([], id('vis_1')), id('vis_2'));

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ visualizationId: 'vis_1', x: 0, width: 6 });
    expect(items[1]).toMatchObject({ visualizationId: 'vis_2', x: 6, width: 6 });
    // Pair charts on the same row.
    expect(items[0]?.y).toBe(items[1]?.y as number);
  });

  test('a third visualization opens the next row at half width', () => {
    const pair = placeNewVisualization(placeNewVisualization([], id('vis_1')), id('vis_2'));
    const items = placeNewVisualization(pair, id('vis_3'));

    expect(items).toHaveLength(3);
    expect(items[2]).toEqual({ visualizationId: id('vis_3'), x: 0, y: 4, width: 6, height: 4 });
  });

  /*
   * Every chart after the second used to open its own row at half width, leaving the right half of
   * the canvas permanently empty. A new chart fills the free slot beside the last one instead.
   */
  test('a fourth visualization pairs beside the third instead of opening a row', () => {
    const three = [id('vis_1'), id('vis_2'), id('vis_3')].reduce<WorkspaceLayoutItem[]>(
      (items, visualizationId) => placeNewVisualization(items, visualizationId),
      [],
    );
    const items = placeNewVisualization(three, id('vis_4'));

    expect(items[3]).toEqual({ visualizationId: id('vis_4'), x: 6, y: 4, width: 6, height: 4 });
    // The pair shares one row.
    expect(items[3]?.y).toBe(items[2]?.y as number);
  });

  test('charts keep filling two per row as the canvas grows', () => {
    const ids = ['vis_1', 'vis_2', 'vis_3', 'vis_4', 'vis_5', 'vis_6'].map(id);
    const items = ids.reduce<WorkspaceLayoutItem[]>(
      (placed, visualizationId) => placeNewVisualization(placed, visualizationId),
      [],
    );

    expect(items.map((item) => [item.x, item.y])).toEqual([
      [0, 0],
      [6, 0],
      [0, 4],
      [6, 4],
      [0, 8],
      [6, 8],
    ]);
  });

  // A row whose chart was resized taller keeps its pair aligned rather than overlapping it.
  test('a chart joining a resized row matches that row height', () => {
    const pair = placeNewVisualization(placeNewVisualization([], id('vis_1')), id('vis_2'));
    const taller = placeNewVisualization(pair, id('vis_3')).map((item) =>
      item.visualizationId === id('vis_3') ? { ...item, height: 6 } : item,
    );
    const items = placeNewVisualization(taller, id('vis_4'));

    expect(items[3]).toMatchObject({ x: 6, y: 4, height: 6 });
  });

  test('placement respects a non-default column count', () => {
    const items = placeNewVisualization([], id('vis_1'), 24);

    expect(items[0]?.width).toBe(24);
  });

  // Odd grids leave one spare column.
  test('an odd column count still fits both charts of a pair', () => {
    const solo: WorkspaceLayoutItem[] = placeNewVisualization([], id('vis_1'), 11);
    const items = placeNewVisualization(solo, id('vis_2'), 11);

    expect(items[0]?.width).toBe(5);
    expect(items[1]).toMatchObject({ x: 5, width: 5 });
    // Keep paired charts within the grid.
    expect((items[1]?.x as number) + (items[1]?.width as number)).toBeLessThanOrEqual(11);
  });
});

describe('refitting the canvas to a new column count', () => {
  test('an unchanged column count leaves every item where it was', () => {
    const items: WorkspaceLayoutItem[] = [{ visualizationId: id('vis_1'), x: 6, y: 0, width: 6, height: 4 }];

    expect(refitLayoutColumns(items, 12, 12)).toEqual(items);
  });

  /*
   * The grid splits one canvas width into `columns` fractions, so preserving each chart's fraction
   * would render every density identically and make the control look inert. Comfortable therefore
   * gives each chart a full row.
   */
  test('the comfortable canvas puts one full-width chart on each row', () => {
    const items: WorkspaceLayoutItem[] = [
      { visualizationId: id('vis_1'), x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_2'), x: 6, y: 0, width: 6, height: 4 },
    ];

    expect(refitLayoutColumns(items, 12, 6)).toEqual([
      { visualizationId: id('vis_1'), x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_2'), x: 0, y: 4, width: 6, height: 4 },
    ]);
  });

  test('the compact canvas fits three charts to a row', () => {
    const items: WorkspaceLayoutItem[] = [
      { visualizationId: id('vis_1'), x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_2'), x: 6, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_3'), x: 0, y: 4, width: 6, height: 4 },
      { visualizationId: id('vis_4'), x: 6, y: 4, width: 6, height: 4 },
    ];

    expect(refitLayoutColumns(items, 12, 18).map((item) => [item.x, item.y, item.width])).toEqual([
      [0, 0, 6],
      [6, 0, 6],
      [12, 0, 6],
      [0, 4, 6],
    ]);
  });

  // Reading order is what the canvas preserves, so a chart's row and column decide where it lands.
  test('items are reflowed in reading order rather than array order', () => {
    const items: WorkspaceLayoutItem[] = [
      { visualizationId: id('vis_late'), x: 0, y: 4, width: 6, height: 4 },
      { visualizationId: id('vis_first'), x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_second'), x: 6, y: 0, width: 6, height: 4 },
    ];

    expect(refitLayoutColumns(items, 12, 6).map((item) => item.visualizationId)).toEqual([
      id('vis_first'),
      id('vis_second'),
      id('vis_late'),
    ]);
  });

  // A taller chart must not have the next row drawn over the top of it.
  test('the next row clears the tallest chart on the row above', () => {
    const items: WorkspaceLayoutItem[] = [
      { visualizationId: id('vis_1'), x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_2'), x: 6, y: 0, width: 6, height: 7 },
      { visualizationId: id('vis_3'), x: 0, y: 8, width: 6, height: 4 },
    ];
    // Two charts per row, so the third opens a row below the seven-row-tall second chart.
    const refitted = refitLayoutColumns(items, 18, 12);

    expect(refitted[1]).toMatchObject({ x: 6, y: 0 });
    expect(refitted[2]).toMatchObject({ x: 0, y: 7 });
  });

  /*
   * The layout action rejects any item reaching past the last column, so a refit that overflowed
   * would make the density control fail on canvases it should handle. This is the invariant behind
   * the original defect, checked across every preset transition and canvas size rather than one case.
   */
  test('no refitted item ever overflows the canvas', () => {
    const presetColumns = CANVAS_DENSITIES.map((density) => density.columns);

    for (const from of presetColumns) {
      for (const to of presetColumns) {
        for (const count of [1, 2, 3, 4, 7, 12]) {
          const items = Array.from({ length: count }, (_unused, index) =>
            placeNewVisualization([], id(`vis_${index}`), from),
          ).flat();
          const refitted = refitLayoutColumns(items, from, to);

          expect(refitted).toHaveLength(count);
          for (const item of refitted) {
            expect(item.x).toBeGreaterThanOrEqual(0);
            expect(item.width).toBeGreaterThanOrEqual(1);
            expect(item.x + item.width).toBeLessThanOrEqual(to);
            expect(item.height).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  // Charts sharing a row must not overlap, or the grid would stack them on the same column.
  test('charts on the same row occupy distinct column spans', () => {
    const items = [0, 1, 2, 3, 4, 5].reduce<WorkspaceLayoutItem[]>(
      (placed, index) => placeNewVisualization(placed, id(`vis_${index}`)),
      [],
    );
    const byRow = new Map<number, WorkspaceLayoutItem[]>();

    for (const item of refitLayoutColumns(items, 12, 18)) {
      byRow.set(item.y, [...(byRow.get(item.y) ?? []), item]);
    }

    for (const row of byRow.values()) {
      const starts = row.map((item) => item.x);

      expect(new Set(starts).size).toBe(row.length);
    }
  });

  /*
   * A column count outside the presets reaches the canvas through the layout WebMCP tool and any
   * restored workspace, so it must still divide into whole charts rather than throwing or overflowing.
   */
  test('a column count outside the presets still divides into whole charts', () => {
    const items: WorkspaceLayoutItem[] = [
      { visualizationId: id('vis_1'), x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_2'), x: 6, y: 0, width: 6, height: 4 },
    ];
    // Twenty-four columns holds four charts of the standard six-column span.
    const refitted = refitLayoutColumns(items, 12, 24);

    expect(refitted.map((item) => [item.x, item.y, item.width])).toEqual([
      [0, 0, 6],
      [6, 0, 6],
    ]);
  });

  // A canvas narrower than one chart still has to render it rather than collapse it to zero columns.
  test('a canvas narrower than a single chart keeps one chart per row', () => {
    const items: WorkspaceLayoutItem[] = [
      { visualizationId: id('vis_1'), x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_2'), x: 6, y: 0, width: 6, height: 4 },
    ];

    expect(refitLayoutColumns(items, 12, 2)).toEqual([
      { visualizationId: id('vis_1'), x: 0, y: 0, width: 2, height: 4 },
      { visualizationId: id('vis_2'), x: 0, y: 4, width: 2, height: 4 },
    ]);
  });

  test('an empty canvas refits to an empty canvas', () => {
    expect(refitLayoutColumns([], 12, 6)).toEqual([]);
  });

  // Refitting must not mutate the stored layout, which the store treats as immutable state.
  test('refitting leaves the original items untouched', () => {
    const items: WorkspaceLayoutItem[] = [
      { visualizationId: id('vis_1'), x: 0, y: 0, width: 6, height: 4 },
      { visualizationId: id('vis_2'), x: 6, y: 0, width: 6, height: 4 },
    ];
    const snapshot = structuredClone(items);

    refitLayoutColumns(items, 12, 6);

    expect(items).toEqual(snapshot);
  });
});

describe('canvas density presets', () => {
  // The control and the reflow must read one table, or buttons and layout would disagree.
  test('every preset divides evenly into whole charts', () => {
    for (const density of CANVAS_DENSITIES) {
      expect(density.columns).toBe(density.chartsPerRow * COLUMNS_PER_CHART);
      expect(chartsPerRow(density.columns)).toBe(density.chartsPerRow);
    }
  });

  // The default canvas must be one of the offered presets, or no button would appear selected.
  test('the default column count matches a preset', () => {
    expect(CANVAS_DENSITIES.some((density) => density.columns === DEFAULT_LAYOUT_COLUMNS)).toBe(true);
  });

  test('presets are ordered from fewest to most charts per row', () => {
    const perRow = CANVAS_DENSITIES.map((density) => density.chartsPerRow);

    expect(perRow).toEqual(perRow.toSorted((left, right) => left - right));
  });

  test('a column count below one chart still reports a single chart per row', () => {
    expect(chartsPerRow(1)).toBe(1);
    expect(chartsPerRow(COLUMNS_PER_CHART - 1)).toBe(1);
  });
});

describe('suggested visualization titles', () => {
  test('names the measure and dimension analytically', () => {
    expect(
      suggestVisualizationTitle({
        kind: 'line',
        measureName: 'Sales',
        dimensionName: 'Order Date',
        aggregate: 'sum',
      }),
    ).toBe('Sales by Order Date');
  });

  // The default sum needs no title label.
  test('omits sum but names an aggregate that changes the number', () => {
    expect(
      suggestVisualizationTitle({ kind: 'bar', measureName: 'Sales', dimensionName: 'Region', aggregate: 'avg' }),
    ).toBe('Average Sales by Region');
  });

  test('a histogram is titled by the column it bins', () => {
    expect(suggestVisualizationTitle({ kind: 'histogram', dimensionName: 'Profit' })).toBe('Distribution of Profit');
  });

  test('a box plot names its spread, with or without a category', () => {
    expect(suggestVisualizationTitle({ kind: 'boxplot', measureName: 'Profit' })).toBe('Spread of Profit');
    expect(suggestVisualizationTitle({ kind: 'boxplot', measureName: 'Profit', dimensionName: 'Region' })).toBe(
      'Spread of Profit by Region',
    );
  });

  test('an unbound chart suggests nothing rather than a meaningless title', () => {
    expect(suggestVisualizationTitle({ kind: 'line' })).toBe('');
    // A box plot describes the spread of a measure, so a category alone names nothing to spread.
    expect(suggestVisualizationTitle({ kind: 'boxplot', dimensionName: 'Region' })).toBe('');
    // A histogram is titled by the column it bins, so it has no title without one.
    expect(suggestVisualizationTitle({ kind: 'histogram' })).toBe('');
  });
});
