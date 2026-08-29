import type { EntityId } from '@/shared/ids/entity-id.ts';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'is_null'
  | 'is_not_null';

export const FILTER_OPERATORS: readonly FilterOperator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'not_in',
  'contains',
  'is_null',
  'is_not_null',
] as const;

/** Operators that take no `value` at all; validation and compilation both depend on this. */
export const NULLARY_FILTER_OPERATORS: readonly FilterOperator[] = ['is_null', 'is_not_null'] as const;

/**
 * A semantic filter.
 *
 * Carries no raw `WHERE` fragment, by design. The query compiler is the only code that turns this
 * into SQL, which keeps agent input from reaching the database as text.
 */
export interface Filter {
  id: EntityId;
  datasetId: EntityId;
  columnId: EntityId;
  operator: FilterOperator;
  value?: unknown;
  enabled: boolean;
  origin: 'human' | 'agent' | 'system';
  createdBy: 'human' | 'agent' | 'system';
}

/**
 * A composable filter predicate for the places that need a filter tree rather than a flat stored
 * filter, namely `Selection.predicate` and `AnalysisQuery.filters`.
 */
export type FilterExpression =
  | { kind: 'comparison'; columnId: EntityId; operator: FilterOperator; value?: unknown }
  | { kind: 'and'; operands: FilterExpression[] }
  | { kind: 'or'; operands: FilterExpression[] }
  | { kind: 'not'; operand: FilterExpression };
