import { describe, expect, test } from 'bun:test';
import type { ModelContext } from '@mcp-b/webmcp-types';
import type { ActionContext, ApplicationAction } from '@/application/actions/action-types.ts';
import {
  visualization as makeVisualization,
  stubDataEngine,
  workspaceWithDataset,
  workspaceWithJoinableDatasets,
} from '../application/action-fixtures.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import { createToolDefinitions, createToolRegistry, executeTool } from '@/webmcp/registry/tool-registry.ts';
import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { TOOL_CONTRACT_VERSION } from '@/webmcp/schemas/compile-schemas.ts';
import { createWriteTools } from '@/webmcp/tools/write/write-tools.ts';
import { webmcpFixture } from './webmcp-fixtures.ts';

const setup = () => webmcpFixture();

// Adds a chart bound to the sales dataset so update and remove tools have a target.
const withVisualization = (workspace: Workspace, id = 'viz_1'): Workspace => {
  const chart = makeVisualization(id, 'ds_sales');

  return {
    ...workspace,
    visualizations: { ...workspace.visualizations, [chart.id]: chart },
    layout: { ...workspace.layout, items: [{ visualizationId: chart.id, x: 0, y: 0, width: 6, height: 4 }] },
  };
};

const analysisResult = (rows: readonly (string | number | boolean | null)[][] = [], warning?: string) => ({
  rows,
  columns: [
    { key: 'col_region', name: 'Region', logicalType: 'category' as const },
    { key: 'm0', name: 'sum', logicalType: 'number' as const },
  ],
  ...(warning === undefined ? {} : { warning }),
});

/*
 * Write tools are exercised against a recording dispatcher so the assertions describe the action a
 * tool builds, independent of whether the domain would accept it.
 */
const recordingWriteTools = (
  deps: ToolDependencies,
): {
  actions: ApplicationAction[];
  invoke: (name: string, input: unknown) => Promise<void>;
  last: () => ApplicationAction;
} => {
  const actions: ApplicationAction[] = [];
  const dispatcher: ToolDependencies['dispatcher'] = {
    execute: async (action: ApplicationAction, _context: ActionContext) => {
      actions.push(action);
      return ok({ actionId: 'action_1', revision: 0, changedEntityIds: ['entity_1'], summary: 'accepted' });
    },
  };
  const tools = createWriteTools({ ...deps, dispatcher });
  const tool = (name: string): DataCanvasTool => {
    const found = tools.find((candidate) => candidate.name === name);
    if (found === undefined) {
      throw new Error(`Missing write tool '${name}'.`);
    }
    return found;
  };

  return {
    actions,
    invoke: async (name, input) => {
      await tool(name).handler(input);
    },
    last: () => {
      const action = actions.at(-1);
      if (action === undefined) {
        throw new Error('Expected a dispatched action.');
      }
      return action;
    },
  };
};

describe('WebMCP tool surface exclusions', () => {
  test('the fixture rejects an unknown tool name', () => {
    expect(() => setup().tool('missing_tool')).toThrow("Missing fixture tool 'missing_tool'.");
  });

  test('the fixture column-profile dependency delegates to its engine', async () => {
    const { deps } = setup();
    const result = await deps.fetchColumnStatistics({
      datasetId: 'ds_sales',
      columnId: 'col_revenue',
      topValueLimit: 3,
    });

    expect(result).toEqual(
      ok({
        columnId: 'col_revenue',
        name: 'revenue',
        logicalType: 'number',
        rowCount: 0,
        nullCount: 0,
        distinctCount: 0,
        distinctCountCapped: false,
      }),
    );
  });

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

  test('declares titles, retry behavior, and side effects for every tool', () => {
    const { deps } = setup();
    const tools = createToolDefinitions(deps);

    for (const tool of tools) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.annotations.openWorldHint).toBe(false);
      if (tool.annotations.readOnlyHint === true) {
        expect(tool.annotations.idempotentHint).toBe(true);
      }
    }

    expect(tools.find((tool) => tool.name === 'create_metric')?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(tools.find((tool) => tool.name === 'remove_visualization')?.annotations).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
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

  /*
   * Every read tool resolves its dataset before touching the engine, so an unknown ID is answered with a
   * corrective code rather than a query against a relation that does not exist.
   */
  test('each dataset-scoped read tool refuses an unknown dataset', async () => {
    const { tool } = setup();
    const names = ['preview_data', 'analyze_data'] as const;

    const responses = await Promise.all(
      names.map(async (name) => ({
        name,
        response: JSON.parse(
          await tool(name).handler({ datasetId: 'missing', measures: [{ aggregate: 'count' }] }),
        ) as {
          ok: boolean;
          code?: string;
        },
      })),
    );

    for (const { name, response } of responses) {
      expect(`${name}: ${response.ok}`).toBe(`${name}: false`);
      expect(response.code).toBe('DATASET_NOT_FOUND');
    }
  });

  // Column IDs are checked against the workspace so the compiler is never asked to reach an absent column.
  test('analyze_data refuses a measure or dimension naming an unknown column', async () => {
    const { tool } = setup();

    expect(
      JSON.parse(
        await tool('analyze_data').handler({
          datasetId: 'ds_sales',
          dimensions: ['col_missing'],
          measures: [{ aggregate: 'count' }],
        }),
      ),
    ).toMatchObject({ ok: false, code: 'COLUMN_NOT_FOUND' });
  });

  /*
   * An engine failure is reported to the agent rather than surfacing as a rejected promise, so the
   * tool call still returns a structured result the agent can act on.
   */
  test('a read tool reports an engine failure as a structured result', async () => {
    const failing = domainError('QUERY_FAILED', 'The engine rejected the query.');
    const { tool } = webmcpFixture(workspaceWithDataset(), {
      ...stubDataEngine(),
      fetchTableWindow: () => Promise.resolve(err(failing)),
      executeAnalysis: () => Promise.resolve(err(failing)),
    });

    expect(JSON.parse(await tool('preview_data').handler({ datasetId: 'ds_sales' }))).toMatchObject({
      ok: false,
      code: 'QUERY_FAILED',
    });
    expect(
      JSON.parse(await tool('analyze_data').handler({ datasetId: 'ds_sales', measures: [{ aggregate: 'count' }] })),
    ).toMatchObject({ ok: false, code: 'QUERY_FAILED' });
  });

  /*
   * A write tool reports a rejected action as a structured failure rather than claiming success, so the
   * agent learns the workspace is unchanged and why.
   */
  test('a rejected write is reported with the domain code that refused it', async () => {
    const { tool, harness } = setup();
    const initial = structuredClone(harness.workspace());

    const derived = JSON.parse(
      await tool('create_derived_column').handler({
        datasetId: 'ds_sales',
        name: 'Broken',
        expression: { kind: 'column', columnId: 'col_missing' },
      }),
    ) as { ok: boolean; code?: string };

    expect(derived.ok).toBe(false);
    expect(derived.code).toBe('COLUMN_NOT_FOUND');

    const relationship = JSON.parse(
      await tool('create_relationship').handler({
        leftDatasetId: 'ds_sales',
        rightDatasetId: 'ds_missing',
        on: [{ leftColumnId: 'col_region', rightColumnId: 'col_region' }],
        kind: 'many_to_one',
        join: 'inner',
      }),
    ) as { ok: boolean; code?: string };

    expect(relationship.ok).toBe(false);
    expect(relationship.code).toBe('DATASET_NOT_FOUND');
    expect(harness.workspace()).toEqual(initial);
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

  // A populated workspace exercises the mapping of every collection, not only the empty-list path.
  test('get_workspace lists the datasets, relationships, and visualizations the workspace holds', async () => {
    const base = workspaceWithJoinableDatasets();
    const chart = makeVisualization('viz_orders', 'ds_orders');
    const relation: Relationship = {
      id: 'rel_orders_customers',
      leftDatasetId: 'ds_orders',
      rightDatasetId: 'ds_customers',
      on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
      kind: 'many_to_one',
      join: 'inner',
      createdBy: 'human',
    };
    const { tool } = webmcpFixture({
      ...base,
      visualizations: { [chart.id]: chart },
      relationships: { [relation.id]: relation },
      metrics: {
        metric_orders: {
          id: 'metric_orders',
          datasetId: 'ds_orders',
          name: 'Revenue',
          aggregate: 'sum',
          columnId: 'col_order_revenue',
          filters: [],
          createdBy: 'human',
        },
      },
      selections: {
        selection_orders: {
          id: 'selection_orders',
          datasetId: 'ds_orders',
          mode: 'keys',
          keys: ['order-1'],
          origin: 'table',
        },
      },
    });

    const workspace = JSON.parse(await tool('get_workspace').handler({})) as {
      datasets: { id: string }[];
      relationships: { id: string }[];
      visualizations: { id: string }[];
    };

    expect(workspace.datasets.map((dataset) => dataset.id)).toEqual(['ds_orders', 'ds_customers', 'ds_products']);
    expect(workspace.relationships.map((item) => item.id)).toEqual(['rel_orders_customers']);
    expect(workspace.visualizations.map((item) => item.id)).toEqual(['viz_orders']);
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

  /*
   * Registering a tool that cannot yet succeed makes an agent discover the precondition by failing a
   * call. Relationship creation needs two datasets, so it appears only after the second import.
   */
  test('registration follows each tool own dataset precondition', async () => {
    const { deps } = setup();
    const registered = new Set<string>();
    const host = {
      registerTool: (descriptor: { name: string }, options?: { signal?: AbortSignal }) => {
        registered.add(descriptor.name);
        options?.signal?.addEventListener('abort', () => registered.delete(descriptor.name));
        return Promise.resolve();
      },
    } as unknown as ModelContext;

    const registry = await createToolRegistry(host, deps);

    expect(registered.has('get_workspace')).toBe(true);
    expect(registered.has('apply_filter')).toBe(false);
    expect(registered.has('create_relationship')).toBe(false);

    await registry.setReadyDatasetCount(1);

    expect(registered.has('apply_filter')).toBe(true);
    // One dataset cannot be related to anything, so the tool stays hidden.
    expect(registered.has('create_relationship')).toBe(false);

    await registry.setReadyDatasetCount(2);

    expect(registered.has('create_relationship')).toBe(true);

    // Removing a dataset withdraws the tool again rather than leaving a call that must fail.
    await registry.setReadyDatasetCount(1);

    expect(registered.has('create_relationship')).toBe(false);
    expect(registered.has('apply_filter')).toBe(true);

    registry.dispose();
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
    await registry.setReadyDatasetCount(1);
    const before = structuredClone(harness.workspace());
    const execute = executions.get('apply_filter');
    if (!execute) {
      throw new Error('apply_filter was not registered');
    }
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

  test('the contract version is a number an agent can compare', () => {
    expect(TOOL_CONTRACT_VERSION).toBeNumber();
  });
});

const RELATED_ORDERS: Relationship = {
  id: 'rel_orders_customers',
  leftDatasetId: 'ds_orders',
  rightDatasetId: 'ds_customers',
  on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
  kind: 'many_to_one',
  join: 'inner',
  createdBy: 'human',
};

// A relationship whose right side was removed, which the listing must still describe.
const ORPHAN_RELATIONSHIP: Relationship = {
  id: 'rel_orphan',
  leftDatasetId: 'ds_orders',
  rightDatasetId: 'ds_missing',
  on: [{ leftColumnId: 'col_order_customer', rightColumnId: 'col_customer_id' }],
  kind: 'many_to_one',
  join: 'left',
  createdBy: 'human',
};

const ENABLED_FILTER = {
  id: 'filter_enabled',
  datasetId: 'ds_orders',
  columnId: 'col_order_revenue',
  operator: 'gt' as const,
  value: 10,
  enabled: true,
  origin: 'human' as const,
  createdBy: 'human' as const,
};

const DISABLED_FILTER = { ...ENABLED_FILTER, id: 'filter_disabled', enabled: false };

const relatedSetup = () => {
  const workspace: Workspace = {
    ...workspaceWithJoinableDatasets(),
    relationships: { [RELATED_ORDERS.id]: RELATED_ORDERS, [ORPHAN_RELATIONSHIP.id]: ORPHAN_RELATIONSHIP },
    filters: { [ENABLED_FILTER.id]: ENABLED_FILTER, [DISABLED_FILTER.id]: DISABLED_FILTER },
  };
  const fixture = webmcpFixture(workspace);
  const parsed = async (name: string, input: unknown): Promise<Record<string, unknown>> =>
    JSON.parse(await executeTool(fixture.tool(name), input)) as Record<string, unknown>;

  return { ...fixture, parsed };
};

describe('get_column_statistics', () => {
  const withProfile = () => {
    const fixture = relatedSetup();
    fixture.deps.fetchColumnStatistics = async () =>
      ok({
        columnId: 'col_order_revenue',
        name: 'Revenue',
        logicalType: 'number',
        rowCount: 10,
        nullCount: 1,
        distinctCount: 3,
        distinctCountCapped: true,
        min: 1,
        max: 9,
        mean: 4,
        median: 4,
        stddev: 2,
        topValues: [{ value: '<unsafe>', count: 2 }],
      });
    return fixture;
  };

  test('returns the numeric profile the engine reported', async () => {
    const { parsed } = withProfile();

    expect(
      await parsed('get_column_statistics', {
        datasetId: 'ds_orders',
        columnId: 'col_order_revenue',
        topValueLimit: 3,
      }),
    ).toMatchObject({ ok: true, distinctCountCapped: true, min: 1, max: 9, mean: 4, median: 4, stddev: 2 });
  });

  // Top values come from imported data, so they travel as plain text rather than as markup.
  test('carries dataset-derived top values through verbatim', async () => {
    const { parsed } = withProfile();
    const stats = await parsed('get_column_statistics', {
      datasetId: 'ds_orders',
      columnId: 'col_order_revenue',
      topValueLimit: 3,
    });

    expect(stats['topValues']).toEqual([{ value: '<unsafe>', count: 2 }]);
  });

  test('refuses an unknown dataset', async () => {
    const { parsed } = relatedSetup();

    expect((await parsed('get_column_statistics', { datasetId: 'missing', columnId: 'col_order_revenue' }))['ok']).toBe(
      false,
    );
  });

  test('refuses a column the dataset does not have', async () => {
    const { parsed } = relatedSetup();

    expect((await parsed('get_column_statistics', { datasetId: 'ds_orders', columnId: 'missing' }))['ok']).toBe(false);
  });

  test('reports failure when the engine cannot profile the column', async () => {
    const fixture = relatedSetup();
    fixture.deps.fetchColumnStatistics = async () => err(domainError('ENGINE_UNAVAILABLE', 'offline'));

    expect(
      (await fixture.parsed('get_column_statistics', { datasetId: 'ds_orders', columnId: 'col_order_revenue' }))['ok'],
    ).toBe(false);
  });
});

describe('list_relationships', () => {
  test('summarizes every relationship in the workspace', async () => {
    const { parsed } = relatedSetup();

    expect((await parsed('list_relationships', {}))['summary']).toContain('2 relationships');
  });

  test('lists both relationships touching the requested dataset', async () => {
    const { parsed } = relatedSetup();

    expect((await parsed('list_relationships', { datasetId: 'ds_orders' }))['relationships']).toHaveLength(2);
  });

  test('includes join suggestions when the agent asks for them', async () => {
    const { parsed } = relatedSetup();

    expect(await parsed('list_relationships', { includeSuggestions: true })).toHaveProperty('suggestions');
  });

  test('refuses an unknown dataset filter', async () => {
    const { parsed } = relatedSetup();

    expect((await parsed('list_relationships', { datasetId: 'missing' }))['ok']).toBe(false);
  });
});

describe('get_dataset_schema', () => {
  test('returns only the requested column page', async () => {
    const { parsed } = relatedSetup();
    const schema = await parsed('get_dataset_schema', { datasetId: 'ds_orders', offset: 0, limit: 1 });

    expect(schema['columnsReturned']).toBe(1);
  });

  test('lists the related datasets when asked, so an agent finds joinable columns', async () => {
    const { parsed } = relatedSetup();
    const schema = await parsed('get_dataset_schema', {
      datasetId: 'ds_orders',
      offset: 0,
      limit: 1,
      includeRelated: true,
    });

    expect(schema['related']).toHaveLength(1);
  });
});

describe('preview_data', () => {
  const withRevenueWindow = () => {
    const fixture = relatedSetup();
    fixture.deps.fetchTableWindow = async () =>
      ok({
        rows: [[12]],
        columnIds: ['col_order_revenue'],
        columns: [],
        totalRowCount: 1,
        offset: 0,
        stale: false,
      });
    return fixture;
  };

  test('returns the projection the agent requested', async () => {
    const { parsed } = withRevenueWindow();
    const preview = await parsed('preview_data', {
      datasetId: 'ds_orders',
      columnIds: ['col_order_revenue'],
      limit: 2,
    });

    expect(preview['columnIds']).toEqual(['col_order_revenue']);
  });

  test('returns every engine column when no projection is requested', async () => {
    const fixture = webmcpFixture();
    fixture.deps.fetchTableWindow = async () =>
      ok({
        rows: [[12]],
        columnIds: ['col_revenue'],
        columns: [],
        totalRowCount: 1,
        offset: 0,
        stale: false,
      });

    const output = JSON.parse(await fixture.tool('preview_data').handler({ datasetId: 'ds_sales' })) as Record<
      string,
      unknown
    >;

    expect(output['columnIds']).toEqual(['col_revenue']);
    expect(output['rows']).toEqual([[12]]);
  });
});

describe('analyze_data', () => {
  test('pushes the enabled workspace filters into the engine query', async () => {
    const fixture = relatedSetup();
    let observed: readonly unknown[] | undefined;
    fixture.deps.executeAnalysis = async (query) => {
      observed = query.filters;
      return ok(analysisResult([['West', 12]]));
    };

    await fixture.parsed('analyze_data', {
      datasetId: 'ds_orders',
      dimensions: ['col_order_customer'],
      measures: [{ columnId: 'col_order_revenue', aggregate: 'sum' }],
      relationshipIds: [RELATED_ORDERS.id],
      limit: 200,
    });

    // The disabled filter is left out, so a paused filter does not silently narrow an analysis.
    expect(observed).toEqual([{ kind: 'comparison', columnId: 'col_order_revenue', operator: 'gt', value: 10 }]);
  });

  test('reports an engine sampling warning in the summary', async () => {
    const fixture = relatedSetup();
    fixture.deps.executeAnalysis = async () => ok(analysisResult([['West', 12]], 'The result was sampled.'));

    const analysis = await fixture.parsed('analyze_data', {
      datasetId: 'ds_orders',
      dimensions: ['col_order_customer'],
      measures: [{ columnId: 'col_order_revenue', aggregate: 'sum' }],
      relationshipIds: [RELATED_ORDERS.id],
      limit: 200,
    });

    expect(analysis['summary']).toContain('sampled');
  });

  test('refuses an unknown dimension column', async () => {
    const { parsed } = relatedSetup();

    expect(
      (await parsed('analyze_data', { datasetId: 'ds_orders', dimensions: ['missing'], measures: [] }))['ok'],
    ).toBe(false);
  });
});

describe('WebMCP write-tool query construction', () => {
  test('a histogram binds its x column as a binned dimension', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('create_visualization', {
      datasetId: 'ds_sales',
      title: 'Histogram',
      kind: 'histogram',
      xColumnId: 'col_revenue',
      binX: { kind: 'equalWidth', binCount: 2 },
    });

    expect(last()).toMatchObject({
      type: 'visualization.create',
      payload: { query: { binnedDimensions: [{ columnId: 'col_revenue' }] } },
    });
  });

  test('a box plot becomes a distribution query over its category column', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('create_visualization', {
      datasetId: 'ds_sales',
      title: 'Box plot',
      kind: 'boxplot',
      xColumnId: 'col_region',
      yColumnIds: ['col_revenue'],
    });

    expect(last()).toMatchObject({
      type: 'visualization.create',
      payload: { query: { distribution: { columnId: 'col_revenue', categoryColumnId: 'col_region' } } },
    });
  });

  test('binning both the axis and the series produces two binned dimensions', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('create_visualization', {
      datasetId: 'ds_sales',
      title: 'Binned chart',
      kind: 'bar',
      xColumnId: 'col_revenue',
      groupByColumnId: 'col_units',
      binX: { kind: 'equalWidth', binCount: 2 },
      binSeries: { kind: 'equalWidth', binCount: 2 },
      aggregate: 'avg',
      yColumnIds: ['col_revenue'],
    });

    expect(last()).toMatchObject({
      type: 'visualization.create',
      payload: {
        query: {
          binnedDimensions: [{ columnId: 'col_revenue' }, { columnId: 'col_units' }],
          measures: [{ aggregate: 'avg' }],
        },
      },
    });
  });

  test('a chart with no measure column counts rows', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('create_visualization', { datasetId: 'ds_sales', title: 'Count', kind: 'bar' });

    expect(last()).toMatchObject({ payload: { query: { measures: [{ aggregate: 'count' }] } } });
  });

  // Existence is the dispatcher's decision, so a title-only update forwards the id it was given.
  test('a title-only update forwards the visualization id without rebuilding the query', async () => {
    const { invoke, last } = recordingWriteTools(webmcpFixture(withVisualization(workspaceWithDataset())).deps);

    await invoke('update_visualization', { visualizationId: 'missing', title: 'Renamed' });

    expect(last()).toMatchObject({
      type: 'visualization.update',
      payload: { visualizationId: 'missing', title: 'Renamed' },
    });
  });

  test('a full update rebuilds the query, the kind, and the link mode together', async () => {
    const { invoke, last } = recordingWriteTools(webmcpFixture(withVisualization(workspaceWithDataset())).deps);

    await invoke('update_visualization', {
      visualizationId: 'viz_1',
      title: 'Updated',
      kind: 'bar',
      xColumnId: 'col_region',
      yColumnIds: ['col_revenue'],
      groupByColumnId: 'col_notes',
      binX: { kind: 'equalWidth', binCount: 2 },
      binSeries: { kind: 'equalWidth', binCount: 2 },
      linkMode: 'none',
      aggregate: 'sum',
    });

    expect(last()).toMatchObject({
      type: 'visualization.update',
      payload: { kind: 'bar', query: { measures: [{ aggregate: 'sum' }] }, linkMode: 'none' },
    });
  });

  test('remove_visualization dispatches the removal for the named chart', async () => {
    const { invoke, last } = recordingWriteTools(webmcpFixture(withVisualization(workspaceWithDataset())).deps);

    await invoke('remove_visualization', { visualizationId: 'viz_1' });

    expect(last()).toMatchObject({ type: 'visualization.remove', payload: { visualizationId: 'viz_1' } });
  });

  test('a comparison filter carries its value', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('apply_filter', { datasetId: 'ds_sales', columnId: 'col_region', operator: 'eq', value: 'West' });

    expect(last()).toMatchObject({
      type: 'filter.apply',
      payload: { datasetId: 'ds_sales', columnId: 'col_region', operator: 'eq', value: 'West' },
    });
  });

  test('a null-check filter omits the value rather than sending an empty one', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('apply_filter', { datasetId: 'ds_sales', columnId: 'col_region', operator: 'is_null' });

    expect(last()).toMatchObject({ type: 'filter.apply', payload: { operator: 'is_null' } });
    expect((last() as unknown as { payload: Record<string, unknown> }).payload['value']).toBeUndefined();
  });

  test('clear_filters without a dataset clears the whole workspace', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('clear_filters', {});

    expect(last()).toMatchObject({ type: 'filters.clear' });
    expect((last() as unknown as { payload: Record<string, unknown> }).payload['datasetId']).toBeUndefined();
  });

  test('clear_filters scoped to a dataset forwards that dataset', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('clear_filters', { datasetId: 'ds_sales' });

    expect(last()).toMatchObject({ type: 'filters.clear', payload: { datasetId: 'ds_sales' } });
  });

  // A highlight uses the same predicate payload a human click produces, not an agent-only shape.
  test('a highlight replaces the current selection by default', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('highlight_selection', { datasetId: 'ds_sales', columnId: 'col_region', values: ['West'] });

    expect(last()).toMatchObject({
      type: 'selection.set',
      payload: {
        datasetId: 'ds_sales',
        mode: 'predicate',
        predicate: { kind: 'comparison', columnId: 'col_region', operator: 'in', value: ['West'] },
        origin: 'agent',
      },
    });
  });

  test('an additive highlight extends the selection instead of replacing it', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('highlight_selection', {
      datasetId: 'ds_sales',
      columnId: 'col_region',
      values: ['East'],
      additive: true,
    });

    expect(last()).toMatchObject({
      type: 'selection.extend',
      payload: { predicate: { columnId: 'col_region', operator: 'in', value: ['East'] } },
    });
  });

  test('a count metric needs no measure column', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('create_metric', { datasetId: 'ds_sales', name: 'Count', aggregate: 'count' });

    expect(last()).toMatchObject({ type: 'metric.create', payload: { name: 'Count', aggregate: 'count' } });
  });

  test('an aggregate metric carries its column, filters, and modifier', async () => {
    const { invoke, last } = recordingWriteTools(setup().deps);

    await invoke('create_metric', {
      datasetId: 'ds_sales',
      name: 'Revenue',
      aggregate: 'sum',
      columnId: 'col_revenue',
      filterIds: ['filter_1'],
      modifier: { kind: 'percentOfTotal' },
    });

    expect(last()).toMatchObject({
      type: 'metric.create',
      payload: {
        columnId: 'col_revenue',
        // The tool renames `filterIds` to the domain payload's `filters`.
        filters: ['filter_1'],
        modifier: { kind: 'percentOfTotal' },
      },
    });
  });

  test('an annotation carries its anchor to the chart it belongs to', async () => {
    const { invoke, last } = recordingWriteTools(webmcpFixture(withVisualization(workspaceWithDataset())).deps);

    await invoke('add_annotation', {
      visualizationId: 'viz_1',
      text: 'Note',
      anchor: { kind: 'point', x: 'West', y: 1 },
    });

    expect(last()).toMatchObject({
      type: 'annotation.add',
      payload: { visualizationId: 'viz_1', text: 'Note', anchor: { kind: 'point', x: 'West', y: 1 } },
    });
  });
});

describe('WebMCP history tools', () => {
  test('undo reports failure when no history dependency is wired', async () => {
    const fixture = webmcpFixture();
    const { history: _history, ...withoutHistory } = fixture.deps;
    const tools = createToolDefinitions(withoutHistory);
    const undo = tools.find((candidate) => candidate.name === 'undo');
    if (undo === undefined) {
      throw new Error('undo was not registered');
    }

    expect(JSON.parse(await undo.handler({}))).toMatchObject({ ok: false });
  });

  test('redo reports failure when no history dependency is wired', async () => {
    const fixture = webmcpFixture();
    const { history: _history, ...withoutHistory } = fixture.deps;
    const tools = createToolDefinitions(withoutHistory);
    const redo = tools.find((candidate) => candidate.name === 'redo');
    if (redo === undefined) {
      throw new Error('redo was not registered');
    }

    expect(JSON.parse(await redo.handler({}))).toMatchObject({ ok: false });
  });
});
