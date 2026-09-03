import { describe, expect, test } from 'bun:test';
import type { ModelContext } from '@mcp-b/webmcp-types';
import { createToolRegistry, executeTool } from '@/webmcp/registry/tool-registry.ts';
import { getToolStatus } from '@/webmcp/registry/tool-status.ts';
import { webmcpFixture } from './webmcp-fixtures.ts';

interface RecordedTool {
  name: string;
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<string>;
}

const recordingHost = (): { registrations: Map<string, RecordedTool>; host: ModelContext } => {
  const registrations = new Map<string, RecordedTool>();
  const host = {
    registerTool: async (definition: RecordedTool) => {
      registrations.set(definition.name, definition);
    },
  } as unknown as ModelContext;

  return { registrations, host };
};

describe('executeTool', () => {
  test('rejects arguments whose type does not match the schema', async () => {
    const { tool } = webmcpFixture();

    const output = JSON.parse(
      await executeTool(tool('preview_data'), { datasetId: 'ds_sales', limit: 'not-a-number' }),
    ) as Record<string, unknown>;

    expect(output['ok']).toBe(false);
  });

  // A `const` rejection has to name the accepted value, or the agent probes one call at a time.
  test('a rejected constant names the value the schema requires', async () => {
    const { tool } = webmcpFixture();

    const output = JSON.parse(
      await executeTool(tool('create_derived_column'), {
        datasetId: 'ds_sales',
        name: 'Invalid expression',
        expression: { kind: 'unsupported', columnId: 'col_revenue' },
      }),
    ) as Record<string, unknown>;

    expect(output['ok']).toBe(false);
    expect(output['error']).toContain('must be equal');
  });

  // Running a withdrawn call anyway occupies the DuckDB worker and delays the calls still wanted.
  test('an already cancelled call is refused before the handler runs', async () => {
    const { tool } = webmcpFixture();
    let handlerCalls = 0;
    const counting = {
      ...tool('get_workspace'),
      handler: async () => {
        handlerCalls += 1;
        return '{"ok":true}';
      },
    };

    const output = JSON.parse(await executeTool(counting, {}, AbortSignal.abort())) as Record<string, unknown>;

    expect(output['ok']).toBe(false);
    expect(handlerCalls).toBe(0);
  });

  test('the abort signal reaches the tool handler', async () => {
    const { tool } = webmcpFixture();
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const capturing = {
      ...tool('get_workspace'),
      handler: async (_input: unknown, signal?: AbortSignal) => {
        received = signal;
        return '{"ok":true}';
      },
    };

    await executeTool(capturing, {}, controller.signal);

    expect(received).toBe(controller.signal);
  });

  // Reporting a cancellation as a failure would have the agent retry work the user stopped.
  test('a handler that rejects after cancellation reports the cancellation', async () => {
    const { tool } = webmcpFixture();
    const controller = new AbortController();
    const aborting = {
      ...tool('get_workspace'),
      handler: async () => {
        controller.abort();
        throw new Error('aborted');
      },
    };

    const output = JSON.parse(await executeTool(aborting, {}, controller.signal)) as Record<string, unknown>;

    expect(output['ok']).toBe(false);
    expect(output['error']).toContain('cancelled');
  });

  // A thrown handler must not surface a stack trace or an engine message to the agent.
  test('a throwing handler becomes a generic failure result', async () => {
    const { tool } = webmcpFixture();
    const throwing = {
      ...tool('get_workspace'),
      handler: async () => {
        throw new Error('boom');
      },
    };

    expect(JSON.parse(await executeTool(throwing, {}))).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_OPERATION',
    });
  });
});

describe('createToolRegistry', () => {
  test('registers the dataset-independent tools before any import completes', async () => {
    const { registrations, host } = recordingHost();
    const registry = await createToolRegistry(host, webmcpFixture().deps);

    expect(registrations.has('get_workspace')).toBe(true);

    registry.dispose();
  });

  test('marks the tool surface available once registration finishes', async () => {
    const { host } = recordingHost();
    const registry = await createToolRegistry(host, webmcpFixture().deps);

    expect(getToolStatus().available).toBe(true);

    registry.dispose();
  });

  test('repeating the same ready-dataset count registers a tool only once', async () => {
    const { registrations, host } = recordingHost();
    const registry = await createToolRegistry(host, webmcpFixture().deps);

    await registry.setReadyDatasetCount(1);
    await registry.setReadyDatasetCount(1);

    expect(registrations.has('preview_data')).toBe(true);

    registry.dispose();
  });

  test('a registered tool executes through the shared validation path', async () => {
    const { registrations, host } = recordingHost();
    const registry = await createToolRegistry(host, webmcpFixture().deps);
    const registered = registrations.get('get_workspace');
    if (registered === undefined) {
      throw new Error('get_workspace was not registered');
    }

    expect(JSON.parse(await registered.execute({}))).toMatchObject({ ok: true });

    registry.dispose();
  });

  // The signal arrives positionally because the published types omit it, so pin that arrival path.
  test('a cancelled registered call is refused through the host signal argument', async () => {
    const { registrations, host } = recordingHost();
    const registry = await createToolRegistry(host, webmcpFixture().deps);
    const registered = registrations.get('get_workspace');
    if (registered === undefined) {
      throw new Error('get_workspace was not registered');
    }

    const output = JSON.parse(await registered.execute({}, { signal: AbortSignal.abort() })) as Record<string, unknown>;

    expect(output['ok']).toBe(false);
    expect(getToolStatus().executingCount).toBe(0);

    registry.dispose();
  });

  /*
   * The status carries the registered descriptors so the UI can show the contract behind the count.
   * Publishing them keeps that list in step with registration rather than restating a fixed catalogue.
   */
  test('the status publishes the descriptors of exactly the registered tools', async () => {
    const { host } = recordingHost();
    const registry = await createToolRegistry(host, webmcpFixture().deps);

    const beforeImport = getToolStatus().tools;

    expect(beforeImport.map((tool) => tool.name)).toContain('get_workspace');
    expect(beforeImport.map((tool) => tool.name)).not.toContain('preview_data');
    expect(beforeImport.length).toBe(getToolStatus().registeredCount);

    await registry.setReadyDatasetCount(1);

    const afterImport = getToolStatus().tools;
    const preview = afterImport.find((tool) => tool.name === 'preview_data');

    expect(preview?.description.length).toBeGreaterThan(0);
    // The panel reads annotations by name, so the flags must survive publication.
    expect(preview?.annotations['untrustedContentHint']).toBe(true);
    expect(afterImport.length).toBe(getToolStatus().registeredCount);

    registry.dispose();
  });

  test('dispose withdraws the tool surface so no agent call outlives the page', async () => {
    const { host } = recordingHost();
    const registry = await createToolRegistry(host, webmcpFixture().deps);
    await registry.setReadyDatasetCount(1);

    registry.dispose();

    expect(getToolStatus()).toMatchObject({ available: false, registeredCount: 0, executingCount: 0, tools: [] });
  });
});
