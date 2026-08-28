import { describe, expect, test } from 'bun:test';
import { ingestionFailure, validateColumnCount, validateImportFile } from '@/data/import/import-dataset.ts';
import { MAX_COLUMN_COUNT, MAX_FILE_BYTES, fileExtension } from '@/data/import/import-limits.ts';

/** Builds a `File` without materializing its bytes, so size limits are testable cheaply. */
const fileOfSize = (name: string, size: number): File => {
  const file = new File(['x'], name);

  Object.defineProperty(file, 'size', { value: size });

  return file;
};

describe('fileExtension', () => {
  test('reads the final extension', () => {
    expect(fileExtension('sales.csv')).toBe('.csv');
    expect(fileExtension('archive.tar.csv')).toBe('.csv');
  });

  test('lowercases the extension', () => {
    expect(fileExtension('SALES.CSV')).toBe('.csv');
  });

  test('returns nothing for a name without one, so the allowlist rejects it', () => {
    expect(fileExtension('sales')).toBe('');
  });
});

describe('validateImportFile', () => {
  test('accepts each allowed extension and routes it to the right parser', () => {
    const expectations: readonly [string, string][] = [
      ['sales.csv', 'csv'],
      ['sales.tsv', 'csv'],
      ['records.json', 'json'],
      ['records.ndjson', 'json'],
    ];

    for (const [name, sourceKind] of expectations) {
      const result = validateImportFile(new File(['a\n1'], name));

      expect(result.ok).toBe(true);
      expect(result.ok ? result.value.sourceKind : null).toBe(sourceKind as never);
    }
  });

  test('passes an explicit delimiter for TSV, where the sniffer is unreliable', () => {
    const result = validateImportFile(new File(['a\tb'], 'sales.tsv'));

    expect(result.ok ? result.value.delimiter : null).toBe('\t');
  });

  test('leaves delimiter detection to DuckDB for CSV', () => {
    const result = validateImportFile(new File(['a,b'], 'sales.csv'));

    expect(result.ok ? result.value.delimiter : 'set').toBeUndefined();
  });

  const rejected = ['sales.xlsx', 'sales.parquet', 'sales.exe', 'sales', 'sales.csv.exe', '.csv.zip'];

  test.each(rejected)('rejects %p with IMPORT_FAILED', (name) => {
    const result = validateImportFile(new File(['a'], name));

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('IMPORT_FAILED');
  });

  test('rejects an empty file', () => {
    const result = validateImportFile(fileOfSize('sales.csv', 0));

    expect(result.ok ? null : result.error.code).toBe('IMPORT_FAILED');
  });

  test('rejects a file over the size budget', () => {
    const result = validateImportFile(fileOfSize('sales.csv', MAX_FILE_BYTES + 1));

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.details?.['maxBytes']).toBe(MAX_FILE_BYTES);
  });

  test('accepts a file exactly at the budget', () => {
    expect(validateImportFile(fileOfSize('sales.csv', MAX_FILE_BYTES)).ok).toBe(true);
  });

  test('rejects anything that is not a file', () => {
    for (const value of [null, undefined, 'sales.csv', 42, {}, new Blob(['a'])]) {
      expect(validateImportFile(value).ok).toBe(false);
    }
  });

  test('keeps a hostile filename as display text without acting on it', () => {
    // The filename must survive verbatim for display and never influence anything else.
    const hostile = 'Q4 sales; DROP TABLE x.csv';
    const result = validateImportFile(new File(['a\n1'], hostile));

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.fileName : null).toBe(hostile);
  });

  test('a rejection message never contains the filename', () => {
    // Filenames are untrusted content and must not be echoed into text that reaches an agent.
    const secret = 'patients-alice-bob';
    const result = validateImportFile(new File(['a'], `${secret}.xlsx`));

    expect(result.ok ? '' : JSON.stringify(result.error)).not.toContain(secret);
  });
});

describe('validateColumnCount', () => {
  test('accepts a schema within the cap', () => {
    expect(validateColumnCount(1).ok).toBe(true);
    expect(validateColumnCount(MAX_COLUMN_COUNT).ok).toBe(true);
  });

  test('rejects a schema with no columns', () => {
    expect(validateColumnCount(0).ok).toBe(false);
  });

  test('rejects a schema past the cap', () => {
    const result = validateColumnCount(MAX_COLUMN_COUNT + 1);

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.details?.['maxColumns']).toBe(MAX_COLUMN_COUNT);
  });
});

describe('ingestionFailure', () => {
  test('is generic, carrying nothing the parser saw', () => {
    // DuckDB parse errors quote the offending line, so the engine's own message is dropped rather
    // than forwarded into an error that reaches the UI and an agent.
    const error = ingestionFailure();

    expect(error.code).toBe('IMPORT_FAILED');
    expect(error.message).not.toContain('line');
    expect(error.details).toBeUndefined();
  });
});
