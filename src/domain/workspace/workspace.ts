import type { Annotation } from '@/domain/annotation/annotation.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import type { Selection } from '@/domain/selection/selection.ts';
import type { SortSpec } from '@/domain/analysis/analysis-query.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { createEntityId, ID_PREFIX, type EntityId } from '@/shared/ids/entity-id.ts';

/** Monotonic counter, incremented exactly once per committed action. */
export type WorkspaceRevision = number;

export const CURRENT_SCHEMA_VERSION = 1;

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

/**
 * The single canonical workspace aggregate.
 *
 * Entities are normalized `Record<EntityId, T>` maps rather than arrays so that actions can address
 * one entity without rewriting a list, and so revision diffs stay cheap.
 *
 * Raw analytical rows are absent by design. They live in DuckDB, never here.
 */
export interface Workspace {
  id: EntityId;
  schemaVersion: number;
  revision: WorkspaceRevision;
  name: string;

  activeDatasetId?: EntityId;

  datasets: Record<EntityId, Dataset>;
  /** Governed joins between datasets. The relationship graph is kept acyclic; see the validator. */
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
