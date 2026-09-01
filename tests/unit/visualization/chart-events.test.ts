import { describe, expect, test } from 'bun:test';
import {
  categorySelectionFromClick,
  isAdditiveClick,
  isSameSelection,
  rangeSelection,
  rowMatchesPredicate,
} from '@/visualization/interaction/chart-events.ts';
import type { FilterExpression } from '@/domain/filter/filter.ts';
import { visualization } from '@/../tests/unit/application/action-fixtures.ts';

describe('chart events', () => {
  test('turns a category click into a predicate', () => {
    const chart = visualization('vis_1', 'ds_sales');
    expect(categorySelectionFromClick(chart, { data: ['West', 10] })).toEqual({
      kind: 'comparison',
      columnId: 'col_date',
      operator: 'eq',
      value: 'West',
    });
  });

  // ECharts reports the hovered row under `data` for dataset series and `value` for positional ones.
  test('falls back to the params value row when no data row is present', () => {
    const chart = visualization('vis_1', 'ds_sales');

    expect(categorySelectionFromClick(chart, { value: ['East', 8] })).toMatchObject({ value: 'East' });
  });

  test('a scalar click carries no row, so it selects nothing', () => {
    const chart = visualization('vis_1', 'ds_sales');

    expect(categorySelectionFromClick(chart, { value: 'East' })).toBeNull();
  });

  test('a chart with no x binding has no column to select on', () => {
    const chart = visualization('vis_1', 'ds_sales');

    expect(categorySelectionFromClick({ ...chart, binding: {} }, { data: ['West'] })).toBeNull();
  });

  test('normalizes brushed numeric ranges', () => {
    expect(rangeSelection('col_revenue', 10, 2)).toEqual({
      kind: 'comparison',
      columnId: 'col_revenue',
      operator: 'between',
      value: [2, 10],
    });
  });
});

describe('selection equality', () => {
  test('two structurally equal predicates count as the same selection', () => {
    const selection = rangeSelection('col_revenue', 2, 10);

    expect(isSameSelection(selection, { ...selection })).toBe(true);
  });

  test('an absent previous selection never matches', () => {
    expect(isSameSelection(undefined, rangeSelection('col_revenue', 2, 10))).toBe(false);
  });

  test('a different bound makes it a new selection', () => {
    expect(isSameSelection(rangeSelection('col_revenue', 2, 10), rangeSelection('col_revenue', 3, 10))).toBe(false);
  });
});

describe('additive click detection', () => {
  test.each([
    ['ctrl', { ctrlKey: true }, true],
    ['meta', { metaKey: true }, true],
    ['no modifier', {}, false],
  ] as const)('%s held reports %p', (_label, modifiers, expected) => {
    expect(isAdditiveClick({ event: modifiers })).toBe(expected);
  });
});

// The operator arrives from a stored predicate, so unknown operators are exercised alongside valid ones.
const comparison = (columnId: string, operator: string, value: unknown): FilterExpression =>
  ({ kind: 'comparison', columnId, operator, value }) as FilterExpression;

describe('row predicate evaluation', () => {
  const indexes = new Map([
    ['number', 0],
    ['text', 1],
    ['nullable', 2],
  ]);
  const row = [5, 'hello world', null];

  const matches = (predicate: FilterExpression): boolean => rowMatchesPredicate(predicate, row, indexes);

  test.each([
    ['eq', 'number', 5, true],
    ['neq', 'number', 4, true],
    ['gt', 'number', 4, true],
    ['gte', 'number', 5, true],
    ['lt', 'number', 6, true],
    ['lte', 'number', 5, true],
    ['between', 'number', [4, 6], true],
    // A one-sided range has no upper bound to compare against.
    ['between', 'number', [6], false],
    ['in', 'number', [4, 5], true],
    ['not_in', 'number', [4, 6], true],
    ['contains', 'text', 'hello', true],
    ['contains', 'text', 4, false],
    ['is_null', 'nullable', undefined, true],
    ['is_not_null', 'nullable', undefined, false],
    // Operators outside the closed set match nothing rather than throwing.
    ['unknown', 'number', 1, false],
  ] as const)('%s on the %s column yields %p', (operator, columnId, value, expected) => {
    expect(matches(comparison(columnId, operator, value))).toBe(expected);
  });

  // A predicate over a column the chart result does not carry cannot narrow the row.
  test('a predicate on an absent column leaves the row matched', () => {
    expect(matches(comparison('missing', 'eq', 0))).toBe(true);
  });

  test('and requires every operand to match', () => {
    expect(
      matches({
        kind: 'and',
        operands: [comparison('number', 'gt', 1), comparison('text', 'contains', 'hello')],
      }),
    ).toBe(true);
  });

  test('or matches when a single operand matches', () => {
    expect(
      matches({
        kind: 'or',
        operands: [comparison('number', 'eq', 0), comparison('text', 'contains', 'world')],
      }),
    ).toBe(true);
  });

  test('not inverts its operand', () => {
    expect(matches({ kind: 'not', operand: comparison('number', 'eq', 0) })).toBe(true);
  });
});
