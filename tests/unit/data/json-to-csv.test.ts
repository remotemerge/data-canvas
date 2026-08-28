import { describe, expect, test } from 'bun:test';
import { JsonShapeError, jsonToCsvBytes } from '@/data/import/json-to-csv.ts';
import { MAX_COLUMN_COUNT } from '@/data/import/import-limits.ts';

const toCsv = (text: string): string => new TextDecoder().decode(jsonToCsvBytes(text));

describe('jsonToCsvBytes', () => {
  test('converts a top-level array of records', () => {
    const csv = toCsv('[{"id":1,"region":"North"},{"id":2,"region":"South"}]');

    expect(csv).toBe('"id","region"\n"1","North"\n"2","South"\n');
  });

  test('converts newline-delimited records', () => {
    const csv = toCsv('{"id":1,"region":"North"}\n{"id":2,"region":"South"}\n');

    expect(csv).toBe('"id","region"\n"1","North"\n"2","South"\n');
  });

  test('ignores blank lines between NDJSON records', () => {
    // Generated NDJSON commonly ends with or contains blank lines; they are not an error.
    expect(toCsv('{"id":1}\n\n{"id":2}\n\n')).toBe('"id"\n"1"\n"2"\n');
  });

  test('accepts a single top-level object as a one-row relation', () => {
    expect(toCsv('{"id":1,"region":"North"}')).toBe('"id","region"\n"1","North"\n');
  });

  test('takes the union of keys so a field in later records is not dropped', () => {
    const csv = toCsv('[{"a":1},{"b":2}]');

    expect(csv).toBe('"a","b"\n"1",\n,"2"\n');
  });

  test('preserves first-seen column order rather than sorting', () => {
    expect(toCsv('[{"z":1,"a":2}]')).toBe('"z","a"\n"1","2"\n');
  });

  test('renders null and missing values as unquoted empty fields, which read back as NULL', () => {
    // Unquoted matters: DuckDB reads a bare empty field as NULL but `""` as an empty string, so
    // quoting here would turn every missing value into a present one.
    expect(toCsv('[{"a":null,"b":1},{"b":2}]')).toBe('"a","b"\n,"1"\n,"2"\n');
  });

  test('escapes embedded quotes by doubling them', () => {
    expect(toCsv('[{"note":"has \\"quotes\\""}]')).toBe('"note"\n"has ""quotes"""\n');
  });

  test('carries embedded commas and newlines inside a quoted field', () => {
    // Unconditional quoting is what makes these safe without a per-value decision.
    expect(toCsv('[{"note":"a, b"}]')).toBe('"note"\n"a, b"\n');
    expect(toCsv('[{"note":"line1\\nline2"}]')).toBe('"note"\n"line1\nline2"\n');
  });

  test('preserves unicode', () => {
    expect(toCsv('[{"city":"東京"}]')).toBe('"city"\n"東京"\n');
  });

  test('preserves booleans and numbers as text the CSV sniffer can retype', () => {
    expect(toCsv('[{"a":true,"b":1.5,"c":-3}]')).toBe('"a","b","c"\n"true","1.5","-3"\n');
  });

  test('encodes a nested object or array rather than dropping it', () => {
    // The domain has no column type for these, so they land as visible text instead of vanishing.
    expect(toCsv('[{"meta":{"k":1}}]')).toBe('"meta"\n"{""k"":1}"\n');
    expect(toCsv('[{"tags":["a","b"]}]')).toBe('"tags"\n"[""a"",""b""]"\n');
  });

  test('a hostile value stays inert data rather than becoming structure', () => {
    const hostile = '"; DROP TABLE x; --';
    const csv = toCsv(JSON.stringify([{ note: hostile }]));

    // Quoted and doubled, so it is one field rather than extra columns or a statement.
    expect(csv).toBe('"note"\n"""; DROP TABLE x; --"\n');
  });

  const rejected: readonly [string, string][] = [
    ['empty input', ''],
    ['whitespace only', '   \n  '],
    ['a bare scalar', '42'],
    ['a bare string', '"hello"'],
    ['an array of scalars', '[1,2,3]'],
    ['an array of arrays', '[[1],[2]]'],
    ['unparseable text', '{{{not json at all'],
    ['a truncated document', '{"a": 1,'],
    ['an array with a non-record member', '[{"a":1},5]'],
  ];

  test.each(rejected)('rejects %s', (_label, text) => {
    expect(() => jsonToCsvBytes(text)).toThrow(JsonShapeError);
  });

  test('rejects a record with no keys at all', () => {
    expect(() => jsonToCsvBytes('[{}]')).toThrow(JsonShapeError);
  });

  test('rejects a file wider than the column cap before expanding it', () => {
    // Bounded here as well as after ingestion, so a pathological file is refused rather than first
    // being expanded into an enormous in-memory CSV.
    const wide = Object.fromEntries(Array.from({ length: MAX_COLUMN_COUNT + 1 }, (_u, i) => [`c${i}`, i]));

    expect(() => jsonToCsvBytes(JSON.stringify([wide]))).toThrow(JsonShapeError);
  });

  test('accepts a file exactly at the column cap', () => {
    const atCap = Object.fromEntries(Array.from({ length: MAX_COLUMN_COUNT }, (_u, i) => [`c${i}`, i]));

    expect(() => jsonToCsvBytes(JSON.stringify([atCap]))).not.toThrow();
  });

  test('the shape error carries no file content', () => {
    // The message reaches the UI and, through history, an agent.
    const secret = 'alice@example.com';

    try {
      jsonToCsvBytes(`{"email": "${secret}"`);
      throw new Error('expected a JsonShapeError');
    } catch (error) {
      expect(error).toBeInstanceOf(JsonShapeError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
