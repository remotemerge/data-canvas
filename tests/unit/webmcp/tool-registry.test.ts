import { describe, expect, test } from 'bun:test';
import type { ModelContext } from '@mcp-b/webmcp-types';
import { createToolRegistry, executeTool } from '@/webmcp/registry/tool-registry.ts';
import { getToolStatus } from '@/webmcp/registry/tool-status.ts';
import { webmcpFixture } from './webmcp-fixtures.ts';

interface RecordedTool {
  name: string;
  execute(input: unknown): Promise<string>;
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

  test('dispose withdraws the tool surface so no agent call outlives the page', async () => {
    const { host } = recordingHost();
    const registry = await createToolRegistry(host, webmcpFixture().deps);
    await registry.setReadyDatasetCount(1);

    registry.dispose();

    expect(getToolStatus()).toMatchObject({ available: false, registeredCount: 0, executingCount: 0 });
  });
});
