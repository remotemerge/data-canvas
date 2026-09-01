import type { DatasetSourceKind } from '@/domain/dataset/dataset.ts';

// Bounds checked before any file reaches DuckDB.

// Maximum accepted file size.
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

// Maximum accepted column count.
export const MAX_COLUMN_COUNT = 512;

// Accepted file extensions and their ingestion paths.
export const ALLOWED_EXTENSIONS: Readonly<Record<string, DatasetSourceKind>> = {
  '.csv': 'csv',
  '.tsv': 'csv',
  '.json': 'json',
  '.ndjson': 'json',
};

// File-input accept value; submission validation remains authoritative.
export const FILE_INPUT_ACCEPT = Object.keys(ALLOWED_EXTENSIONS).join(',');

// Explicit delimiters for file extensions.
export const DELIMITER_BY_EXTENSION: Readonly<Record<string, string>> = { '.tsv': '\t' };

// Maximum rows returned by import preview.
export const PREVIEW_ROW_LIMIT = 50;

// Hard ceiling for windowed reads; enforced inside the engine.
export const MAX_TABLE_WINDOW_ROWS = 500;

// Returns a lowercase filename extension, including the dot.
export const fileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.');

  return lastDot === -1 ? '' : fileName.slice(lastDot).toLowerCase();
};

// Formats a byte budget for user-facing errors.
export const formatByteBudget = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;
