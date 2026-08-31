import type { ChartResult } from '@/application/queries/visualization-query.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';

export interface ResolvedAnnotation {
  annotation: Annotation;
  coordinates: unknown[];
}

export const resolveAnnotationAnchor = (
  annotation: Annotation,
  visualization: Visualization,
  result: ChartResult,
): ResolvedAnnotation | null => {
  const anchor = annotation.anchor;
  if (anchor.kind === 'data') {
    // Chart results can rename a dimension, so fall back to its result key or display name.
    const dimensionIndex = visualization.query.dimensions.indexOf(anchor.dimension);
    const index =
      dimensionIndex >= 0
        ? dimensionIndex
        : result.columns.findIndex((column) => column.key === anchor.dimension || column.name === anchor.dimension);
    if (index < 0 || !result.rows.some((row) => row[index] === anchor.value)) return null;
    return { annotation, coordinates: [anchor.value] };
  }
  if (anchor.kind === 'point') {
    const exists = result.rows.some(
      (row) => Object.is(row[0], anchor.x) && row.slice(1).some((value) => Object.is(value, anchor.y)),
    );
    return exists ? { annotation, coordinates: [anchor.x, anchor.y] } : null;
  }
  const dimensionId = visualization.binding.x;
  const index = visualization.query.dimensions.indexOf(dimensionId ?? '');
  if (index < 0) return null;
  const values = new Set<unknown>(result.rows.map((row) => row[index]));
  return values.has(anchor.from) && values.has(anchor.to)
    ? { annotation, coordinates: [anchor.from, anchor.to] }
    : null;
};
