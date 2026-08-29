import { expect, test } from 'bun:test';
import { createHarness, stubDataEngine, workspaceWithDataset } from '../application/action-fixtures.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';

const stripGeneratedIds = (value: unknown): unknown => {
  const ids = new Map<string, string>();
  let next = 0;
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string' && /^(flt|viz|sel)_[\w-]+$/u.test(item)) {
      if (!ids.has(item)) ids.set(item, `generated_${next++}`);
      return ids.get(item);
    }
    if (Array.isArray(item)) return item.map(visit);
    if (typeof item === 'object' && item !== null)
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
    return item;
  };
  return visit(value);
};

const pair = () => {
  const initial = workspaceWithDataset();
  const engine = stubDataEngine();
  const human = createHarness(structuredClone(initial), engine);
  const agent = createHarness(structuredClone(initial), engine);
  const tools = createToolDefinitions({
    dispatcher: agent.dispatcher,
    getWorkspace: agent.workspace,
    fetchTableWindow: (request) => engine.fetchTableWindow(request),
    executeAnalysis: (query) => engine.executeAnalysis(query),
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
