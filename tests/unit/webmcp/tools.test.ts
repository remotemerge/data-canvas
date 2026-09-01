import { describe, expect, test } from 'bun:test';
import type { ModelContext } from '@mcp-b/webmcp-types';
import { createUndoRedo } from '@/application/history/undo-redo.ts';
import {
  createHarness,
  stubColumnStatistics,
  stubDataEngine,
  workspaceWithDataset,
} from '../application/action-fixtures.ts';
import { createToolDefinitions, createToolRegistry, executeTool } from '@/webmcp/registry/tool-registry.ts';
import type { ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { TOOL_CONTRACT_VERSION } from '@/webmcp/schemas/compile-schemas.ts';

const setup = () => {
  const engine = stubDataEngine();
  const harness = createHarness(workspaceWithDataset(), engine);
  const deps: ToolDependencies = {
    dispatcher: harness.dispatcher,
    history: createUndoRedo({ dispatcher: harness.dispatcher, store: harness.store }),
    getWorkspace: harness.workspace,
    fetchTableWindow: (request) => engine.fetchTableWindow(request),
    executeAnalysis: (query) => engine.executeAnalysis(query),
    fetchColumnStatistics: stubColumnStatistics(engine, harness.workspace),
  };
  const tools = createToolDefinitions(deps);
  const tool = (name: string) => {
    const found = tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Missing tool ${name}`);
    return found;
  };
  return { harness, deps, tool };
};

describe('WebMCP tool surface exclusions', () => {
  // Agent tools do not export or import workspace files.
  test('registers no export or import tool', () => {
    const { deps } = setup();
    const names = createToolDefinitions(deps).map((tool) => tool.name);

    for (const name of names) {
      expect(name).not.toMatch(/export|import|download|save_file|archive/i);
    }
  });

  test('exposes no tool that replaces the whole workspace', () => {
    const { deps } = setup();
    const names = createToolDefinitions(deps).map((tool) => tool.name);
    expect(names).not.toContain('import_workspace');
    expect(names).not.toContain('export_workspace');
  });
});

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

  test('clear_selection removes the current dataset selection through the shared action', async () => {
    const { harness, tool } = setup();

    const highlighted = JSON.parse(
      await tool('highlight_selection').handler({
        datasetId: 'ds_sales',
        columnId: 'col_region',
        values: ['Europe'],
      }),
    ) as { ok: boolean };
    expect(highlighted.ok).toBe(true);
    expect(Object.values(harness.workspace().selections)).toHaveLength(1);

    const cleared = JSON.parse(await tool('clear_selection').handler({ datasetId: 'ds_sales' })) as { ok: boolean };
    expect(cleared.ok).toBe(true);
    expect(Object.values(harness.workspace().selections)).toHaveLength(0);
  });

  test('get_workspace includes bounded filter values and provenance', async () => {
    const { tool } = setup();
    await tool('apply_filter').handler({
      datasetId: 'ds_sales',
      columnId: 'col_region',
      operator: 'in',
      value: ['Europe', 'Asia'],
    });

    const workspace = JSON.parse(await tool('get_workspace').handler({})) as {
      filters: { value: unknown; origin: string }[];
    };
    expect(workspace.filters).toHaveLength(1);
    expect(workspace.filters[0]).toMatchObject({ value: ['Europe', 'Asia'], origin: 'agent' });
  });

  test('analyze_data converts a temporal dimension into the domain bin strategy', async () => {
    const { deps, tool } = setup();
    const executeAnalysis = deps.executeAnalysis;
    let observedQuery: Parameters<ToolDependencies['executeAnalysis']>[0] | undefined;
    deps.executeAnalysis = (query) => {
      observedQuery = query;
      return executeAnalysis(query);
    };

    const output = JSON.parse(
      await tool('analyze_data').handler({
        datasetId: 'ds_sales',
        dimensions: [{ columnId: 'col_date', timeGrain: 'month' }],
        measures: [{ columnId: 'col_revenue', aggregate: 'sum' }],
      }),
    ) as { ok: boolean };

    expect(output.ok).toBe(true);
    expect(observedQuery?.dimensions).toEqual([]);
    expect(observedQuery?.binnedDimensions).toEqual([
      { columnId: 'col_date', strategy: { kind: 'temporal', unit: 'month' } },
    ]);
  });

  test('undo and redo expose shared workspace history to agents', async () => {
    const { harness, tool } = setup();
    await tool('highlight_selection').handler({
      datasetId: 'ds_sales',
      columnId: 'col_region',
      values: ['Europe'],
    });
    expect(Object.values(harness.workspace().selections)).toHaveLength(1);

    const undone = JSON.parse(await tool('undo').handler({ expectedRevision: harness.workspace().revision })) as {
      ok: boolean;
    };
    expect(undone.ok).toBe(true);
    expect(Object.values(harness.workspace().selections)).toHaveLength(0);

    const redone = JSON.parse(await tool('redo').handler({ expectedRevision: harness.workspace().revision })) as {
      ok: boolean;
    };
    expect(redone.ok).toBe(true);
    expect(Object.values(harness.workspace().selections)).toHaveLength(1);
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

  // An agent that cannot read descriptors recovers from a rejection only if the message names the field.
  test('rejection messages name the offending property and the accepted values', async () => {
    const { tool } = setup();

    const unknownProperty = JSON.parse(
      await executeTool(tool('analyze_data'), {
        datasetId: 'ds_sales',
        measures: [{ columnId: 'col_revenue', aggregate: 'sum' }],
        groupBy: ['col_region'],
      }),
    ) as { error: string };
    expect(unknownProperty.error).toContain("unknown property 'groupBy'");

    const unknownNested = JSON.parse(
      await executeTool(tool('analyze_data'), {
        datasetId: 'ds_sales',
        measures: [{ columnId: 'col_revenue', aggregate: 'sum', evilExtra: 1 }],
      }),
    ) as { error: string };
    expect(unknownNested.error).toContain("'/measures/0' has unknown property 'evilExtra'");

    const badEnum = JSON.parse(
      await executeTool(tool('analyze_data'), {
        datasetId: 'ds_sales',
        measures: [{ columnId: 'col_revenue', aggregate: 'sumx' }],
      }),
    ) as { error: string };
    expect(badEnum.error).toContain('/measures/0/aggregate');
    expect(badEnum.error).toContain('"sum"');
  });

  test('get_workspace reports the contract version so a returning agent detects renames', async () => {
    const { tool } = setup();
    const workspace = JSON.parse(await tool('get_workspace').handler({})) as { toolContractVersion: number };
    expect(workspace.toolContractVersion).toBe(TOOL_CONTRACT_VERSION);
  });
});
