import { describe, expect, test } from 'bun:test';
import { placeNewVisualization } from '@/application/layout/place-visualization.ts';
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
    // Same row: a pair sits side by side rather than stacking.
    expect(items[0]?.y).toBe(items[1]?.y as number);
  });

  test('a third visualization stacks below the pair at half width', () => {
    const pair = placeNewVisualization(placeNewVisualization([], id('vis_1')), id('vis_2'));
    const items = placeNewVisualization(pair, id('vis_3'));

    expect(items).toHaveLength(3);
    expect(items[2]).toEqual({ visualizationId: id('vis_3'), x: 0, y: 4, width: 6, height: 4 });
  });

  test('placement respects a non-default column count', () => {
    const items = placeNewVisualization([], id('vis_1'), 24);

    expect(items[0]?.width).toBe(24);
  });

  /* An odd grid cannot split evenly, so the pair rounds down and the spare column goes unused. */
  test('an odd column count still fits both charts of a pair', () => {
    const solo: WorkspaceLayoutItem[] = placeNewVisualization([], id('vis_1'), 11);
    const items = placeNewVisualization(solo, id('vis_2'), 11);

    expect(items[0]?.width).toBe(5);
    expect(items[1]).toMatchObject({ x: 5, width: 5 });
    // The layout handler rejects an item overflowing the grid, so the pair must stay inside it.
    expect((items[1]?.x as number) + (items[1]?.width as number)).toBeLessThanOrEqual(11);
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

  /* `sum` is the default reading of a quantity, so naming it would add words without meaning. */
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
  });
});
