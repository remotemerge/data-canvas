import { MAX_COLUMN_COUNT } from '@/data/import/import-limits.ts';

/**
 * Converts a JSON or NDJSON file into CSV bytes for DuckDB's built-in CSV reader.
 *
 * **Why not DuckDB's JSON reader.** `read_json_auto` needs the `json` extension, and
 * `LOAD json` fetches it from `extensions.duckdb.org` — DuckDB-Wasm reports it as
 * `installed: false`, so the load is a network request. That would put a third-party fetch on the
 * import path and break JSON import offline, both of which the local-first requirement forbids.
 * (`insertJSONFromPath` is not an alternative: it fails on every shape in this DuckDB-Wasm version
 * with "Provided table/dataframe must have at least one column".)
 *
 * Re-emitting as CSV keeps ingestion entirely inside the built-in reader, so JSON import works
 * offline and issues no request. Type inference is unaffected — the CSV sniffer recovers
 * `BIGINT`, `DOUBLE`, `BOOLEAN`, `DATE`, and `VARCHAR` from the re-emitted text, which is verified
 * in the browser against `records.json` and `records.ndjson`.
 */

/** Both accepted JSON layouts: a top-level array of objects, or one object per line. */
type JsonRecord = Record<string, unknown>;

/** Raised when the input is not a shape the importer can turn into a relation. */
export class JsonShapeError extends Error {
  constructor() {
    // The message carries no file content: it reaches the UI and, through history, an agent.
    super('The JSON file is not an array of records or newline-delimited records.');
    this.name = 'JsonShapeError';
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Parses either supported layout.
 *
 * A top-level array is tried first because `JSON.parse` either succeeds on the whole document or
 * fails outright, which makes it a cheap and unambiguous test. Only on failure is the input
 * re-read as newline-delimited records.
 */
const parseRecords = (text: string): JsonRecord[] => {
  const trimmed = text.trim();

  if (trimmed.length === 0) throw new JsonShapeError();

  try {
    const parsed: unknown = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      if (!parsed.every(isRecord)) throw new JsonShapeError();

      return parsed;
    }

    // A single top-level object is a one-row relation, which is a reasonable thing to import.
    if (isRecord(parsed)) return [parsed];

    throw new JsonShapeError();
  } catch (error) {
    if (error instanceof JsonShapeError) throw error;

    // Not a single JSON document, so try newline-delimited records.
    const records: JsonRecord[] = [];

    for (const line of trimmed.split('\n')) {
      const candidate = line.trim();

      // Blank lines between records are common in generated NDJSON and are not an error.
      if (candidate.length === 0) continue;

      let parsedLine: unknown;

      try {
        parsedLine = JSON.parse(candidate);
      } catch {
        throw new JsonShapeError();
      }

      if (!isRecord(parsedLine)) throw new JsonShapeError();

      records.push(parsedLine);
    }

    if (records.length === 0) throw new JsonShapeError();

    return records;
  }
};

/**
 * Collects the column set in first-seen order.
 *
 * Records in a JSON file need not share a key set, so the union is taken rather than the first
 * record's keys — otherwise a field appearing only in later rows would be silently dropped.
 * Insertion order is preserved so the resulting columns match the file's own reading order.
 */
const collectColumns = (records: readonly JsonRecord[]): string[] => {
  const columns = new Set<string>();

  for (const record of records) {
    for (const key of Object.keys(record)) {
      columns.add(key);

      // Bounded here as well as after ingestion: a pathological file must not first be expanded
      // into an enormous in-memory CSV and only then rejected.
      if (columns.size > MAX_COLUMN_COUNT) throw new JsonShapeError();
    }
  }

  return [...columns];
};

/**
 * Renders one value as a CSV field.
 *
 * Everything non-null is quoted unconditionally rather than only when it contains a delimiter.
 * Unconditional quoting is what makes embedded commas, quotes, and newlines safe without a
 * per-value decision, and it costs two bytes.
 *
 * Nested objects and arrays are JSON-encoded rather than flattened. The domain has no column type
 * for them, so they land as text the user can see instead of silently vanishing.
 */
const csvField = (value: unknown): string => {
  // `undefined` and `null` both become an empty field, which the CSV reader reads back as NULL.
  if (value === null || value === undefined) return '';

  const text =
    typeof value === 'object' ? JSON.stringify(value) : typeof value === 'bigint' ? value.toString() : String(value);

  return `"${text.replaceAll('"', '""')}"`;
};

/**
 * Converts JSON or NDJSON text into CSV bytes.
 *
 * Throws `JsonShapeError` for input that is not a set of records; the caller maps that onto the
 * generic `IMPORT_FAILED`, so no parser detail reaches the user or an agent.
 */
export const jsonToCsvBytes = (text: string): Uint8Array => {
  const records = parseRecords(text);
  const columns = collectColumns(records);

  if (columns.length === 0) throw new JsonShapeError();

  const lines: string[] = [columns.map(csvField).join(',')];

  for (const record of records) {
    lines.push(columns.map((column) => csvField(record[column])).join(','));
  }

  return new TextEncoder().encode(`${lines.join('\n')}\n`);
};
