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
