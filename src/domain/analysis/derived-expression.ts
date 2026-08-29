import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * The vocabulary a derived column may be built from.
 *
 * Security invariant. Every node is a closed enum the compiler knows how to emit, and no branch
 * carries free text that reaches SQL. A formula string parsed into SQL would be arbitrary SQL under
 * another name, which is the one capability this architecture exists to deny an agent. The only
 * strings here are `literal` values, and those become bound parameters rather than SQL text.
 */
export type DerivedExpression =
  | { kind: 'column'; columnId: EntityId }
  | { kind: 'literal'; value: number | string | boolean | null }
  | { kind: 'arithmetic'; op: ArithmeticOperator; left: DerivedExpression; right: DerivedExpression }
  | { kind: 'case'; when: DerivedCondition[]; otherwise: DerivedExpression }
  | { kind: 'datePart'; part: DatePart; columnId: EntityId }
  | { kind: 'bin'; columnId: EntityId; strategy: BinStrategy }
  | { kind: 'cast'; to: CastTarget; expr: DerivedExpression };

export type ArithmeticOperator = 'add' | 'sub' | 'mul' | 'div';

export const ARITHMETIC_OPERATORS: readonly ArithmeticOperator[] = ['add', 'sub', 'mul', 'div'] as const;

export type DatePart = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'dayOfWeek';

export const DATE_PARTS: readonly DatePart[] = [
  'year',
  'quarter',
  'month',
  'week',
  'day',
  'hour',
  'dayOfWeek',
] as const;

export type CastTarget = 'number' | 'string' | 'date';

export const CAST_TARGETS: readonly CastTarget[] = ['number', 'string', 'date'] as const;

export type ComparisonOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export const COMPARISON_OPERATORS: readonly ComparisonOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;

/**
 * One `WHEN … THEN …` arm. Both sides are expressions, so an arm can compare two columns.
 *
 * The result field is named `result` rather than `then`. An object carrying a `then` property is
 * treated as a promise by `await`, so a plain data object with that name is a trap waiting for the
 * first time one of these is returned from an async function.
 */
export interface DerivedCondition {
  left: DerivedExpression;
  operator: ComparisonOperator;
  right: DerivedExpression;
  result: DerivedExpression;
}

export const DERIVED_EXPRESSION_KINDS: readonly DerivedExpression['kind'][] = [
  'column',
  'literal',
  'arithmetic',
  'case',
  'datePart',
  'bin',
  'cast',
] as const;

/*
 * Structural limits.
 *
 * Depth bounds recursion in the compiler and in every walker below; node count bounds the size of
 * the SQL fragment one column can expand into. Both exist because an agent supplies these trees, and
 * an unbounded tree is a way to make compilation cost arbitrary without ever writing SQL.
 */
export const MAX_EXPRESSION_DEPTH = 8;
export const MAX_EXPRESSION_NODES = 64;

/** Every direct child of a node, so walkers do not each re-encode the tree's shape. */
export const childExpressions = (expression: DerivedExpression): DerivedExpression[] => {
  switch (expression.kind) {
    case 'arithmetic':
      return [expression.left, expression.right];
    case 'case':
      return [...expression.when.flatMap((arm) => [arm.left, arm.right, arm.result]), expression.otherwise];
    case 'cast':
      return [expression.expr];
    case 'column':
    case 'literal':
    case 'datePart':
    case 'bin':
      return [];
  }
};

/**
 * Depth of the deepest branch, counting the root as 1.
 *
 * Recursive rather than iterative because the depth cap is enforced against this result: a tree deep
 * enough to overflow the stack here would already exceed any cap a caller sets.
 */
export const expressionDepth = (expression: DerivedExpression): number => {
  const children = childExpressions(expression);

  return children.length === 0 ? 1 : 1 + Math.max(...children.map(expressionDepth));
};

export const expressionNodeCount = (expression: DerivedExpression): number =>
  1 + childExpressions(expression).reduce((total, child) => total + expressionNodeCount(child), 0);

/**
 * Every column ID the tree references, including through `datePart` and `bin`.
 *
 * Used for reference validation, for cycle detection across derived columns, and by the compiler to
 * decide which datasets a query must reach.
 */
export const expressionColumnIds = (expression: DerivedExpression): EntityId[] => {
  const own = expression.kind === 'column' || expression.kind === 'datePart' || expression.kind === 'bin';

  return [...(own ? [expression.columnId] : []), ...childExpressions(expression).flatMap(expressionColumnIds)];
};
