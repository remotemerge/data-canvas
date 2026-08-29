import { describe, expect, test } from 'bun:test';
import { stubDataEngine } from '@/../tests/unit/application/action-fixtures.ts';
import { exportWorkspace } from '@/data/portability/export-workspace.ts';
import { importArchive } from '@/data/portability/import-archive.ts';
import { MANIFEST_ENTRY } from '@/data/portability/archive-manifest.ts';
import { createEmptyWorkspace, type Workspace } from '@/domain/workspace/workspace.ts';

/** A minimal but complete workspace: one ready dataset and one chart that references it. */
const sourceWorkspace = (): Workspace => {
  const base = createEmptyWorkspace('Exported');

  return {
    ...base,
    datasets: {
      ds_a: {
        id: 'ds_a',
        name: 'Orders',
        relationId: 'dataset_aaaaaaaaaaaa',
        source: { kind: 'csv', fileName: 'orders.csv', byteSize: 12, importedAt: '2026-01-01T00:00:00.000Z' },
        rowCount: 42,
        columns: [
          { id: 'col_a', name: 'a', physicalName: 'c0', databaseType: 'DOUBLE', logicalType: 'number', nullable: true },
        ],
        revision: 1,
        importStatus: 'ready',
      },
    },
    visualizations: {
      viz_a: {
        id: 'viz_a',
        datasetId: 'ds_a',
        title: 'Chart',
        kind: 'bar',
        query: { datasetId: 'ds_a', dimensions: ['col_a'], measures: [], filters: [] },
        binding: { x: 'col_a' },
        presentation: { showLegend: true, showGrid: true, stacked: false },
        linkMode: 'highlight',
        createdBy: 'human',
      },
    },
  };
};

/** An engine whose Parquet export reports the schema the given workspace declares. */
const engineFor = (workspace: Workspace) =>
  stubDataEngine(undefined, (datasetId) => workspace.datasets[datasetId]?.columns ?? []);

const exportBytes = async (mode: 'full' | 'definition-only', workspace = sourceWorkspace()): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  const result = await exportWorkspace({
    workspace,
    mode,
    appVersion: '1.0.0',
    dataEngine: engineFor(workspace),
    write: (chunk) => {
      chunks.push(new Uint8Array(chunk));
      return Promise.resolve();
    },
  });
  expect(result.ok).toBe(true);

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

describe('archive round trip', () => {
  test('a full export restores its structure with regenerated IDs', async () => {
    const restored = await importArchive(await exportBytes('full'), stubDataEngine());
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    expect(restored.value.missingDatasetNames).toEqual([]);
    expect(Object.keys(restored.value.workspace.datasets)).toHaveLength(1);
    expect(Object.keys(restored.value.workspace.visualizations)).toHaveLength(1);

    const dataset = Object.values(restored.value.workspace.datasets)[0]!;
    const visualization = Object.values(restored.value.workspace.visualizations)[0]!;
    expect(dataset.id).not.toBe('ds_a');
    expect(dataset.importStatus).toBe('ready');
    expect(visualization.datasetId).toBe(dataset.id);
    expect(visualization.binding.x).toBe(dataset.columns[0]!.id);
  });

  test('a definition-only export restores structure and names the missing datasets', async () => {
    const restored = await importArchive(await exportBytes('definition-only'), stubDataEngine());
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    expect(restored.value.missingDatasetNames).toEqual(['Orders']);
    const dataset = Object.values(restored.value.workspace.datasets)[0]!;
    expect(dataset.importStatus).toBe('error');
    expect(dataset.rowCount).toBeNull();
    // The chart survives so the analysis structure is intact once data is re-imported.
    expect(Object.keys(restored.value.workspace.visualizations)).toHaveLength(1);
  });

  test('the imported workspace starts at revision zero with a fresh identity', async () => {
    const original = sourceWorkspace();
    const restored = await importArchive(await exportBytes('full', { ...original, revision: 17 }), stubDataEngine());
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    expect(restored.value.workspace.revision).toBe(0);
    expect(restored.value.workspace.id).not.toBe(original.id);
  });
});

describe('archive rejection', () => {
  test('rejects a file that is not an archive', async () => {
    const result = await importArchive(new TextEncoder().encode('not a zip'), stubDataEngine());
    expect(result.ok).toBe(false);
  });

  test('rejects a truncated archive', async () => {
    const bytes = await exportBytes('full');
    const result = await importArchive(bytes.subarray(0, Math.floor(bytes.byteLength / 2)), stubDataEngine());
    expect(result.ok).toBe(false);
  });

  test('rejects an archive whose workspace bytes no longer match the manifest checksum', async () => {
    const bytes = await exportBytes('full');
    // Corrupt the workspace payload. The local header CRC is recomputed by no one, so this is
    // caught at the archive layer; the manifest checksum is the second, independent guard.
    const marker = new TextEncoder().encode('"Exported"');
    const index = bytes.findIndex((_byte, position) =>
      marker.every((value, offset) => bytes[position + offset] === value),
    );
    expect(index).toBeGreaterThan(-1);
    bytes[index + 1] = bytes[index + 1]! ^ 0xff;

    const result = await importArchive(bytes, stubDataEngine());
    expect(result.ok).toBe(false);
  });

  test('rejects a workspace payload that is not structurally valid', async () => {
    const bytes = await exportBytes('full');
    // Break a required top-level field so `isWorkspacePayload` refuses it. Rewritten in place at
    // equal length, so only the manifest checksum and this guard can catch it.
    const marker = new TextEncoder().encode('"datasets"');
    const index = bytes.findIndex((_byte, position) =>
      marker.every((value, offset) => bytes[position + offset] === value),
    );
    expect(index).toBeGreaterThan(-1);
    bytes.set(new TextEncoder().encode('"datasetX"'), index);

    const result = await importArchive(bytes, stubDataEngine());
    expect(result.ok).toBe(false);
  });

  test('rejects an archive with no manifest', async () => {
    const bytes = await exportBytes('full');
    // Rename the manifest entry in place, so the archive parses but the manifest is unreachable.
    const marker = new TextEncoder().encode(MANIFEST_ENTRY);
    const index = bytes.findIndex((_byte, position) =>
      marker.every((value, offset) => bytes[position + offset] === value),
    );
    expect(index).toBeGreaterThan(-1);
    bytes[index] = 'x'.charCodeAt(0);

    const result = await importArchive(bytes, stubDataEngine());
    expect(result.ok).toBe(false);
  });

  test('rejects an oversized archive before reading it', async () => {
    // A byte length beyond the bound is refused without the reader ever walking the buffer.
    const oversized = { byteLength: 3 * 1024 * 1024 * 1024 } as Uint8Array;
    const result = await importArchive(oversized, stubDataEngine());
    expect(result.ok).toBe(false);
  });
});
