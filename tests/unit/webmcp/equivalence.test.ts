import { expect, test } from 'bun:test';
import {
  createHarness,
  stubColumnStatistics,
  stubDataEngine,
  workspaceWithDataset,
  workspaceWithJoinableDatasets,
} from '../application/action-fixtures.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';

const stripGeneratedIds = (value: unknown): unknown => {
  const ids = new Map<string, string>();
  let next = 0;
  const visit = (item: unknown): unknown => {
    // Normalize generated derived IDs; readable fixture IDs are already stable.
    if (
      typeof item === 'string' &&
      (/^(flt|viz|sel|rel|mtr|ann)_[\w-]+$/u.test(item) ||
        /^col_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(item))
    ) {
      if (!ids.has(item)) {
        ids.set(item, `generated_${next++}`);
      }
      return ids.get(item);
    }
    if (Array.isArray(item)) {
      return item.map(visit);
    }
    if (typeof item === 'object' && item !== null) {
      return Object.fromEntries(
        Object.entries(item).map(([key, nested]) => [
          visit(key),
          key === 'updatedAt' || key === 'createdAt'
            ? 'timestamp'
            : (key === 'origin' || key === 'createdBy') && (nested === 'human' || nested === 'agent')
              ? 'actor'
              : visit(nested),
        ]),
      );
    }
    return item;
  };
  return visit(value);
};

const pair = (initial: Workspace = workspaceWithDataset()) => {
  const engine = stubDataEngine();
  const human = createHarness(structuredClone(initial), engine);
  const agent = createHarness(structuredClone(initial), engine);
  const tools = createToolDefinitions({
    dispatcher: agent.dispatcher,
    getWorkspace: agent.workspace,
    fetchTableWindow: (request) => engine.fetchTableWindow(request),
    executeAnalysis: (query) => engine.executeAnalysis(query),
    fetchColumnStatistics: stubColumnStatistics(engine, agent.workspace),
  });
  const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
  return { human, agent, tool };
};

test('human and agent filter paths produce the same workspace', async () => {
  const { human, agent, tool } = pair();
  await human.dispatcher.execute(
    {
      type: 'filter.apply',
      payload: { datasetId: 'ds_sales', columnId: 'col_region', operator: 'eq', value: 'Europe' },
    },
    { actor: 'human' },
  );
  await tool('apply_filter').handler({
    datasetId: 'ds_sales',
    columnId: 'col_region',
    operator: 'eq',
    value: 'Europe',
    expectedRevision: 0,
  });
  expect(stripGeneratedIds(agent.workspace())).toEqual(stripGeneratedIds(human.workspace()));
});

test('human and agent visualization paths produce the same workspace', async () => {
  const { human, agent, tool } = pair();
  const payload = {
    datasetId: 'ds_sales',
    title: 'Revenue',
    kind: 'line' as const,
    binding: { x: 'col_date', y: ['col_revenue'] },
  };
  await human.dispatcher.execute({ type: 'visualization.create', payload }, { actor: 'human' });
  await tool('create_visualization').handler({
    datasetId: 'ds_sales',
    title: 'Revenue',
    kind: 'line',
    xColumnId: 'col_date',
    yColumnIds: ['col_revenue'],
    expectedRevision: 0,
  });
  expect(stripGeneratedIds(agent.workspace())).toEqual(stripGeneratedIds(human.workspace()));
});

test('human and agent selection paths produce the same workspace', async () => {
  const { human, agent, tool } = pair();
  const predicate = { kind: 'comparison' as const, columnId: 'col_region', operator: 'in' as const, value: ['Europe'] };
  await human.dispatcher.execute(
    { type: 'selection.set', payload: { datasetId: 'ds_sales', mode: 'predicate', predicate, origin: 'agent' } },
    { actor: 'human' },
  );
  await tool('highlight_selection').handler({
    datasetId: 'ds_sales',
    columnId: 'col_region',
    values: ['Europe'],
    expectedRevision: 0,
  });
  expect(stripGeneratedIds(agent.workspace())).toEqual(stripGeneratedIds(human.workspace()));
});

test('human and agent relationship paths produce the same workspace', async () => {
  const { human, agent, tool } = pair(workspaceWithJoinableDatasets());
  const payload = {
    leftDatasetId: 'ds_orders',
    rightDatasetId: 'ds_customers',
    on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
    kind: 'many_to_one' as const,
    join: 'inner' as const,
  };

  await human.dispatcher.execute({ type: 'relationship.create', payload }, { actor: 'human' });
  await tool('create_relationship').handler({ ...payload, expectedRevision: 0 });

  expect(stripGeneratedIds(agent.workspace())).toEqual(stripGeneratedIds(human.workspace()));
});

test('an agent can chart across a relationship it created, matching the human path', async () => {
  const { human, agent, tool } = pair(workspaceWithJoinableDatasets());
  const relationship = {
    leftDatasetId: 'ds_orders',
    rightDatasetId: 'ds_customers',
    on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
    kind: 'many_to_one' as const,
    join: 'inner' as const,
  };
  const chart = {
    datasetId: 'ds_orders',
    title: 'Revenue by region',
    kind: 'bar' as const,
    binding: { x: 'col_customer_region', y: ['col_order_revenue'] },
  };

  await human.dispatcher.execute({ type: 'relationship.create', payload: relationship }, { actor: 'human' });
  await human.dispatcher.execute({ type: 'visualization.create', payload: chart }, { actor: 'human' });

  await tool('create_relationship').handler({ ...relationship, expectedRevision: 0 });
  await tool('create_visualization').handler({
    datasetId: 'ds_orders',
    title: 'Revenue by region',
    kind: 'bar',
    xColumnId: 'col_customer_region',
    yColumnIds: ['col_order_revenue'],
    expectedRevision: 1,
  });

  expect(stripGeneratedIds(agent.workspace())).toEqual(stripGeneratedIds(human.workspace()));
});

test('human and agent derived column paths produce the same workspace', async () => {
  const { human, agent, tool } = pair();
  const expression = {
    kind: 'arithmetic' as const,
    op: 'div' as const,
    left: { kind: 'column' as const, columnId: 'col_revenue' },
    right: { kind: 'column' as const, columnId: 'col_units' },
  };

  await human.dispatcher.execute(
    { type: 'derivedColumn.create', payload: { datasetId: 'ds_sales', name: 'Revenue per unit', expression } },
    { actor: 'human' },
  );
  await tool('create_derived_column').handler({
    datasetId: 'ds_sales',
    name: 'Revenue per unit',
    expression,
    expectedRevision: 0,
  });

  expect(stripGeneratedIds(agent.workspace())).toEqual(stripGeneratedIds(human.workspace()));
});

test('an agent can build a histogram over a derived column, matching the human path', async () => {
  const { human, agent, tool } = pair();
  const expression = { kind: 'datePart' as const, part: 'month' as const, columnId: 'col_date' };
  const binX = { kind: 'equalWidth' as const, binCount: 12 };
  const chart = {
    datasetId: 'ds_sales',
    title: 'Revenue distribution',
    kind: 'histogram' as const,
    binding: { x: 'col_revenue', binX },
    query: {
      datasetId: 'ds_sales',
      dimensions: [],
      binnedDimensions: [{ columnId: 'col_revenue', strategy: binX }],
      measures: [{ aggregate: 'count' as const }],
      filters: [],
    },
  };

  await human.dispatcher.execute(
    { type: 'derivedColumn.create', payload: { datasetId: 'ds_sales', name: 'Order month', expression } },
    { actor: 'human' },
  );
  await human.dispatcher.execute({ type: 'visualization.create', payload: chart }, { actor: 'human' });

  await tool('create_derived_column').handler({
    datasetId: 'ds_sales',
    name: 'Order month',
    expression,
    expectedRevision: 0,
  });
  await tool('create_visualization').handler({
    datasetId: 'ds_sales',
    title: 'Revenue distribution',
    kind: 'histogram',
    xColumnId: 'col_revenue',
    binX,
    expectedRevision: 1,
  });

  expect(stripGeneratedIds(agent.workspace())).toEqual(stripGeneratedIds(human.workspace()));
});

test('human and agent metric modifier paths produce the same workspace', async () => {
  const { human, agent, tool } = pair();
  const modifier = {
    kind: 'timeComparison' as const,
    dateColumnId: 'col_date',
    unit: 'month' as const,
    offset: 1,
    as: 'percentChange' as const,
  };

  await human.dispatcher.execute(
    {
      type: 'metric.create',
      payload: {
        datasetId: 'ds_sales',
        name: 'Revenue growth',
        aggregate: 'sum',
        columnId: 'col_revenue',
        modifier,
      },
    },
    { actor: 'human' },
  );
  await tool('create_metric').handler({
    datasetId: 'ds_sales',
    name: 'Revenue growth',
    aggregate: 'sum',
    columnId: 'col_revenue',
    modifier,
    expectedRevision: 0,
  });

  expect(stripGeneratedIds(agent.workspace())).toEqual(stripGeneratedIds(human.workspace()));
});
