import { describe, expect, test } from 'bun:test';
import { canPushDown, filterColumnIds, simplifyFilter } from '@/data/compiler/filter-pushdown.ts';
import type { FilterExpression, FilterOperator } from '@/domain/filter/filter.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

const ORDERS = 'ds_orders' as EntityId;
const CUSTOMERS = 'ds_customers' as EntityId;
const OWNERS: Record<string, EntityId> = {
  col_revenue: ORDERS,
  col_units: ORDERS,
  col_region: CUSTOMERS,
};
const ownerOf = (columnId: EntityId): EntityId | undefined => OWNERS[columnId];

const comparison = (columnId: string, operator: FilterOperator, value?: unknown): FilterExpression => ({
  kind: 'comparison',
  columnId: columnId as EntityId,
  operator,
  ...(value === undefined ? {} : { value }),
});

describe('filter column collection', () => {
  test('walks nested connectives', () => {
    const expression: FilterExpression = {
      kind: 'and',
      operands: [comparison('col_revenue', 'gt', 10), { kind: 'not', operand: comparison('col_region', 'eq', 'EU') }],
    };

    expect(filterColumnIds(expression)).toEqual(['col_revenue' as EntityId, 'col_region' as EntityId]);
  });
});

describe('pushdown safety', () => {
  test('pushes a single-dataset filter below an inner join', () => {
    expect(canPushDown(comparison('col_revenue', 'gt', 10), new Set(), ownerOf)).toBe(true);
  });

  test('refuses to push a filter onto the null-extended side of a left join', () => {
    // The case that makes this rule exist: applied before the join it removes candidate matches and
    // leaves null-extended rows; applied after, those rows fail the predicate and disappear.
    expect(canPushDown(comparison('col_region', 'eq', 'EU'), new Set([CUSTOMERS]), ownerOf)).toBe(false);
  });

  test('still pushes a preserved-side filter across a left join', () => {
    expect(canPushDown(comparison('col_revenue', 'gt', 10), new Set([CUSTOMERS]), ownerOf)).toBe(true);
  });

  test('refuses a filter spanning two datasets', () => {
    const spanning: FilterExpression = {
      kind: 'and',
      operands: [comparison('col_revenue', 'gt', 10), comparison('col_region', 'eq', 'EU')],
    };

    expect(canPushDown(spanning, new Set(), ownerOf)).toBe(false);
  });

  test('refuses a filter naming an unresolvable column rather than guessing', () => {
    expect(canPushDown(comparison('col_missing', 'eq', 1), new Set(), ownerOf)).toBe(false);
  });
});

describe('predicate simplification', () => {
  test('flattens nested conjunctions', () => {
    const nested: FilterExpression = {
      kind: 'and',
      operands: [
        comparison('col_revenue', 'gt', 10),
        { kind: 'and', operands: [comparison('col_units', 'lt', 5), comparison('col_region', 'eq', 'EU')] },
      ],
    };

    const simplified = simplifyFilter(nested);

    expect(simplified.kind).toBe('and');
    expect((simplified as { operands: FilterExpression[] }).operands).toHaveLength(3);
  });

  test('collapses double negation', () => {
    const doubled: FilterExpression = {
      kind: 'not',
      operand: { kind: 'not', operand: comparison('col_revenue', 'gt', 10) },
    };

    expect(simplifyFilter(doubled)).toEqual(comparison('col_revenue', 'gt', 10));
  });

  test('keeps the tighter of two lower bounds on the same column', () => {
    const overlapping: FilterExpression = {
      kind: 'and',
      operands: [comparison('col_revenue', 'gt', 10), comparison('col_revenue', 'gt', 50)],
    };

    expect(simplifyFilter(overlapping)).toEqual(comparison('col_revenue', 'gt', 50));
  });

  test('prefers the exclusive bound at an equal value', () => {
    const equal: FilterExpression = {
      kind: 'and',
      operands: [comparison('col_revenue', 'gte', 10), comparison('col_revenue', 'gt', 10)],
    };

    expect(simplifyFilter(equal)).toEqual(comparison('col_revenue', 'gt', 10));
  });

  test('keeps a lower and an upper bound as a range rather than merging them', () => {
    const range: FilterExpression = {
      kind: 'and',
      operands: [comparison('col_revenue', 'gt', 10), comparison('col_revenue', 'lt', 100)],
    };

    expect((simplifyFilter(range) as { operands: FilterExpression[] }).operands).toHaveLength(2);
  });

  test('does not merge ranges under an or, which would drop rows', () => {
    const union: FilterExpression = {
      kind: 'or',
      operands: [comparison('col_revenue', 'gt', 10), comparison('col_revenue', 'gt', 50)],
    };

    expect((simplifyFilter(union) as { operands: FilterExpression[] }).operands).toHaveLength(2);
  });
});
