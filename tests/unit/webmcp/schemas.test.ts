import { describe, expect, test } from 'bun:test';
import { toolSchemas, toolValidators } from '@/webmcp/schemas/compile-schemas.ts';

const validInputs: Record<keyof typeof toolSchemas, { minimal: object; canonical: object }> = {
  get_workspace: { minimal: {}, canonical: {} },
  get_dataset_schema: { minimal: { datasetId: 'ds' }, canonical: { datasetId: 'ds_sales' } },
  preview_data: { minimal: { datasetId: 'ds' }, canonical: { datasetId: 'ds', columnIds: ['col'], limit: 20 } },
  analyze_data: {
    minimal: { datasetId: 'ds', measures: [{ aggregate: 'count' }] },
    canonical: {
      datasetId: 'ds',
      dimensions: ['region'],
      measures: [{ columnId: 'revenue', aggregate: 'sum' }],
      limit: 100,
    },
  },
  list_relationships: {
    minimal: {},
    canonical: { datasetId: 'ds_orders', includeSuggestions: true },
  },
  create_relationship: {
    minimal: {
      leftDatasetId: 'ds_orders',
      rightDatasetId: 'ds_customers',
      on: [{ leftColumnId: 'col_customer', rightColumnId: 'col_id' }],
      kind: 'many_to_one',
      join: 'inner',
    },
    canonical: {
      leftDatasetId: 'ds_orders',
      rightDatasetId: 'ds_customers',
      on: [{ leftColumnId: 'col_customer', rightColumnId: 'col_id' }],
      kind: 'many_to_one',
      join: 'left',
      expectedRevision: 3,
    },
  },
  create_visualization: {
    minimal: { datasetId: 'ds', kind: 'line', title: 'Chart' },
    canonical: {
      datasetId: 'ds',
      kind: 'line',
      title: 'Revenue',
      xColumnId: 'date',
      yColumnIds: ['revenue'],
      aggregate: 'sum',
      expectedRevision: 1,
    },
  },
  update_visualization: {
    minimal: { visualizationId: 'viz' },
    canonical: { visualizationId: 'viz', title: 'Updated', kind: 'bar', expectedRevision: 1 },
  },
  remove_visualization: {
    minimal: { visualizationId: 'viz' },
    canonical: { visualizationId: 'viz', expectedRevision: 1 },
  },
  apply_filter: {
    minimal: { datasetId: 'ds', columnId: 'col', operator: 'is_null' },
    canonical: { datasetId: 'ds', columnId: 'col', operator: 'eq', value: 'x', expectedRevision: 1 },
  },
  clear_filters: { minimal: {}, canonical: { datasetId: 'ds', expectedRevision: 1 } },
  highlight_selection: {
    minimal: { datasetId: 'ds', columnId: 'col', values: ['x'] },
    canonical: { datasetId: 'ds', columnId: 'col', values: ['x', 'y'], label: 'Focus', expectedRevision: 1 },
  },
  create_metric: {
    minimal: { datasetId: 'ds', name: 'Rows', aggregate: 'count' },
    canonical: {
      datasetId: 'ds',
      name: 'Revenue',
      aggregate: 'sum',
      columnId: 'revenue',
      filterIds: ['flt'],
      expectedRevision: 1,
    },
  },
  add_annotation: {
    minimal: { visualizationId: 'viz', text: 'Note', anchor: { kind: 'point', x: 1, y: 2 } },
    canonical: { visualizationId: 'viz', text: 'Peak', anchor: { kind: 'point', x: 1, y: 2 }, expectedRevision: 1 },
  },
};

const walkBounds = (schema: unknown): void => {
  if (typeof schema !== 'object' || schema === null) return;
  const node = schema as Record<string, unknown>;
  if (node['type'] === 'object') expect(node['additionalProperties']).toBe(false);
  if (node['type'] === 'array') expect(typeof node['maxItems']).toBe('number');
  if (node['type'] === 'string' && node['enum'] === undefined) expect(typeof node['maxLength']).toBe('number');
  for (const value of Object.values(node)) walkBounds(value);
};

describe('WebMCP canonical schemas', () => {
  for (const [name, schema] of Object.entries(toolSchemas) as [keyof typeof toolSchemas, object][]) {
    test(`${name} accepts canonical and minimal input`, () => {
      expect(toolValidators[name](validInputs[name].minimal)).toBe(true);
      expect(toolValidators[name](validInputs[name].canonical)).toBe(true);
    });

    test(`${name} rejects unknown properties and wrong root types`, () => {
      expect(toolValidators[name]({ ...validInputs[name].minimal, unknown: true })).toBe(false);
      expect(toolValidators[name]('wrong')).toBe(false);
    });

    test(`${name} bounds variable input`, () => walkBounds(schema));
  }
});

test('tool names and prohibited control fields stay out of the contract', () => {
  const serialized = JSON.stringify(toolSchemas);
  for (const name of Object.keys(toolSchemas)) expect(name.length).toBeLessThanOrEqual(30);
  for (const prohibited of ['sql', 'javascript', 'url', 'selector', 'echarts', 'zustand']) {
    expect(serialized.toLowerCase()).not.toContain(`"${prohibited}"`);
  }
});
