import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';

interface ClickLikeEvent {
  value?: unknown;
  data?: unknown;
  dataIndex?: number;
}

export const categorySelectionFromClick = (
  visualization: Visualization,
  event: ClickLikeEvent,
): FilterExpression | null => {
  const columnId = visualization.binding.x;
  if (columnId === undefined) return null;
  const row = Array.isArray(event.data) ? event.data : Array.isArray(event.value) ? event.value : null;
  if (row === null) return null;
  return { kind: 'comparison', columnId, operator: 'eq', value: row[0] };
};

export const rangeSelection = (columnId: string, start: number, end: number): FilterExpression => ({
  kind: 'comparison',
  columnId,
  operator: 'between',
  value: [Math.min(start, end), Math.max(start, end)],
});

export const isSameSelection = (left: FilterExpression | undefined, right: FilterExpression): boolean =>
  left !== undefined && JSON.stringify(left) === JSON.stringify(right);

/**
 * True when a ctrl/cmd-click should extend the selection rather than replace it.
 *
 * Reading the modifier from the DOM event ECharts forwards, rather than from a React synthetic
 * event, because chart clicks arrive through ECharts' own handler. Meta is the macOS convention and
 * ctrl the one elsewhere; both are accepted on every platform so neither is wrong.
 */
export const isAdditiveClick = (event: { event?: { ctrlKey?: boolean; metaKey?: boolean } }): boolean =>
  event.event?.ctrlKey === true || event.event?.metaKey === true;

const compare = (operator: string, cell: unknown, value: unknown): boolean => {
  switch (operator) {
    case 'eq':
      return cell === value;
    case 'neq':
      return cell !== value;
    case 'gt':
      return Number(cell) > Number(value);
    case 'gte':
      return Number(cell) >= Number(value);
    case 'lt':
      return Number(cell) < Number(value);
    case 'lte':
      return Number(cell) <= Number(value);
    case 'between': {
      if (!Array.isArray(value) || value.length < 2) return false;
      const numeric = Number(cell);

      return numeric >= Number(value[0]) && numeric <= Number(value[1]);
    }
    case 'in':
      return Array.isArray(value) && value.includes(cell);
    case 'not_in':
      return Array.isArray(value) && !value.includes(cell);
    case 'contains':
      return typeof cell === 'string' && typeof value === 'string' && cell.includes(value);
    case 'is_null':
      return cell === null || cell === undefined;
    case 'is_not_null':
      return cell !== null && cell !== undefined;
    default:
      return false;
  }
};

/**
 * Evaluates a selection predicate against one chart row, for highlight rendering.
 *
 * This duplicates the *semantics* of the SQL compiler's operators but not its code, deliberately:
 * `highlight` must decide per rendered mark without a round trip to DuckDB, and the compiler emits
 * SQL text rather than a predicate function. The set of operators is closed and small, so the two
 * stay aligned by review; `filter` mode, which does re-query, is the path where the compiler's
 * evaluation is authoritative.
 *
 * A column the chart did not select on cannot be evaluated, so an unresolvable reference reports
 * `true` — an un-dimmed mark is a safer default than hiding data the user did not exclude.
 */
export const rowMatchesPredicate = (
  predicate: FilterExpression,
  row: readonly unknown[],
  columnIndexById: ReadonlyMap<string, number>,
): boolean => {
  switch (predicate.kind) {
    case 'comparison': {
      const index = columnIndexById.get(predicate.columnId);

      if (index === undefined) return true;

      return compare(predicate.operator, row[index], predicate.value);
    }
    case 'and':
      return predicate.operands.every((operand) => rowMatchesPredicate(operand, row, columnIndexById));
    case 'or':
      return predicate.operands.some((operand) => rowMatchesPredicate(operand, row, columnIndexById));
    case 'not':
      return !rowMatchesPredicate(predicate.operand, row, columnIndexById);
  }
};
