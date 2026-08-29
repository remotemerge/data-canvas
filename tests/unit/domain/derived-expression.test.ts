import { describe, expect, test } from 'bun:test';
import {
  DERIVED_EXPRESSION_KINDS,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_NODES,
  childExpressions,
  expressionColumnIds,
  expressionDepth,
  expressionNodeCount,
} from '@/domain/analysis/derived-expression.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';

const column = (id: string): DerivedExpression => ({ kind: 'column', columnId: id });

/** Builds a left-leaning arithmetic chain of the requested depth. */
const nest = (depth: number): DerivedExpression =>
  depth <= 1 ? column('col_a') : { kind: 'arithmetic', op: 'add', left: nest(depth - 1), right: column('col_b') };

describe('expression tree walkers', () => {
  test('every node kind has a child rule, so a new kind cannot be silently unwalkable', () => {
    const samples: Record<DerivedExpression['kind'], DerivedExpression> = {
      column: column('col_a'),
      literal: { kind: 'literal', value: 1 },
      arithmetic: { kind: 'arithmetic', op: 'add', left: column('col_a'), right: column('col_b') },
      case: {
        kind: 'case',
        when: [
          { left: column('col_a'), operator: 'gt', right: { kind: 'literal', value: 0 }, result: column('col_b') },
        ],
        otherwise: { kind: 'literal', value: null },
      },
      datePart: { kind: 'datePart', part: 'month', columnId: 'col_date' },
      bin: { kind: 'bin', columnId: 'col_a', strategy: { kind: 'equalWidth', binCount: 10 } },
      cast: { kind: 'cast', to: 'number', expr: column('col_a') },
    };

    expect(Object.keys(samples).toSorted()).toEqual([...DERIVED_EXPRESSION_KINDS].toSorted());

    for (const sample of Object.values(samples)) {
      expect(() => childExpressions(sample)).not.toThrow();
      expect(expressionDepth(sample)).toBeGreaterThan(0);
    }
  });

  test('depth counts the deepest branch with the root as one', () => {
    expect(expressionDepth(column('col_a'))).toBe(1);
    expect(expressionDepth(nest(2))).toBe(2);
    expect(expressionDepth(nest(MAX_EXPRESSION_DEPTH))).toBe(MAX_EXPRESSION_DEPTH);
  });

  test('node count includes every node, not only the leaves', () => {
    expect(expressionNodeCount(column('col_a'))).toBe(1);
    // A two-level chain is the root plus its two operands.
    expect(expressionNodeCount(nest(2))).toBe(3);
  });

  test('a case arm contributes all four of its expressions', () => {
    const expression: DerivedExpression = {
      kind: 'case',
      when: [{ left: column('col_a'), operator: 'gt', right: { kind: 'literal', value: 0 }, result: column('col_b') }],
      otherwise: column('col_c'),
    };

    expect(childExpressions(expression)).toHaveLength(4);
    expect(expressionColumnIds(expression).toSorted()).toEqual(['col_a', 'col_b', 'col_c']);
  });

  test('column collection reaches through datePart and bin, which name columns without a child', () => {
    expect(expressionColumnIds({ kind: 'datePart', part: 'year', columnId: 'col_date' })).toEqual(['col_date']);
    expect(
      expressionColumnIds({ kind: 'bin', columnId: 'col_rev', strategy: { kind: 'quantile', quantiles: 4 } }),
    ).toEqual(['col_rev']);
  });

  test('the structural limits are the ones validation enforces', () => {
    expect(MAX_EXPRESSION_DEPTH).toBe(8);
    expect(MAX_EXPRESSION_NODES).toBe(64);
  });
});
