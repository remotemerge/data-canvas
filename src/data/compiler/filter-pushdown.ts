import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * Filter analysis for the planner.
 *
 * Two jobs, both purely structural on the filter tree:
 *
 * 1. Decide which filters may be applied before a join rather than after it.
 * 2. Simplify predicates that are provably redundant or vacuous.
 *
 * Nothing here emits SQL. The planner rewrites the `AnalysisQuery`, and the compiler remains the
 * only code that turns a query into text.
 */

/** Every column a filter tree names. */
export const filterColumnIds = (expression: FilterExpression): EntityId[] => {
  if (expression.kind === 'comparison') return [expression.columnId];
  if (expression.kind === 'not') return filterColumnIds(expression.operand);

  return expression.operands.flatMap(filterColumnIds);
};

/**
 * Whether a filter may be pushed below a join that preserves `preservedDatasetIds`.
 *
 * The rule that matters. An inner join is filtered symmetrically: a predicate on either side removes
 * the same rows before or after the join, so pushing it down is safe. A **left** join is not: it
 * preserves unmatched left rows with nulls on the right, and a right-side predicate applied before
 * the join removes candidate matches, turning matched rows into null-extended ones — whereas applied
 * after, those same rows fail the predicate and disappear entirely. The two produce different
 * results, so a filter touching a null-extended side is never pushed.
 *
 * Filters spanning several datasets are also left in place: they can only be evaluated once every
 * side is present.
 */
export const canPushDown = (
  expression: FilterExpression,
  nullExtendedDatasetIds: ReadonlySet<EntityId>,
  ownerOf: (columnId: EntityId) => EntityId | undefined,
): boolean => {
  const owners = new Set<EntityId>();

  for (const columnId of filterColumnIds(expression)) {
    const owner = ownerOf(columnId);

    // An unresolvable column is left alone. The compiler reports it; the planner must not guess.
    if (owner === undefined) return false;

    owners.add(owner);
  }

  if (owners.size !== 1) return false;

  const [owner] = [...owners];

  return owner !== undefined && !nullExtendedDatasetIds.has(owner);
};

/**
 * Comparison operators whose ranges can be merged when they constrain the same column.
 *
 * `between` is excluded deliberately: it carries a two-element value and merging it with a bare
 * bound would require rewriting its payload, which buys nothing DuckDB's own optimizer does not
 * already do on a single relation.
 */
type RangeOperator = 'gt' | 'gte' | 'lt' | 'lte';

const LOWER_BOUNDS: readonly RangeOperator[] = ['gt', 'gte'] as const;
const UPPER_BOUNDS: readonly RangeOperator[] = ['lt', 'lte'] as const;

const isRangeComparison = (
  expression: FilterExpression,
): expression is { kind: 'comparison'; columnId: EntityId; operator: RangeOperator; value?: unknown } =>
  expression.kind === 'comparison' &&
  (LOWER_BOUNDS as readonly string[]).concat(UPPER_BOUNDS).includes(expression.operator) &&
  typeof expression.value === 'number';

/**
 * Merges overlapping range predicates on the same column inside one `and`.
 *
 * Only within an `and`: two ranges under an `or` describe a union, and keeping the tighter of them
 * would drop rows the query asked for. The tightest bound wins, and an inclusive bound loses to an
 * exclusive one at the same value because it admits strictly fewer rows.
 */
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

    if (tighter) ranges.set(key, candidate);
  }

  return [...passthrough, ...order.flatMap((key) => (ranges.has(key) ? [ranges.get(key) as FilterExpression] : []))];
};

/**
 * Simplifies a filter tree.
 *
 * Flattens nested same-kind connectives, drops single-operand connectives, collapses double
 * negation, and merges ranges under an `and`. Every rewrite preserves the predicate's truth value
 * for every row — this is normalization, not approximation.
 */
export const simplifyFilter = (expression: FilterExpression): FilterExpression => {
  if (expression.kind === 'comparison') return expression;

  if (expression.kind === 'not') {
    const operand = simplifyFilter(expression.operand);

    return operand.kind === 'not' ? operand.operand : { kind: 'not', operand };
  }

  const flattened = expression.operands.flatMap((operand) => {
    const simplified = simplifyFilter(operand);

    return simplified.kind === expression.kind ? simplified.operands : [simplified];
  });

  const merged = expression.kind === 'and' ? mergeRanges(flattened) : flattened;

  if (merged.length === 1) return merged[0] as FilterExpression;

  return { kind: expression.kind, operands: merged };
};
