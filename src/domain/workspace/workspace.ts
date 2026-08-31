import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Selection } from '@/domain/selection/selection.ts';
import type { SortSpec } from '@/domain/analysis/analysis-query.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { createEntityId, ID_PREFIX, type EntityId } from '@/shared/ids/entity-id.ts';

// Monotonic revision incremented once per committed action.
export type WorkspaceRevision = number;

export const CURRENT_SCHEMA_VERSION = 2;

export interface WorkspaceLayoutItem {
  visualizationId: EntityId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkspaceLayout {
  columns: number;
  items: WorkspaceLayoutItem[];
}

// Canonical normalized workspace aggregate. Raw analytical rows remain in DuckDB.
export interface Workspace {
  id: EntityId;
  schemaVersion: number;
  revision: WorkspaceRevision;
  name: string;

  activeDatasetId?: EntityId;

  datasets: Record<EntityId, Dataset>;
  // Workspace-level derived columns kept in an acyclic reference graph.
  derivedColumns: Record<EntityId, DerivedColumn>;
  // Governed joins between datasets.
  relationships: Record<EntityId, Relationship>;
  visualizations: Record<EntityId, Visualization>;
  filters: Record<EntityId, Filter>;
  tableSorts: Record<EntityId, SortSpec[]>;
  selections: Record<EntityId, Selection>;
  metrics: Record<EntityId, Metric>;
  annotations: Record<EntityId, Annotation>;

  layout: WorkspaceLayout;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_LAYOUT_COLUMNS = 12;

export const createEmptyWorkspace = (name = 'Untitled workspace'): Workspace => {
  const now = new Date().toISOString();

  return {
    id: createEntityId(ID_PREFIX.workspace),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    name,
    datasets: {},
    derivedColumns: {},
    relationships: {},
    visualizations: {},
    filters: {},
    tableSorts: {},
    selections: {},
    metrics: {},
    annotations: {},
    layout: { columns: DEFAULT_LAYOUT_COLUMNS, items: [] },
    createdAt: now,
    updatedAt: now,
  };
};
