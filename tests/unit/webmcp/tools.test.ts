import { describe, expect, test } from 'bun:test';
import type { ModelContext } from '@mcp-b/webmcp-types';
import { createHarness, stubDataEngine, workspaceWithDataset } from '../application/action-fixtures.ts';
import { createToolDefinitions, createToolRegistry } from '@/webmcp/registry/tool-registry.ts';
import type { ToolDependencies } from '@/webmcp/registry/tool-types.ts';

const setup = () => {
  const engine = stubDataEngine();
  const harness = createHarness(workspaceWithDataset(), engine);
  const deps: ToolDependencies = {
    dispatcher: harness.dispatcher,
    getWorkspace: harness.workspace,
    fetchTableWindow: (request) => engine.fetchTableWindow(request),
    executeAnalysis: (query) => engine.executeAnalysis(query),
  };
  const tools = createToolDefinitions(deps);
  const tool = (name: string) => {
    const found = tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Missing tool ${name}`);
    return found;
  };
  return { harness, deps, tool };
};

describe('WebMCP semantic tool behavior', () => {
  test('unknown entities return stable corrective codes', async () => {
    const { tool } = setup();
    expect(JSON.parse(await tool('get_dataset_schema').handler({ datasetId: 'missing' }))).toMatchObject({
      ok: false,
      code: 'DATASET_NOT_FOUND',
    });
    expect(
      JSON.parse(await tool('preview_data').handler({ datasetId: 'ds_sales', columnIds: ['missing'] })),
    ).toMatchObject({ ok: false, code: 'COLUMN_NOT_FOUND' });
  });

  test('semantic conflicts and stale writes mutate nothing', async () => {
    const { harness, tool } = setup();
    const initial = structuredClone(harness.workspace());
    expect(
      JSON.parse(
        await tool('apply_filter').handler({
          datasetId: 'ds_sales',
          columnId: 'col_revenue',
          operator: 'contains',
          value: 'x',
          expectedRevision: 0,
        }),
      ),
    ).toMatchObject({ ok: false, code: 'INCOMPATIBLE_COLUMN' });
    expect(
      JSON.parse(
        await tool('create_metric').handler({
          datasetId: 'ds_sales',
          name: 'Rows',
          aggregate: 'count',
          expectedRevision: 99,
        }),
      ),
    ).toMatchObject({ ok: false, code: 'STALE_WORKSPACE_REVISION' });
    expect(harness.workspace()).toEqual(initial);
  });

  test('preview requests and returned strings remain bounded', async () => {
    const { tool } = setup();
    const output = await tool('preview_data').handler({ datasetId: 'ds_sales', limit: 100 });
    expect(output.length).toBeLessThanOrEqual(1500);
  });

  test('registry rejects malformed input before dispatch', async () => {
    const { harness, deps } = setup();
    const executions = new Map<string, (input: unknown) => unknown>();
    const host = {
      registerTool: (descriptor: { name: string; execute(input: unknown): unknown }) => {
        executions.set(descriptor.name, descriptor.execute);
        return Promise.resolve();
      },
    } as unknown as ModelContext;
    const registry = await createToolRegistry(host, deps);
    await registry.setDatasetToolsEnabled(true);
    const before = structuredClone(harness.workspace());
    const execute = executions.get('apply_filter');
    if (!execute) throw new Error('apply_filter was not registered');
    expect(
      JSON.parse(
        String(await execute({ datasetId: 'ds_sales', columnId: 'col_region', operator: 'eq', unknown: true })),
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_TOOL_ARGUMENTS' });
    expect(harness.workspace()).toEqual(before);
    registry.dispose();
  });
});
