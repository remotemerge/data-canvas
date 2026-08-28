import type { DatasetSourceKind } from '@/domain/dataset/dataset.ts';

/**
 * Bounds applied to a file before any of it reaches DuckDB.
 *
 * Imported files are untrusted input. Every limit here is a refusal the user sees as a plain
 * message rather than a crash, an unresponsive tab, or an out-of-memory kill.
 */

/**
 * The largest file accepted for import.
 *
 * DuckDB-Wasm ingests through a registered buffer, so the file is held in the worker's linear
 * memory during ingestion. 512 MB leaves headroom under the browser's Wasm memory ceiling while
 * still covering datasets far beyond what the table and charts need.
 */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

/**
 * The widest schema the UI will accept.
 *
 * The schema panel renders one row per column and the table one header cell per column, so a
 * pathologically wide file degrades the interface long before it troubles the engine.
 */
export const MAX_COLUMN_COUNT = 512;

/**
 * Extensions accepted for import, mapped to the ingestion path each one uses.
 *
 * The extension selects the parser; it never becomes part of an identifier. `.ndjson` and `.json`
 * both route to DuckDB's JSON reader, which auto-detects newline-delimited input.
 */
export const ALLOWED_EXTENSIONS: Readonly<Record<string, DatasetSourceKind>> = {
  '.csv': 'csv',
  '.tsv': 'csv',
  '.json': 'json',
  '.ndjson': 'json',
};

/** The `accept` attribute for the file input. Advisory only — the real check runs on submission. */
export const FILE_INPUT_ACCEPT = Object.keys(ALLOWED_EXTENSIONS).join(',');

/**
 * Delimiter per extension.
 *
 * Passed explicitly for `.tsv` because DuckDB's sniffer can mistake a tab-separated file with
 * commas inside its values for a comma-separated one.
 */
export const DELIMITER_BY_EXTENSION: Readonly<Record<string, string>> = { '.tsv': '\t' };

/** Rows returned by the import preview. Small on purpose: proving the data path, not browsing it. */
export const PREVIEW_ROW_LIMIT = 50;

/**
 * Hard ceiling on any windowed read, regardless of what a caller requests.
 *
 * Enforced inside the engine rather than at its call sites, so no caller — human-driven or
 * agent-driven — can widen it.
 */
export const MAX_TABLE_WINDOW_ROWS = 500;

/**
 * Returns the lowercase extension of a filename, including the dot.
 *
 * Takes the final dot so `archive.tar.csv` reads as `.csv`, and returns an empty string for a name
 * with no extension so the allowlist rejects it.
 */
export const fileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.');

  return lastDot === -1 ? '' : fileName.slice(lastDot).toLowerCase();
};

/** Formats a byte budget for a user-facing message. Never reports the rejected file's own size. */
export const formatByteBudget = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;
