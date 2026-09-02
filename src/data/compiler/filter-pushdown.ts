import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Structural filter analysis used by the query planner.

// Returns every column ID named by a filter tree.
export const filterColumnIds = (expression: FilterExpression): EntityId[] => {
  if (expression.kind === 'comparison') {
    return [expression.columnId];
  }
  if (expression.kind === 'not') {
    return filterColumnIds(expression.operand);
  }

  return expression.operands.flatMap(filterColumnIds);
};

// Returns whether a filter is safe to evaluate below the current join.
export const canPushDown = (
  expression: FilterExpression,
  nullExtendedDatasetIds: ReadonlySet<EntityId>,
  ownerOf: (columnId: EntityId) => EntityId | undefined,
): boolean => {
  const owners = new Set<EntityId>();

  for (const columnId of filterColumnIds(expression)) {
    const owner = ownerOf(columnId);

    // Leave unknown columns for the compiler to report.
    if (owner === undefined) {
      return false;
    }

    owners.add(owner);
  }

  if (owners.size !== 1) {
    return false;
  }

  const [owner] = [...owners];

  return owner !== undefined && !nullExtendedDatasetIds.has(owner);
};

// Comparison operators whose bounds can be merged.
type RangeOperator = 'gt' | 'gte' | 'lt' | 'lte';

const LOWER_BOUNDS: readonly RangeOperator[] = ['gt', 'gte'] as const;
const UPPER_BOUNDS: readonly RangeOperator[] = ['lt', 'lte'] as const;

const isRangeComparison = (
  expression: FilterExpression,
): expression is { kind: 'comparison'; columnId: EntityId; operator: RangeOperator; value?: unknown } =>
  expression.kind === 'comparison' &&
  (LOWER_BOUNDS as readonly string[]).concat(UPPER_BOUNDS).includes(expression.operator) &&
  typeof expression.value === 'number';

// Merges compatible range predicates under one `and`.
const mergeRanges = (operands: readonly FilterExpression[]): FilterExpression[] => {
  const ranges = new Map<string, { kind: 'comparison'; columnId: EntityId; operator: RangeOperator; value: number }>();
  const passthrough: FilterExpression[] = [];
  const order: string[] = [];

  for (const operand of operands) {
    if (!isRangeComparison(operand)) {
      passthrough.push(operand);
      continue;
    }

    const bound = LOWER_BOUNDS.includes(operand.operator) ? 'lower' : 'upper';
    const key = `${operand.columnId}:${bound}`;
    const value = operand.value as number;
    const candidate = { kind: 'comparison' as const, columnId: operand.columnId, operator: operand.operator, value };
    const existing = ranges.get(key);

    if (existing === undefined) {
      ranges.set(key, candidate);
      order.push(key);
      continue;
    }

    const tighter =
      bound === 'lower'
        ? value > existing.value || (value === existing.value && operand.operator === 'gt')
        : value < existing.value || (value === existing.value && operand.operator === 'lt');

    if (tighter) {
      ranges.set(key, candidate);
    }
  }

  return [...passthrough, ...order.flatMap((key) => (ranges.has(key) ? [ranges.get(key) as FilterExpression] : []))];
};

// Normalizes a filter tree without changing its truth value.
export const simplifyFilter = (expression: FilterExpression): FilterExpression => {
  if (expression.kind === 'comparison') {
    return expression;
  }

  if (expression.kind === 'not') {
    const operand = simplifyFilter(expression.operand);

    return operand.kind === 'not' ? operand.operand : { kind: 'not', operand };
  }

  const flattened = expression.operands.flatMap((operand) => {
    const simplified = simplifyFilter(operand);

    return simplified.kind === expression.kind ? simplified.operands : [simplified];
  });

  const merged = expression.kind === 'and' ? mergeRanges(flattened) : flattened;

  if (merged.length === 1) {
    return merged[0] as FilterExpression;
  }

  return { kind: expression.kind, operands: merged };
};
