import { describe, expect, test } from 'bun:test';
import { createColumnTypeResolver, inferExpressionType } from '@/application/validation/infer-expression-type.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import { SALES_COLUMNS } from './action-fixtures.ts';

const resolve = createColumnTypeResolver(SALES_COLUMNS);

const infer = (expression: DerivedExpression) => inferExpressionType(expression, resolve);

const REVENUE: DerivedExpression = { kind: 'column', columnId: 'col_revenue' };
const UNITS: DerivedExpression = { kind: 'column', columnId: 'col_units' };
const NOTES: DerivedExpression = { kind: 'column', columnId: 'col_notes' };

// A single-arm case comparing two operands, used to probe which type pairs are comparable.
const armFor = (left: DerivedExpression, right: DerivedExpression): DerivedExpression => ({
  kind: 'case',
  when: [{ left, operator: 'eq', right, result: { kind: 'literal', value: 1 } }],
  otherwise: { kind: 'literal', value: 0 },
});

describe('expression type inference', () => {
  test('a column reference takes the column own type', () => {
    expect(infer(REVENUE)).toEqual({ ok: true, value: 'number' });
    expect(infer(NOTES)).toEqual({ ok: true, value: 'string' });
  });

  test('an unknown column is rejected rather than assumed', () => {
    const result = infer({ kind: 'column', columnId: 'col_missing' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });

  test('literals take the type of their value, and null stays unknown', () => {
    expect(infer({ kind: 'literal', value: 4 })).toEqual({ ok: true, value: 'number' });
    expect(infer({ kind: 'literal', value: 'x' })).toEqual({ ok: true, value: 'string' });
    expect(infer({ kind: 'literal', value: true })).toEqual({ ok: true, value: 'boolean' });
    expect(infer({ kind: 'literal', value: null })).toEqual({ ok: true, value: 'unknown' });
  });

  test('arithmetic over two numbers yields a number', () => {
    expect(infer({ kind: 'arithmetic', op: 'div', left: REVENUE, right: UNITS })).toEqual({
      ok: true,
      value: 'number',
    });
  });

  test('arithmetic over strings is rejected as incompatible', () => {
    const result = infer({ kind: 'arithmetic', op: 'add', left: NOTES, right: NOTES });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
      // The message names the offending side so a caller can correct without another round trip.
      expect(result.error.message).toContain('numeric');
    }
  });

  test('a null literal operand does not block arithmetic, since it has no type yet', () => {
    expect(infer({ kind: 'arithmetic', op: 'mul', left: REVENUE, right: { kind: 'literal', value: null } })).toEqual({
      ok: true,
      value: 'number',
    });
  });

  test('datePart requires a temporal column and produces a number', () => {
    expect(infer({ kind: 'datePart', part: 'month', columnId: 'col_date' })).toEqual({ ok: true, value: 'number' });

    const result = infer({ kind: 'datePart', part: 'month', columnId: 'col_revenue' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
    }
  });

  test('numeric binning needs a numeric column and temporal binning a temporal one', () => {
    expect(infer({ kind: 'bin', columnId: 'col_revenue', strategy: { kind: 'equalWidth', binCount: 10 } })).toEqual({
      ok: true,
      value: 'number',
    });
    expect(infer({ kind: 'bin', columnId: 'col_date', strategy: { kind: 'temporal', unit: 'month' } })).toEqual({
      ok: true,
      value: 'date',
    });

    expect(infer({ kind: 'bin', columnId: 'col_date', strategy: { kind: 'equalWidth', binCount: 10 } }).ok).toBe(false);
    expect(infer({ kind: 'bin', columnId: 'col_revenue', strategy: { kind: 'temporal', unit: 'day' } }).ok).toBe(false);
  });

  test('a cast adopts its target type but still resolves its operand', () => {
    expect(infer({ kind: 'cast', to: 'string', expr: REVENUE })).toEqual({ ok: true, value: 'string' });
    expect(infer({ kind: 'cast', to: 'number', expr: { kind: 'column', columnId: 'col_missing' } }).ok).toBe(false);
  });

  test('case branches must agree, ignoring null fallbacks', () => {
    const agreeing: DerivedExpression = {
      kind: 'case',
      when: [
        {
          left: REVENUE,
          operator: 'gt',
          right: { kind: 'literal', value: 100 },
          result: { kind: 'literal', value: 1 },
        },
      ],
      otherwise: { kind: 'literal', value: null },
    };

    expect(infer(agreeing)).toEqual({ ok: true, value: 'number' });

    const conflicting: DerivedExpression = {
      kind: 'case',
      when: [
        {
          left: REVENUE,
          operator: 'gt',
          right: { kind: 'literal', value: 100 },
          result: { kind: 'literal', value: 1 },
        },
      ],
      otherwise: { kind: 'literal', value: 'high' },
    };

    const result = infer(conflicting);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
    }
  });

  test('a case arm comparing across type families is rejected', () => {
    const result = infer({
      kind: 'case',
      when: [{ left: REVENUE, operator: 'eq', right: NOTES, result: { kind: 'literal', value: 1 } }],
      otherwise: { kind: 'literal', value: 0 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INCOMPATIBLE_COLUMN');
    }
  });

  test('an empty case has no branches to type and is rejected', () => {
    expect(infer({ kind: 'case', when: [], otherwise: { kind: 'literal', value: 0 } }).ok).toBe(false);
  });

  // Each operand is inferred in turn, so an unresolvable reference on either side surfaces its own error.
  test('arithmetic reports an unknown column from either operand', () => {
    const missing: DerivedExpression = { kind: 'column', columnId: 'col_missing' };

    for (const expression of [
      { kind: 'arithmetic', op: 'add', left: missing, right: REVENUE },
      { kind: 'arithmetic', op: 'add', left: REVENUE, right: missing },
    ] as const satisfies readonly DerivedExpression[]) {
      const result = infer(expression);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('COLUMN_NOT_FOUND');
      }
    }
  });

  // A case arm types three sub-expressions, and a failure in any one aborts before the arms are compared.
  test('a case arm reports an unknown column from its left, right, or result', () => {
    const missing: DerivedExpression = { kind: 'column', columnId: 'col_missing' };
    const literal: DerivedExpression = { kind: 'literal', value: 1 };

    for (const arm of [
      { left: missing, operator: 'eq', right: REVENUE, result: literal },
      { left: REVENUE, operator: 'eq', right: missing, result: literal },
      { left: REVENUE, operator: 'eq', right: REVENUE, result: missing },
    ] as const) {
      const result = infer({ kind: 'case', when: [arm], otherwise: literal });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('COLUMN_NOT_FOUND');
      }
    }
  });

  test('a case reports an unknown column in its otherwise branch', () => {
    const result = infer({
      kind: 'case',
      when: [
        { left: REVENUE, operator: 'gt', right: { kind: 'literal', value: 1 }, result: { kind: 'literal', value: 1 } },
      ],
      otherwise: { kind: 'column', columnId: 'col_missing' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });

  test('datePart rejects an unknown column before checking that it is temporal', () => {
    const result = infer({ kind: 'datePart', part: 'year', columnId: 'col_missing' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COLUMN_NOT_FOUND');
    }
  });

  /*
   * Comparability is decided per type family rather than by exact equality, so a case arm may compare
   * two texts, two temporals, or two booleans. An unknown operand stays comparable with anything.
   */
  test('case arms compare within a type family, including text, temporal, and boolean', () => {
    const REGION: DerivedExpression = { kind: 'column', columnId: 'col_region' };
    const DATE: DerivedExpression = { kind: 'column', columnId: 'col_date' };
    const RETURNED: DerivedExpression = { kind: 'column', columnId: 'col_returned' };

    // `category` and `string` are both text, so they compare without a cast.
    expect(infer(armFor(NOTES, REGION)).ok).toBe(true);
    expect(infer(armFor(DATE, DATE)).ok).toBe(true);
    expect(infer(armFor(RETURNED, { kind: 'literal', value: true })).ok).toBe(true);
    // A null literal has no type yet, so it cannot conflict with the column it is compared against.
    expect(infer(armFor(NOTES, { kind: 'literal', value: null })).ok).toBe(true);
    // A boolean and a number belong to different families and are rejected.
    expect(infer(armFor(RETURNED, REVENUE)).ok).toBe(false);
  });

  test('a derived column can be referenced by another, so the resolver accepts both', () => {
    const withDerived = createColumnTypeResolver(SALES_COLUMNS, [
      {
        id: 'col_derived',
        datasetId: 'ds_sales',
        name: 'Revenue per unit',
        expression: { kind: 'arithmetic', op: 'div', left: REVENUE, right: UNITS },
        logicalType: 'number',
        typeVerified: false,
        createdBy: 'human',
      },
    ]);

    expect(inferExpressionType({ kind: 'column', columnId: 'col_derived' }, withDerived)).toEqual({
      ok: true,
      value: 'number',
    });
  });
});
