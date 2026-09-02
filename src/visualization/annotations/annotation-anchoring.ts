import type { ChartResult } from '@/application/queries/visualization-query.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';

export interface ResolvedAnnotation {
  annotation: Annotation;
  coordinates: unknown[];
}

type Anchor = Annotation['anchor'];

// Resolves the coordinates each anchor kind pins to, or null when the result no longer contains it.

const dataCoordinates = (
  anchor: Extract<Anchor, { kind: 'data' }>,
  visualization: Visualization,
  result: ChartResult,
): unknown[] | null => {
  // Chart results can rename a dimension, so fall back to its result key or display name.
  const dimensionIndex = visualization.query.dimensions.indexOf(anchor.dimension);
  const index =
    dimensionIndex >= 0
      ? dimensionIndex
      : result.columns.findIndex((column) => column.key === anchor.dimension || column.name === anchor.dimension);

  if (index < 0 || !result.rows.some((row) => row[index] === anchor.value)) {
    return null;
  }

  return [anchor.value];
};

const pointCoordinates = (anchor: Extract<Anchor, { kind: 'point' }>, result: ChartResult): unknown[] | null => {
  const exists = result.rows.some(
    (row) => Object.is(row[0], anchor.x) && row.slice(1).some((value) => Object.is(value, anchor.y)),
  );

  return exists ? [anchor.x, anchor.y] : null;
};

// Pins to a category value along the x-axis — the natural fit for bar charts.
const categoryCoordinates = (
  anchor: Extract<Anchor, { kind: 'category' }>,
  visualization: Visualization,
  result: ChartResult,
): unknown[] | null => {
  const dimensionIndex =
    visualization.query.dimensions.length > 0
      ? 0
      : result.columns.findIndex((column) => column.name !== anchor.value && column.key !== 'm0');

  if (dimensionIndex < 0) {
    return null;
  }

  return result.rows.some((row) => row[dimensionIndex] === anchor.value) ? [anchor.value] : null;
};

const rangeCoordinates = (
  anchor: Extract<Anchor, { kind: 'range' }>,
  visualization: Visualization,
  result: ChartResult,
): unknown[] | null => {
  const index = visualization.query.dimensions.indexOf(visualization.binding.x ?? '');

  if (index < 0) {
    return null;
  }

  const values = new Set<unknown>(result.rows.map((row) => row[index]));

  return values.has(anchor.from) && values.has(anchor.to) ? [anchor.from, anchor.to] : null;
};

export const resolveAnnotationAnchor = (
  annotation: Annotation,
  visualization: Visualization,
  result: ChartResult,
): ResolvedAnnotation | null => {
  const anchor = annotation.anchor;

  const coordinates = (): unknown[] | null => {
    switch (anchor.kind) {
      case 'data':
        return dataCoordinates(anchor, visualization, result);
      case 'point':
        return pointCoordinates(anchor, result);
      case 'category':
        return categoryCoordinates(anchor, visualization, result);
      default:
        return rangeCoordinates(anchor, visualization, result);
    }
  };

  const resolved = coordinates();

  return resolved === null ? null : { annotation, coordinates: resolved };
};
