import type { Column } from '@/domain/dataset/dataset.ts';
import type { AnalysisQuery, SortSpec } from '@/domain/analysis/analysis-query.ts';
import type { ColumnRange } from '@/domain/analysis/bin-strategy.ts';
import type { Filter, FilterExpression } from '@/domain/filter/filter.ts';
import type { ResultColumn } from '@/data/compiler/result-columns.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

// A single cell the engine can return. Structured values are converted before they cross the port.
export type ScalarValue = string | number | boolean | null;

// Result of importing a file into an engine relation.
export interface ImportedRelation {
  relationId: string;
  rowCount: number;
  columns: Column[];
}

// Bounded row-window request. The engine clamps `limit`; rows align with `columnIds`.
export interface TableWindowRequest {
  datasetId: EntityId;
  offset: number;
  limit: number;
  sort?: SortSpec[];
  filters: Filter[];
  // Selection predicate applied alongside the filters; expresses shapes a flat `Filter` cannot, such as `or`.
  selectionPredicate?: FilterExpression;
  signal?: AbortSignal;
}

export interface TableWindow {
  rows: readonly ScalarValue[][];
  // Column IDs in row order.
  columnIds: readonly EntityId[];
  offset: number;
  // True when a newer request superseded this window; callers must discard it.
  stale: boolean;
  columns: ResultColumn[];
  totalRowCount: number;
}

export interface AnalysisResult {
  rows: readonly ScalarValue[][];
  columns: ResultColumn[];
  // Value-free warning for the UI and agent responses, currently used for join fan-out.
  warning?: string;
  // True when a newer request superseded this result; callers must discard it.
  stale?: boolean;
}

// Scheduling options for an analysis query. A `key` enables same-key supersession.
export interface AnalysisExecutionOptions {
  key?: string;
  signal?: AbortSignal;
}

export interface DistinctValuesRequest {
  datasetId: EntityId;
  columnId: EntityId;
  filters: Filter[];
  limit?: number;
  signal?: AbortSignal;
}

export interface DistinctValue {
  value: ScalarValue;
  count: number;
}

export interface DistinctValuesResult {
  values: DistinctValue[];
  truncated: boolean;
}

// Bounded aggregate profile for one column. `topValues` contains capped dataset content.
export interface ColumnStatisticsRequest {
  datasetId: EntityId;
  columnId: EntityId;
  filters: Filter[];
  // Maximum number of frequent values returned; the engine clamps it.
  topValueLimit?: number;
  signal?: AbortSignal;
}

export interface ColumnStatistics {
  rowCount: number;
  nullCount: number;
  // Capped count; equality with the cap means "at least this many."
  distinctCount: number;
  distinctCountCapped: boolean;
  // Numeric values, or ISO strings for date and timestamp columns.
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  stddev?: number;
  // Text and category columns only; values are dataset content.
  topValues?: { value: ScalarValue; count: number }[];
}

// Request for the numeric extent used by equal-width bins.
export interface ColumnRangeRequest {
  datasetId: EntityId;
  columnId: EntityId;
  filters: Filter[];
  signal?: AbortSignal;
}

// Bounded sample used to warn about duplicate join keys.
export interface KeyQualityRequest {
  datasetId: EntityId;
  columnIds: EntityId[];
  sampleRows: number;
  signal?: AbortSignal;
}

export interface KeyQualityResult {
  sampledRows: number;
  distinctKeys: number;
}

// Application-facing analytical engine port; DuckDB types stay inside the adapter.
// Import progress reported while a file is read, ingested, and profiled.
export interface ImportProgress {
  phase: 'reading' | 'ingesting' | 'profiling';
  // Bytes read so far, present during `reading`.
  bytesRead?: number;
  totalBytes?: number;
}

export interface DataEnginePort {
  importFile(
    file: unknown,
    datasetId: EntityId,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<Result<ImportedRelation, DomainError>>;
  fetchTableWindow(request: TableWindowRequest): Promise<Result<TableWindow, DomainError>>;
  executeAnalysis(
    query: AnalysisQuery,
    options?: AnalysisExecutionOptions,
  ): Promise<Result<AnalysisResult, DomainError>>;
  getDistinctValues(request: DistinctValuesRequest): Promise<Result<DistinctValuesResult, DomainError>>;
  getColumnStatistics(request: ColumnStatisticsRequest): Promise<Result<ColumnStatistics, DomainError>>;
  getColumnRange(request: ColumnRangeRequest): Promise<Result<ColumnRange, DomainError>>;
  measureKeyQuality(request: KeyQualityRequest): Promise<Result<KeyQualityResult, DomainError>>;
  // Drops a dataset relation and cached metadata. Unknown IDs succeed.
  dropDataset(datasetId: EntityId): Promise<Result<void, DomainError>>;
}

// Engine placeholder used before initialization and by handler tests.
const unavailable = (): Result<never, DomainError> =>
  err({ code: 'ENGINE_UNAVAILABLE', message: 'The analytical engine is not available yet.' });

export const unavailableDataEngine: DataEnginePort = {
  importFile: () => Promise.resolve(unavailable()),
  fetchTableWindow: () => Promise.resolve(unavailable()),
  executeAnalysis: () => Promise.resolve(unavailable()),
  getDistinctValues: () => Promise.resolve(unavailable()),
  getColumnStatistics: () => Promise.resolve(unavailable()),
  getColumnRange: () => Promise.resolve(unavailable()),
  measureKeyQuality: () => Promise.resolve(unavailable()),
  dropDataset: () => Promise.resolve(unavailable()),
};
