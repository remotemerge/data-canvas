import { expect, test } from 'bun:test';
import { createHarness, stubDataEngine, workspaceWithDataset } from '../unit/application/action-fixtures.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';

const normalize = (value: unknown): unknown => {
  const ids = new Map<string, string>();
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string' && /^(flt|viz|sel|mtr)_[\w-]+$/u.test(item)) {
      if (!ids.has(item)) ids.set(item, `generated_${ids.size}`);
      return ids.get(item);
    }
    if (Array.isArray(item)) return item.map(visit);
    if (typeof item !== 'object' || item === null) return item;
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
    fetchTableWindow: engine.fetchTableWindow,
    executeAnalysis: engine.executeAnalysis,
  });
  const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
  return { human, agent, tool };
};

test('human and real agent tool handlers produce equivalent canonical state', async () => {
  const cases = [
    {
      action: {
        type: 'filter.apply' as const,
        payload: { datasetId: 'ds_sales', columnId: 'col_region', operator: 'eq' as const, value: 'Europe' },
      },
      tool: 'apply_filter',
      input: {
        datasetId: 'ds_sales',
        columnId: 'col_region',
        operator: 'eq',
        value: 'Europe',
        expectedRevision: 0,
      },
    },
    {
      action: {
        type: 'visualization.create' as const,
        payload: {
          datasetId: 'ds_sales',
          title: 'Revenue',
          kind: 'line' as const,
          binding: { x: 'col_date', y: ['col_revenue'] },
          query: {
            datasetId: 'ds_sales',
            dimensions: ['col_date'],
            measures: [{ columnId: 'col_revenue', aggregate: 'sum' as const }],
            filters: [],
          },
        },
      },
      tool: 'create_visualization',
      input: {
        datasetId: 'ds_sales',
        title: 'Revenue',
        kind: 'line',
        xColumnId: 'col_date',
        yColumnIds: ['col_revenue'],
        expectedRevision: 0,
      },
    },
    {
      action: {
        type: 'selection.set' as const,
        payload: {
          datasetId: 'ds_sales',
          mode: 'predicate' as const,
          predicate: {
            kind: 'comparison' as const,
            columnId: 'col_region',
            operator: 'in' as const,
            value: ['Europe'],
          },
          origin: 'agent' as const,
        },
      },
      tool: 'highlight_selection',
      input: {
        datasetId: 'ds_sales',
        columnId: 'col_region',
        values: ['Europe'],
        expectedRevision: 0,
      },
    },
    {
      action: {
        type: 'metric.create' as const,
        payload: { datasetId: 'ds_sales', name: 'Total revenue', aggregate: 'sum' as const, columnId: 'col_revenue' },
      },
      tool: 'create_metric',
      input: {
        datasetId: 'ds_sales',
        name: 'Total revenue',
        aggregate: 'sum',
        columnId: 'col_revenue',
        expectedRevision: 0,
      },
    },
  ];

  await Promise.all(
    cases.map(async (item) => {
      const { human, agent, tool } = pair();
      const [humanResult, agentResult] = await Promise.all([
        human.dispatcher.execute(item.action, { actor: 'human' }),
        tool(item.tool).handler(item.input),
      ]);
      expect(humanResult.ok).toBe(true);
      expect(JSON.parse(agentResult).ok).toBe(true);
      expect(normalize(agent.workspace())).toEqual(normalize(human.workspace()));
    }),
  );
});
