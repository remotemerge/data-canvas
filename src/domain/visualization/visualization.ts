import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { BinStrategy } from '@/domain/analysis/bin-strategy.ts';
import type { SelectionLinkMode } from '@/domain/visualization/selection-link-mode.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export type VisualizationKind =
  | 'line'
  | 'bar'
  | 'area'
  | 'scatter'
  | 'donut'
  | 'kpi'
  | 'table'
  | 'histogram'
  | 'boxplot'
  | 'heatmap';

export const VISUALIZATION_KINDS: readonly VisualizationKind[] = [
  'line',
  'bar',
  'area',
  'scatter',
  'donut',
  'kpi',
  'table',
  'histogram',
  'boxplot',
  'heatmap',
] as const;

// Kinds with distribution-specific query results.
export const DISTRIBUTION_KINDS: readonly VisualizationKind[] = ['histogram', 'boxplot', 'heatmap'] as const;

// Maps dataset columns to visual channels by ID.
export interface VisualBinding {
  x?: EntityId;
  y?: EntityId[];
  series?: EntityId;
  color?: EntityId;
  size?: EntityId;
  tooltip?: EntityId[];
  // Optional binning for the x dimension.
  binX?: BinStrategy;
  // Optional binning for the series dimension.
  binSeries?: BinStrategy;
}

export interface VisualizationPresentation {
  showLegend: boolean;
  showGrid: boolean;
  stacked: boolean;
  // Chart-relative sizing hints.
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
  // How this chart responds to external selection.
  linkMode: SelectionLinkMode;
  createdBy: 'human' | 'agent' | 'system';
}

// Visualization definitions do not contain ECharts renderer objects.
