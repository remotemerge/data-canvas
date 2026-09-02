import { MAX_COLUMN_COUNT } from '@/data/import/import-limits.ts';

/**
 * Converts JSON or NDJSON text to CSV for DuckDB's built-in reader.
 *
 * Keeping conversion in JavaScript avoids the JSON extension and its network request. CSV output
 * preserves scalar type inference.
 */

type JsonRecord = Record<string, unknown>;

export class JsonShapeError extends Error {
  constructor() {
    // Keep parser errors free of file content because they reach the UI and agent history.
    super('The JSON file is not an array of records or newline-delimited records.');
    this.name = 'JsonShapeError';
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecords = (text: string): JsonRecord[] => {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    throw new JsonShapeError();
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      if (!parsed.every(isRecord)) {
        throw new JsonShapeError();
      }

      return parsed;
    }

    if (isRecord(parsed)) {
      return [parsed];
    }

    throw new JsonShapeError();
  } catch (error) {
    if (error instanceof JsonShapeError) {
      throw error;
    }

    // A whole-document parse failure may indicate newline-delimited records.
    return parseNewlineDelimited(trimmed);
  }
};

const parseNewlineDelimited = (trimmed: string): JsonRecord[] => {
  const records: JsonRecord[] = [];

  for (const line of trimmed.split('\n')) {
    const candidate = line.trim();

    if (candidate.length === 0) {
      continue;
    }

    let parsedLine: unknown;

    try {
      parsedLine = JSON.parse(candidate);
    } catch {
      throw new JsonShapeError();
    }

    if (!isRecord(parsedLine)) {
      throw new JsonShapeError();
    }

    records.push(parsedLine);
  }

  return records;
};

const collectColumns = (records: readonly JsonRecord[]): string[] => {
  const columns = new Set<string>();

  for (const record of records) {
    for (const key of Object.keys(record)) {
      columns.add(key);

      // Bound output before converting it to an in-memory CSV.
      if (columns.size > MAX_COLUMN_COUNT) {
        throw new JsonShapeError();
      }
    }
  }

  return [...columns];
};

const csvField = (value: unknown): string => {
  // Empty fields become NULL when DuckDB reads the CSV.
  if (value === null || value === undefined) {
    return '';
  }

  // Nested objects and arrays are preserved as JSON text so the CSV keeps one field per column.
  const fieldText = (): string =>
    typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean);

  return `"${fieldText().replaceAll('"', '""')}"`;
};

export const jsonToCsvBytes = (text: string): Uint8Array => {
  const records = parseRecords(text);
  const columns = collectColumns(records);

  if (columns.length === 0) {
    throw new JsonShapeError();
  }

  const lines: string[] = [columns.map(csvField).join(',')];

  for (const record of records) {
    lines.push(columns.map((column) => csvField(record[column])).join(','));
  }

  return new TextEncoder().encode(`${lines.join('\n')}\n`);
};
