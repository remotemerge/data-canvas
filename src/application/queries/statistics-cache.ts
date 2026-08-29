import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * Dataset and column statistics, keyed by dataset revision.
 *
 * These back three decisions that would otherwise each pay for their own query: how to bin a column,
 * whether a result needs sampling, and which order to join datasets in. Recomputing them per query
 * would cancel out the planner's gains, since profiling a column costs roughly what the query it is
 * meant to optimize costs.
 *
 * Revision-keyed rather than time-expired: a statistic is valid exactly as long as the data it
 * describes is unchanged, and the dataset revision is precisely that fact.
 */

export interface DatasetStatistics {
  rowCount: number;
}

export interface ColumnStatisticsEntry {
  /** Bounded: equal to the cap means "at least this many". */
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
  /** Drops everything a dataset contributed. Used when a dataset is removed. */
  invalidateDataset(datasetId: EntityId, columnIds: readonly EntityId[]): void;
  clear(): void;
}

/**
 * Reads an entry, discarding it when it describes a superseded revision.
 *
 * Deleted rather than kept: the revision it describes will never return, so holding it only costs
 * memory.
 */
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
