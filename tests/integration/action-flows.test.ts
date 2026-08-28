import { expect, test } from 'bun:test';
import { createHarness, stubDataEngine } from '../unit/application/action-fixtures.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';

test('invalid agent references leave state unchanged', async () => {
  const harness = createHarness();
  const engine = stubDataEngine();
  const tools = createToolDefinitions({
    dispatcher: harness.dispatcher,
    getWorkspace: harness.workspace,
    fetchTableWindow: engine.fetchTableWindow,
    executeAnalysis: engine.executeAnalysis,
  });
  const before = structuredClone(harness.store.getState());
  const result = await tools
    .find((tool) => tool.name === 'create_visualization')!
    .handler({
      datasetId: 'missing',
      title: 'Invalid',
      kind: 'line',
      xColumnId: 'missing',
      yColumnIds: ['missing'],
      expectedRevision: 0,
    });
  expect(JSON.parse(result).ok).toBe(false);
  expect(harness.store.getState()).toEqual(before);
});
