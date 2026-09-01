import { describe, expect, test } from 'bun:test';
import { validateDerivedColumn } from '@/application/validation/validate-derived-column.ts';
import { MAX_EXPRESSION_DEPTH, MAX_EXPRESSION_NODES } from '@/domain/analysis/derived-expression.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import { salesDataset } from './action-fixtures.ts';

const dataset = salesDataset();

const REVENUE: DerivedExpression = { kind: 'column', columnId: 'col_revenue' };
const UNITS: DerivedExpression = { kind: 'column', columnId: 'col_units' };

const validate = (
  expression: DerivedExpression,
  derived: Record<string, DerivedColumn> = {},
  name = 'Derived',
  id?: string,
) => validateDerivedColumn(dataset, { name, expression, ...(id === undefined ? {} : { id }) }, derived);

// A left-leaning chain of the requested depth, used to probe the depth cap.
const nest = (depth: number): DerivedExpression =>
  depth <= 1 ? REVENUE : { kind: 'arithmetic', op: 'add', left: nest(depth - 1), right: UNITS };

const derivedColumn = (id: string, expression: DerivedExpression): DerivedColumn => ({
  id,
  datasetId: dataset.id,
  name: id,
  expression,
  logicalType: 'number',
  typeVerified: false,
  createdBy: 'agent',
});

describe('derived column validation', () => {
  test('a well-formed definition returns the trimmed name and the inferred type', () => {
    const result = validate({ kind: 'arithmetic', op: 'div', left: REVENUE, right: UNITS }, {}, '  Margin  ');

    expect(result).toEqual({ ok: true, value: { name: 'Margin', logicalType: 'number' } });
  });

  test('a blank or over-long name is rejected', () => {
    expect(validate(REVENUE, {}, '   ').ok).toBe(false);
    expect(validate(REVENUE, {}, 'x'.repeat(81)).ok).toBe(false);
  });

  test('depth at the cap is accepted and one past it is refused', () => {
    expect(validate(nest(MAX_EXPRESSION_DEPTH)).ok).toBe(true);

    const result = validate(nest(MAX_EXPRESSION_DEPTH + 1));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RESULT_LIMIT_EXCEEDED');
      // The message states both the actual depth and the limit, so a caller can correct in one step.
      expect(result.error.details).toMatchObject({ maxDepth: MAX_EXPRESSION_DEPTH });
    }
  });

  test('a wide but shallow tree is refused once it passes the node cap', () => {
    // A single case with many arms stays shallow while its node count climbs.
    const wide: DerivedExpression = {
      kind: 'case',
      when: Array.from({ length: 24 }, () => ({
        left: REVENUE,
        operator: 'gt' as const,
        right: { kind: 'literal' as const, value: 1 },
        result: { kind: 'literal' as const, value: 1 },
      })),
      otherwise: { kind: 'literal', value: 0 },
    };

    const result = validate(wide);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details).toMatchObject({ maxNodes: MAX_EXPRESSION_NODES });
  });

  test('an operator outside the closed set is refused, since the tree arrives as unknown from a tool', () => {
    const result = validate({
      kind: 'arithmetic',
      op: 'pow' as 'add',
      left: REVENUE,
      right: UNITS,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('a nested bin strategy is bounds-checked along with the rest of the tree', () => {
    const result = validate({
      kind: 'bin',
      columnId: 'col_revenue',
      strategy: { kind: 'equalWidth', binCount: 5000 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RESULT_LIMIT_EXCEEDED');
  });

  test('type errors surface from inference rather than reaching the compiler', () => {
    const result = validate({
      kind: 'arithmetic',
      op: 'add',
      left: { kind: 'column', columnId: 'col_notes' },
      right: { kind: 'column', columnId: 'col_notes' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
  });

  test('a derived column may build on a previously defined one', () => {
    const base = derivedColumn('col_base', { kind: 'arithmetic', op: 'div', left: REVENUE, right: UNITS });

    const result = validate(
      { kind: 'arithmetic', op: 'mul', left: { kind: 'column', columnId: 'col_base' }, right: UNITS },
      {
        col_base: base,
      },
    );

    expect(result.ok).toBe(true);
  });

  test('a definition that would reference itself is refused', () => {
    const existing = derivedColumn('col_self', REVENUE);

    const result = validate({ kind: 'column', columnId: 'col_self' }, { col_self: existing }, 'Self', 'col_self');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('a mutual cycle between two derived columns is refused', () => {
    // `a` already points at `b`; redefining `b` to point back at `a` closes the loop.
    const a = derivedColumn('col_a', { kind: 'column', columnId: 'col_b' });
    const b = derivedColumn('col_b', REVENUE);

    const result = validate({ kind: 'column', columnId: 'col_a' }, { col_a: a, col_b: b }, 'B', 'col_b');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_OPERATION');
  });

  test('a reference to a column that does not exist is refused', () => {
    const result = validate({ kind: 'column', columnId: 'col_missing' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });

  test('derived columns on another dataset are out of scope', () => {
    const other: DerivedColumn = { ...derivedColumn('col_other', REVENUE), datasetId: 'ds_elsewhere' };

    const result = validate({ kind: 'column', columnId: 'col_other' }, { col_other: other });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });
});
