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

// Operators without a `value`.
export const NULLARY_FILTER_OPERATORS: readonly FilterOperator[] = ['is_null', 'is_not_null'] as const;

// Stored filter definition; the compiler creates SQL from it.
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

// Composable filter predicate for selections and analysis queries.
export type FilterExpression =
  | { kind: 'comparison'; columnId: EntityId; operator: FilterOperator; value?: unknown }
  | { kind: 'and'; operands: FilterExpression[] }
  | { kind: 'or'; operands: FilterExpression[] }
  | { kind: 'not'; operand: FilterExpression };
