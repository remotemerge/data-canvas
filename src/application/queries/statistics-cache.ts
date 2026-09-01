import type { EntityId } from '@/shared/ids/entity-id.ts';

// Column statistics cached by dataset revision.

export interface DatasetStatistics {
  rowCount: number;
}

export interface ColumnStatisticsEntry {
  // Capped distinct count; equality with the cap means "at least this many."
  distinctCount: number;
  distinctCountCapped: boolean;
  min?: number;
  max?: number;
}

interface RevisionedEntry<T> {
  revision: number;
  value: T;
}

export interface StatisticsCache {
  datasetStatistics(datasetId: EntityId, revision: number): DatasetStatistics | undefined;
  setDatasetStatistics(datasetId: EntityId, revision: number, value: DatasetStatistics): void;
  columnStatistics(columnId: EntityId, revision: number): ColumnStatisticsEntry | undefined;
  setColumnStatistics(columnId: EntityId, revision: number, value: ColumnStatisticsEntry): void;
  // Removes all entries contributed by a dataset.
  invalidateDataset(datasetId: EntityId, columnIds: readonly EntityId[]): void;
  clear(): void;
}

// Reads an entry only when its dataset revision is still current.
const readForRevision = <T>(
  store: Map<EntityId, RevisionedEntry<T>>,
  id: EntityId,
  revision: number,
): T | undefined => {
  const entry = store.get(id);

  if (entry === undefined) return undefined;
  if (entry.revision !== revision) {
    store.delete(id);

    return undefined;
  }

  return entry.value;
};

export const createStatisticsCache = (): StatisticsCache => {
  const datasets = new Map<EntityId, RevisionedEntry<DatasetStatistics>>();
  const columns = new Map<EntityId, RevisionedEntry<ColumnStatisticsEntry>>();

  return {
    datasetStatistics: (datasetId, revision) => readForRevision(datasets, datasetId, revision),
    setDatasetStatistics: (datasetId, revision, value) => {
      datasets.set(datasetId, { revision, value });
    },
    columnStatistics: (columnId, revision) => readForRevision(columns, columnId, revision),
    setColumnStatistics: (columnId, revision, value) => {
      columns.set(columnId, { revision, value });
    },
    invalidateDataset: (datasetId, columnIds) => {
      datasets.delete(datasetId);
      for (const columnId of columnIds) columns.delete(columnId);
    },
    clear: () => {
      datasets.clear();
      columns.clear();
    },
  };
};
