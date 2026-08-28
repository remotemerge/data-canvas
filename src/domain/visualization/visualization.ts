import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export type VisualizationKind = 'line' | 'bar' | 'area' | 'scatter' | 'donut' | 'kpi' | 'table';

export const VISUALIZATION_KINDS: readonly VisualizationKind[] = [
  'line',
  'bar',
  'area',
  'scatter',
  'donut',
  'kpi',
  'table',
] as const;

/**
 * Maps dataset columns onto visual channels by ID.
 *
 * This records intent rather than configuration. The ECharts adapter translates a binding into
 * `dataset` + `series.encode`. Keeping it ID-based lets a visualization survive a renderer change
 * without a migration.
 */
export interface VisualBinding {
  x?: EntityId;
  y?: EntityId[];
  series?: EntityId;
  color?: EntityId;
  size?: EntityId;
  tooltip?: EntityId[];
}

export interface VisualizationPresentation {
  showLegend: boolean;
  showGrid: boolean;
  stacked: boolean;
  /** Chart-relative sizing hints; the concrete grid geometry lives in `WorkspaceLayout`. */
  colSpan?: number;
  rowSpan?: number;
}

export interface Visualization {
  id: EntityId;
  datasetId: EntityId;
  title: string;
  kind: VisualizationKind;
  query: AnalysisQuery;
  binding: VisualBinding;
  presentation: VisualizationPresentation;
  /** When true, this chart participates in workspace-wide cross-filtering. */
  linkedSelection: boolean;
}

/*
 * Invariant. A `Visualization` must never hold an `EChartsOption` or any other renderer object.
 * ECharts renders this definition; it does not define it. Storing renderer config here would give
 * an agent a path to pass arbitrary chart configuration through the domain model.
 */
