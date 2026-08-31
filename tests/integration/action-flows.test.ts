import { expect, test } from 'bun:test';
import { createHarness, stubColumnStatistics, stubDataEngine } from '../unit/application/action-fixtures.ts';
import { createToolDefinitions } from '@/webmcp/registry/tool-registry.ts';

test('invalid agent references leave state unchanged', async () => {
  const harness = createHarness();
  const engine = stubDataEngine();
  const tools = createToolDefinitions({
    dispatcher: harness.dispatcher,
    getWorkspace: harness.workspace,
    fetchTableWindow: engine.fetchTableWindow,
    executeAnalysis: engine.executeAnalysis,
    fetchColumnStatistics: stubColumnStatistics(engine, harness.workspace),
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

/*
 * The import placeholder is committed and made active before the engine holds its relation.
 * Table reads keyed off that dataset must wait for 'ready', or they surface a transient
 * DATASET_NOT_FOUND that clears itself a moment later.
 */
test('a dataset is only marked ready once the engine holds its relation', async () => {
  const harness = createHarness();

  const started = await harness.dispatcher.execute(
    { type: 'dataset.beginImport', payload: { name: 'sales.csv', sourceKind: 'csv', byteSize: 16 } },
    { actor: 'human' },
  );

  expect(started.ok).toBe(true);

  const datasetId = started.ok ? started.value.changedEntityIds[0]! : '';
  const placeholder = harness.workspace().datasets[datasetId]!;

  expect(placeholder.importStatus).toBe('loading');
  expect(placeholder.columns).toEqual([]);
  // Activating the placeholder is what points the table at a relation the engine lacks.
  expect(harness.workspace().activeDatasetId).toBe(datasetId);
});
