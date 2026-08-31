import type { AnnotationAnchor } from '@/domain/annotation/annotation.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import type { DatasetSourceKind } from '@/domain/dataset/dataset.ts';
import type { FilterExpression, FilterOperator } from '@/domain/filter/filter.ts';
import type { AggregateFunction, MetricFormat } from '@/domain/metric/metric.ts';
import type { MetricModifier } from '@/domain/metric/metric-modifier.ts';
import type { JoinKind, RelationshipKeyPair, RelationshipKind } from '@/domain/relationship/relationship.ts';
import type {
  VisualBinding,
  VisualizationKind,
  VisualizationPresentation,
} from '@/domain/visualization/visualization.ts';
import type { SelectionLinkMode } from '@/domain/visualization/selection-link-mode.ts';
import type { Workspace, WorkspaceLayoutItem } from '@/domain/workspace/workspace.ts';
import type { AnalysisQuery, SortSpec } from '@/domain/analysis/analysis-query.ts';
import type { ImportProgress } from '@/application/ports/data-engine-port.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import type { Result } from '@/shared/result/result.ts';

// Identifies who initiated a committed action for activity history.
export type Actor = 'human' | 'agent' | 'system';

// Input shapes accepted by the dispatcher. Handlers assign entity metadata.

export interface BeginDatasetImportInput {
  // Display name only; render it as text and never use it as a SQL identifier.
  name: string;
  sourceKind: DatasetSourceKind;
  byteSize: number;
}

export interface ImportDatasetInput {
  // Local file supplied by the UI; the data-engine adapter narrows this DOM type.
  file: unknown;
  // ID of the loading dataset created by `dataset.beginImport`.
  datasetId: EntityId;
  // Transient progress callback; not workspace state or history.
  onProgress?: (progress: ImportProgress) => void;
}

export interface FailDatasetImportInput {
  datasetId: EntityId;
  // User-facing failure text; it must not contain file contents.
  reason: string;
}

export interface SetActiveDatasetInput {
  // Pass `undefined` to clear the active dataset.
  datasetId?: EntityId;
}

export interface ApplyFilterInput {
  datasetId: EntityId;
  columnId: EntityId;
  operator: FilterOperator;
  value?: unknown;
  // Omitted for nullary operators (`is_null`, `is_not_null`).
  enabled?: boolean;
}

export interface RemoveFilterInput {
  filterId: EntityId;
}

export interface ClearFiltersInput {
  // Omitted clears all filters; a dataset ID limits the clear to that dataset.
  datasetId?: EntityId;
}

export interface SetTableSortInput {
  datasetId: EntityId;
  sort: SortSpec[];
}

export interface CreateVisualizationInput {
  datasetId: EntityId;
  title: string;
  kind: VisualizationKind;
  binding: VisualBinding;
  query?: AnalysisQuery;
  presentation?: Partial<VisualizationPresentation>;
  linkMode?: SelectionLinkMode;
}

export interface UpdateVisualizationInput {
  visualizationId: EntityId;
  title?: string;
  kind?: VisualizationKind;
  binding?: VisualBinding;
  query?: AnalysisQuery;
  presentation?: Partial<VisualizationPresentation>;
  linkMode?: SelectionLinkMode;
}

export interface SetVisualizationLinkModeInput {
  visualizationId: EntityId;
  linkMode: SelectionLinkMode;
}

export interface RemoveVisualizationInput {
  visualizationId: EntityId;
}

export interface SetSelectionInput {
  datasetId: EntityId;
  mode: 'keys' | 'predicate';
  keys?: string[];
  predicate?: FilterExpression;
  origin: 'table' | 'chart' | 'agent';
}

// Extends the current selection; with no selection, behaves like `selection.set`.
export interface ExtendSelectionInput {
  datasetId: EntityId;
  mode: 'keys' | 'predicate';
  keys?: string[];
  predicate?: FilterExpression;
  origin: 'table' | 'chart' | 'agent';
}

export interface ClearSelectionInput {
  // Omitted clears all selections; a dataset ID limits the clear to that dataset.
  datasetId?: EntityId;
}

export interface CreateMetricInput {
  datasetId: EntityId;
  name: string;
  aggregate: AggregateFunction;
  // Required for every aggregate except `count`, which counts rows.
  columnId?: EntityId;
  filters?: EntityId[];
  format?: MetricFormat;
  // Optional window transformation over the aggregate.
  modifier?: MetricModifier;
}

export interface UpdateMetricInput {
  metricId: EntityId;
  name?: string;
  aggregate?: AggregateFunction;
  columnId?: EntityId;
  filters?: EntityId[];
  format?: MetricFormat;
  modifier?: MetricModifier;
}

export interface RemoveMetricInput {
  metricId: EntityId;
}

export interface CreateDerivedColumnInput {
  datasetId: EntityId;
  // Display label only; render it as text and never use it as a SQL identifier.
  name: string;
  expression: DerivedExpression;
}

export interface RemoveDerivedColumnInput {
  derivedColumnId: EntityId;
}

export interface AddAnnotationInput {
  visualizationId: EntityId;
  text: string;
  anchor: AnnotationAnchor;
  origin: 'human' | 'agent';
}

export interface RemoveAnnotationInput {
  annotationId: EntityId;
}

export interface CreateRelationshipInput {
  leftDatasetId: EntityId;
  rightDatasetId: EntityId;
  on: RelationshipKeyPair[];
  kind: RelationshipKind;
  join: JoinKind;
}

export interface RemoveRelationshipInput {
  relationshipId: EntityId;
}

export interface RemoveDatasetInput {
  datasetId: EntityId;
  // Whether to remove entities that reference the dataset.
  cascade?: boolean;
}

export interface UpdateLayoutInput {
  columns?: number;
  items?: WorkspaceLayoutItem[];
}

// Internal metadata delta used by undo and redo.
export interface RestoreWorkspaceInput {
  state: Partial<
    Pick<
      Workspace,
      | 'activeDatasetId'
      | 'derivedColumns'
      | 'relationships'
      | 'visualizations'
      | 'filters'
      | 'tableSorts'
      | 'selections'
      | 'metrics'
      | 'annotations'
      | 'layout'
    >
  >;
  changedEntityIds: EntityId[];
}

// Shared mutation vocabulary passed to the application dispatcher by React and WebMCP.
export type ApplicationAction =
  | { type: 'dataset.beginImport'; payload: BeginDatasetImportInput }
  | { type: 'dataset.import'; payload: ImportDatasetInput }
  | { type: 'dataset.failImport'; payload: FailDatasetImportInput }
  | { type: 'dataset.setActive'; payload: SetActiveDatasetInput }
  | { type: 'dataset.remove'; payload: RemoveDatasetInput }
  | { type: 'relationship.create'; payload: CreateRelationshipInput }
  | { type: 'relationship.remove'; payload: RemoveRelationshipInput }
  | { type: 'filter.apply'; payload: ApplyFilterInput }
  | { type: 'filter.remove'; payload: RemoveFilterInput }
  | { type: 'filters.clear'; payload: ClearFiltersInput }
  | { type: 'table.sort'; payload: SetTableSortInput }
  | { type: 'visualization.create'; payload: CreateVisualizationInput }
  | { type: 'visualization.update'; payload: UpdateVisualizationInput }
  | { type: 'visualization.remove'; payload: RemoveVisualizationInput }
  | { type: 'selection.set'; payload: SetSelectionInput }
  | { type: 'selection.extend'; payload: ExtendSelectionInput }
  | { type: 'selection.clear'; payload: ClearSelectionInput }
  | { type: 'visualization.setLinkMode'; payload: SetVisualizationLinkModeInput }
  | { type: 'metric.create'; payload: CreateMetricInput }
  | { type: 'metric.update'; payload: UpdateMetricInput }
  | { type: 'metric.remove'; payload: RemoveMetricInput }
  | { type: 'derivedColumn.create'; payload: CreateDerivedColumnInput }
  | { type: 'derivedColumn.remove'; payload: RemoveDerivedColumnInput }
  | { type: 'annotation.add'; payload: AddAnnotationInput }
  | { type: 'annotation.remove'; payload: RemoveAnnotationInput }
  | { type: 'layout.update'; payload: UpdateLayoutInput }
  | { type: 'history.restore'; payload: RestoreWorkspaceInput };

export type ApplicationActionType = ApplicationAction['type'];

// All action types, used by handler-coverage and exhaustiveness tests.
export const APPLICATION_ACTION_TYPES: readonly ApplicationActionType[] = [
  'dataset.beginImport',
  'dataset.import',
  'dataset.failImport',
  'dataset.setActive',
  'dataset.remove',
  'relationship.create',
  'relationship.remove',
  'filter.apply',
  'filter.remove',
  'filters.clear',
  'table.sort',
  'visualization.create',
  'visualization.update',
  'visualization.remove',
  'selection.set',
  'selection.extend',
  'selection.clear',
  'visualization.setLinkMode',
  'metric.create',
  'metric.update',
  'metric.remove',
  'derivedColumn.create',
  'derivedColumn.remove',
  'annotation.add',
  'annotation.remove',
  'layout.update',
  'history.restore',
] as const;

export interface ActionContext {
  actor: Actor;
  // Marks an action created by undo or redo.
  origin?: 'undo' | 'redo';
  // Optional optimistic-concurrency check against an observed workspace revision.
  expectedRevision?: number;
  signal?: AbortSignal;
}

export interface ActionResult {
  actionId: string;
  revision: number;
  changedEntityIds: EntityId[];
  // Concise, agent-safe summary with no dataset cell values.
  summary: string;
}

// Executes an application action and returns typed failures.
export interface ApplicationActions {
  execute(action: ApplicationAction, context: ActionContext): Promise<Result<ActionResult, DomainError>>;
}
