import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Closed expression vocabulary for derived columns. Literal values become bound parameters.
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

// One `WHEN`/`THEN` arm with expression branches.
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

// Bounds for expression depth and total nodes.
export const MAX_EXPRESSION_DEPTH = 8;
export const MAX_EXPRESSION_NODES = 64;

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

export const expressionDepth = (expression: DerivedExpression): number => {
  const children = childExpressions(expression);

  return children.length === 0 ? 1 : 1 + Math.max(...children.map(expressionDepth));
};

export const expressionNodeCount = (expression: DerivedExpression): number =>
  1 + childExpressions(expression).reduce((total, child) => total + expressionNodeCount(child), 0);

export const expressionColumnIds = (expression: DerivedExpression): EntityId[] => {
  const own = expression.kind === 'column' || expression.kind === 'datePart' || expression.kind === 'bin';

  return [...(own ? [expression.columnId] : []), ...childExpressions(expression).flatMap(expressionColumnIds)];
};
