import type { ChartResult } from '@/application/queries/visualization-query.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { resolveAnnotationAnchor } from './annotation-anchoring.ts';

export interface AnnotationMarks {
  markPoint?: { data: unknown[] };
  markLine?: { data: unknown[] };
  markArea?: { data: unknown[] };
}

export const buildAnnotationMarks = (
  annotations: readonly Annotation[],
  visualization: Visualization,
  result: ChartResult,
): AnnotationMarks => {
  const point: unknown[] = [];
  const line: unknown[] = [];
  const area: unknown[] = [];
  for (const annotation of annotations) {
    const resolved = resolveAnnotationAnchor(annotation, visualization, result);
    if (resolved === null) continue;
    const label = {
      show: true,
      formatter: annotation.createdBy === 'agent' ? `agent · ${annotation.text}` : annotation.text,
    };
    if (annotation.anchor.kind === 'point') point.push({ coord: resolved.coordinates, label });
    else if (annotation.anchor.kind === 'data') line.push({ xAxis: resolved.coordinates[0], label });
    else area.push([{ xAxis: resolved.coordinates[0], label }, { xAxis: resolved.coordinates[1] }]);
  }
  return {
    ...(point.length === 0 ? {} : { markPoint: { data: point } }),
    ...(line.length === 0 ? {} : { markLine: { data: line } }),
    ...(area.length === 0 ? {} : { markArea: { data: area } }),
  };
};
