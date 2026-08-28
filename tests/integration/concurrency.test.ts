import { expect, test } from 'bun:test';
import { createHarness, stubDataEngine } from '../unit/application/action-fixtures.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';

test('an agent write based on a stale revision cannot mutate human state', async () => {
  const harness = createHarness();
  const engine = stubDataEngine();
  const tools = createToolDefinitions({
    dispatcher: harness.dispatcher,
    getWorkspace: harness.workspace,
    fetchTableWindow: engine.fetchTableWindow,
    executeAnalysis: engine.executeAnalysis,
  });
  const revision = harness.workspace().revision;
  await harness.dispatcher.execute({ type: 'layout.update', payload: { columns: 6 } }, { actor: 'human' });
  const before = structuredClone(harness.store.getState());
  const result = await tools
    .find((tool) => tool.name === 'apply_filter')!
    .handler({
      datasetId: 'ds_sales',
      columnId: 'col_region',
      operator: 'eq',
      value: 'Europe',
      expectedRevision: revision,
    });
  expect(JSON.parse(result).code).toBe('STALE_WORKSPACE_REVISION');
  expect(harness.store.getState()).toEqual(before);
});
