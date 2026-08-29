import { describe, expect, test } from 'bun:test';
import { APPLICATION_ACTION_TYPES } from '@/application/actions/action-types.ts';
import type { ApplicationAction } from '@/application/actions/action-types.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import {
  createHarness,
  importThroughDispatcher,
  salesDataset,
  stubDataEngine,
  visualization,
  workspaceWithDataset,
} from './action-fixtures.ts';

const DATASET_ID = 'ds_sales';

describe('dispatcher handler coverage', () => {
  /*
   * Every action type must reach a handler. A missing case would otherwise surface only when a
   * caller dispatched that action, which for agent-only actions could be long after the omission.
   */
  const sampleAction = (type: ApplicationAction['type']): ApplicationAction => {
    switch (type) {
      case 'dataset.beginImport':
        return { type, payload: { name: 'Sales', sourceKind: 'csv', byteSize: 8 } };
      case 'dataset.import':
        return { type, payload: { file: new Blob(['a,b\n1,2']), datasetId: DATASET_ID } };
      case 'dataset.failImport':
        return { type, payload: { datasetId: DATASET_ID, reason: 'unreadable' } };
      case 'dataset.setActive':
        return { type, payload: { datasetId: DATASET_ID } };
      case 'dataset.remove':
        return { type, payload: { datasetId: DATASET_ID, cascade: true } };
      case 'relationship.create':
        return {
          type,
          payload: {
            leftDatasetId: DATASET_ID,
            rightDatasetId: 'ds_missing',
            on: [{ leftColumnId: 'col_region', rightColumnId: 'col_other' }],
            kind: 'many_to_one',
            join: 'inner',
          },
        };
      case 'relationship.remove':
        return { type, payload: { relationshipId: 'rel_missing' } };
      case 'filter.apply':
        return { type, payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value: 10 } };
      case 'filter.remove':
        return { type, payload: { filterId: 'flt_missing' } };
      case 'filters.clear':
        return { type, payload: {} };
      case 'table.sort':
        return { type, payload: { datasetId: DATASET_ID, sort: [{ columnId: 'col_revenue', direction: 'asc' }] } };
      case 'visualization.create':
        return {
          type,
          payload: {
            datasetId: DATASET_ID,
            title: 'Revenue',
            kind: 'line',
            binding: { x: 'col_date', y: ['col_revenue'] },
          },
        };
      case 'visualization.update':
        return { type, payload: { visualizationId: 'viz_missing', title: 'Renamed' } };
      case 'visualization.remove':
        return { type, payload: { visualizationId: 'viz_missing' } };
      case 'selection.set':
        return { type, payload: { datasetId: DATASET_ID, mode: 'keys', keys: ['1'], origin: 'table' } };
      case 'selection.clear':
        return { type, payload: {} };
      case 'metric.create':
        return { type, payload: { datasetId: DATASET_ID, name: 'Total', aggregate: 'sum', columnId: 'col_revenue' } };
      case 'metric.remove':
        return { type, payload: { metricId: 'mtr_missing' } };
      case 'annotation.add':
        return {
          type,
          payload: {
            visualizationId: 'viz_missing',
            text: 'note',
            anchor: { kind: 'point', x: 1, y: 2 },
            origin: 'human',
          },
        };
      case 'annotation.remove':
        return { type, payload: { annotationId: 'ann_missing' } };
      case 'layout.update':
        return { type, payload: { columns: 8 } };
      case 'history.restore':
        return { type, payload: { state: {}, changedEntityIds: [] } };
    }
  };

  test.each(APPLICATION_ACTION_TYPES.map((type) => [type] as const))(
    '%s reaches a handler rather than falling through',
    async (type) => {
      const harness = createHarness();
      const result = await harness.dispatcher.execute(sampleAction(type), { actor: 'human' });

      // Some samples reference deliberately missing entities and fail; what matters is that the
      // failure is a handler's domain error, never an unhandled action type.
      if (!result.ok) {
        expect(result.error.code).not.toBe('INVALID_TOOL_ARGUMENTS');
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    },
  );

  test('every action type in the union is listed in APPLICATION_ACTION_TYPES', () => {
    expect(new Set(APPLICATION_ACTION_TYPES).size).toBe(APPLICATION_ACTION_TYPES.length);
    expect(APPLICATION_ACTION_TYPES).toHaveLength(22);
  });
});

describe('metadata-only actions work end to end', () => {
  test('layout.update commits, bumps the revision, and records history', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'layout.update', payload: { columns: 6 } },
      {
        actor: 'human',
      },
    );

    expect(result.ok).toBe(true);
    expect(harness.workspace().layout.columns).toBe(6);
    expect(harness.workspace().revision).toBe(1);
    expect(harness.history()).toHaveLength(1);
    expect(harness.history()[0]?.actor).toBe('human');
  });

  test('filter.apply stores a filter attributed to the acting party', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value: 100 } },
      { actor: 'agent' },
    );

    expect(result.ok).toBe(true);

    const filters = Object.values(harness.workspace().filters);

    expect(filters).toHaveLength(1);
    expect(filters[0]?.origin).toBe('agent');
    expect(filters[0]?.value).toBe(100);
  });

  test('re-applying the same column and operator replaces rather than stacks', async () => {
    const harness = createHarness();
    const apply = (value: number) =>
      harness.dispatcher.execute(
        { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value } },
        { actor: 'human' },
      );

    await apply(100);
    await apply(200);

    const filters = Object.values(harness.workspace().filters);

    expect(filters).toHaveLength(1);
    expect(filters[0]?.value).toBe(200);
  });

  test('filters.clear scoped to a dataset leaves other datasets untouched', async () => {
    const other = salesDataset('ds_other');
    const workspace = workspaceWithDataset();
    const harness = createHarness({ ...workspace, datasets: { ...workspace.datasets, [other.id]: other } });

    await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value: 1 } },
      { actor: 'human' },
    );
    await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: other.id, columnId: 'col_revenue', operator: 'lt', value: 9 } },
      { actor: 'human' },
    );

    await harness.dispatcher.execute({ type: 'filters.clear', payload: { datasetId: DATASET_ID } }, { actor: 'human' });

    const remaining = Object.values(harness.workspace().filters);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.datasetId).toBe(other.id);
  });

  test('visualization.remove also drops its annotations and layout slot', async () => {
    const workspace = workspaceWithDataset();
    const viz = visualization('viz_1', DATASET_ID);
    const harness = createHarness({
      ...workspace,
      visualizations: { [viz.id]: viz },
      layout: { columns: 12, items: [{ visualizationId: viz.id, x: 0, y: 0, width: 6, height: 4 }] },
    });

    await harness.dispatcher.execute(
      {
        type: 'annotation.add',
        payload: { visualizationId: viz.id, text: 'peak', anchor: { kind: 'point', x: 1, y: 2 }, origin: 'human' },
      },
      { actor: 'human' },
    );

    const result = await harness.dispatcher.execute(
      { type: 'visualization.remove', payload: { visualizationId: viz.id } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);
    expect(Object.keys(harness.workspace().visualizations)).toHaveLength(0);
    expect(Object.keys(harness.workspace().annotations)).toHaveLength(0);
    expect(harness.workspace().layout.items).toHaveLength(0);
  });

  test('selection.set replaces the prior selection for the same dataset', async () => {
    const harness = createHarness();
    const select = (keys: string[]) =>
      harness.dispatcher.execute(
        { type: 'selection.set', payload: { datasetId: DATASET_ID, mode: 'keys', keys, origin: 'table' } },
        { actor: 'human' },
      );

    await select(['1', '2']);
    await select(['3']);

    const selections = Object.values(harness.workspace().selections);

    expect(selections).toHaveLength(1);
    expect(selections[0]?.keys).toEqual(['3']);
  });
});

describe('entity reference resolution', () => {
  test('an unknown dataset is rejected with DATASET_NOT_FOUND', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: 'ds_nope', columnId: 'col_revenue', operator: 'gt', value: 1 } },
      { actor: 'agent' },
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('DATASET_NOT_FOUND');
  });

  test('an unknown column is rejected with COLUMN_NOT_FOUND', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_nope', operator: 'gt', value: 1 } },
      { actor: 'agent' },
    );

    expect(result.ok ? null : result.error.code).toBe('COLUMN_NOT_FOUND');
  });

  test('an unknown visualization is rejected with VISUALIZATION_NOT_FOUND', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'visualization.remove', payload: { visualizationId: 'viz_nope' } },
      { actor: 'agent' },
    );

    expect(result.ok ? null : result.error.code).toBe('VISUALIZATION_NOT_FOUND');
  });

  test('a failed action leaves the revision and history untouched', async () => {
    const harness = createHarness();

    await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: 'ds_nope', columnId: 'col_revenue', operator: 'gt', value: 1 } },
      { actor: 'agent' },
    );

    expect(harness.workspace().revision).toBe(0);
    expect(harness.history()).toHaveLength(0);
  });
});

describe('data engine port', () => {
  test('dataset.import fails with ENGINE_UNAVAILABLE while no engine is installed', async () => {
    const harness = createHarness();
    const { datasetId, result } = await importThroughDispatcher(harness, new Blob(['a,b\n1,2']));

    expect(result.ok ? null : result.error.code).toBe('ENGINE_UNAVAILABLE');

    // The placeholder is still committed and still `loading`: only the resolving action failed.
    expect(datasetId === undefined ? null : harness.workspace().datasets[datasetId]?.importStatus).toBe('loading');
  });

  test('a working engine commits the dataset through the same handler, unchanged', async () => {
    const harness = createHarness(workspaceWithDataset(), stubDataEngine());
    const { datasetId, result } = await importThroughDispatcher(harness, new Blob(['a\n1']), 'Imported');

    expect(result.ok).toBe(true);
    expect(Object.keys(harness.workspace().datasets)).toHaveLength(2);

    // Two commits, so two revisions: the placeholder and its resolution.
    expect(harness.workspace().revision).toBe(2);

    const imported = datasetId === undefined ? undefined : harness.workspace().datasets[datasetId];

    expect(imported?.importStatus).toBe('ready');
    expect(imported?.rowCount).toBe(42);
    expect(imported?.relationId.startsWith('dataset_')).toBe(true);
  });

  test('the import lifecycle moves loading to ready across two attributable commits', async () => {
    const harness = createHarness(workspaceWithDataset(), stubDataEngine());

    await importThroughDispatcher(harness, new Blob(['a\n1']), 'Imported');

    const types = harness.history().map((entry) => entry.type);

    expect(types).toEqual(['dataset.beginImport', 'dataset.import']);
    expect(harness.history().every((entry) => entry.actor === 'human')).toBe(true);
  });

  test('a failed import is committed as an error rather than left loading', async () => {
    const failing = stubDataEngine(() =>
      Promise.resolve(err(domainError('IMPORT_FAILED', 'The file could not be parsed.'))),
    );
    const harness = createHarness(workspaceWithDataset(), failing);
    const { datasetId, result } = await importThroughDispatcher(harness, new Blob([' ']));

    expect(result.ok).toBe(false);

    if (datasetId === undefined) throw new Error('expected a placeholder dataset');

    await harness.dispatcher.execute(
      { type: 'dataset.failImport', payload: { datasetId, reason: 'The file could not be parsed.' } },
      { actor: 'human' },
    );

    expect(harness.workspace().datasets[datasetId]?.importStatus).toBe('error');

    // A dataset whose relation was never created must not stay active.
    expect(harness.workspace().activeDatasetId).not.toBe(datasetId);
  });

  test('resolving a dataset that already imported is rejected', async () => {
    const harness = createHarness(workspaceWithDataset(), stubDataEngine());

    // The fixture dataset is already `ready`, which is the state this guard exists to reject.
    const result = await harness.dispatcher.execute(
      { type: 'dataset.import', payload: { file: new Blob(['a\n1']), datasetId: DATASET_ID } },
      { actor: 'human' },
    );

    expect(result.ok ? null : result.error.code).toBe('IMPORT_FAILED');
  });

  test('an import failure message carries no file contents', async () => {
    const secret = 'alice@example.com';
    const failing = stubDataEngine(() =>
      Promise.resolve(err(domainError('IMPORT_FAILED', 'The file could not be parsed.'))),
    );
    const harness = createHarness(workspaceWithDataset(), failing);
    const { result } = await importThroughDispatcher(harness, new Blob([`email\n${secret}`]));

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : JSON.stringify(result.error)).not.toContain(secret);
  });
});

describe('abort handling', () => {
  test('a signal aborted before dispatch commits nothing', async () => {
    const harness = createHarness();
    const controller = new AbortController();

    controller.abort();

    const result = await harness.dispatcher.execute(
      { type: 'layout.update', payload: { columns: 6 } },
      {
        actor: 'human',
        signal: controller.signal,
      },
    );

    expect(result.ok).toBe(false);
    expect(harness.workspace().revision).toBe(0);
    expect(harness.workspace().layout.columns).toBe(12);
  });

  test('a signal aborted while the engine works abandons the commit', async () => {
    const controller = new AbortController();
    const engine = stubDataEngine(async (_file, datasetId) => {
      // Aborting mid-flight is the case that matters: the handler already did its work.
      controller.abort();

      return ok({ relationId: `dataset_${datasetId.slice(-4)}`, rowCount: 1, columns: [] });
    });

    const harness = createHarness(workspaceWithDataset(), engine);

    const started = await harness.dispatcher.execute(
      { type: 'dataset.beginImport', payload: { name: 'Imported', sourceKind: 'csv', byteSize: 4 } },
      { actor: 'human' },
    );

    const datasetId = started.ok ? started.value.changedEntityIds[0] : undefined;

    if (datasetId === undefined) throw new Error('expected a placeholder dataset');

    const result = await harness.dispatcher.execute(
      { type: 'dataset.import', payload: { file: new Blob(['a\n1']), datasetId } },
      { actor: 'human', signal: controller.signal },
    );

    expect(result.ok).toBe(false);

    // The placeholder commit stands; only the aborted resolution is abandoned.
    expect(harness.workspace().datasets[datasetId]?.importStatus).toBe('loading');
    expect(harness.workspace().revision).toBe(1);
    expect(harness.history()).toHaveLength(1);
  });
});

describe('action results', () => {
  test('a success carries an action id, the new revision, changed ids, and a summary', async () => {
    const harness = createHarness();

    const result = await harness.dispatcher.execute(
      { type: 'filter.apply', payload: { datasetId: DATASET_ID, columnId: 'col_revenue', operator: 'gt', value: 5 } },
      { actor: 'human' },
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value.actionId.startsWith('act_')).toBe(true);
    expect(result.value.revision).toBe(1);
    expect(result.value.changedEntityIds).toHaveLength(1);
    expect(result.value.summary).toContain('revenue');
  });

  test('summaries never contain the filtered value', async () => {
    const harness = createHarness();
    const secret = 987654321;

    const result = await harness.dispatcher.execute(
      {
        type: 'filter.apply',
        payload: { datasetId: DATASET_ID, columnId: 'col_notes', operator: 'eq', value: `${secret}` },
      },
      { actor: 'agent' },
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value.summary).not.toContain(`${secret}`);
    expect(harness.history()[0]?.summary).not.toContain(`${secret}`);
  });
});
