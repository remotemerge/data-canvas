import type { AnnotationAnchor } from '@/domain/annotation/annotation.ts';
import type { DatasetSourceKind } from '@/domain/dataset/dataset.ts';
import type { FilterExpression, FilterOperator } from '@/domain/filter/filter.ts';
import type { AggregateFunction, MetricFormat } from '@/domain/metric/metric.ts';
import type {
  VisualBinding,
  VisualizationKind,
  VisualizationPresentation,
} from '@/domain/visualization/visualization.ts';
import type { WorkspaceLayoutItem } from '@/domain/workspace/workspace.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import type { Result } from '@/shared/result/result.ts';

/**
 * Who initiated an action. Attribution is recorded on every committed action, so a human can always
 * see which changes an agent made to the workspace they share.
 */
export type Actor = 'human' | 'agent' | 'system';

/**
 * Action payload contracts.
 *
 * These are the *input* shapes callers supply, deliberately narrower than the domain entities they
 * produce. Identity, timestamps, and derived metadata are assigned by the handlers, never by the
 * caller, so an agent cannot choose an entity's ID or forge its origin.
 */

export interface BeginDatasetImportInput {
  /** Display name shown in the UI. Rendered as plain text and never used to build SQL identifiers. */
  name: string;
  sourceKind: DatasetSourceKind;
  byteSize: number;
}

export interface ImportDatasetInput {
  /**
   * The chosen local file. Typed as `unknown` at this boundary because `File` is a DOM type and the
   * application layer must not assume a browser; the data engine adapter narrows it.
   */
  file: unknown;
  /**
   * The dataset committed by `dataset.beginImport`, whose status this action resolves.
   *
   * Supplied rather than generated because the placeholder already exists in the workspace: a fresh
   * ID here would leave the `loading` row stranded forever.
   */
  datasetId: EntityId;
}

export interface FailDatasetImportInput {
  datasetId: EntityId;
  /** Corrective text for the user. Must contain no file contents; see `DomainError`. */
  reason: string;
}

export interface SetActiveDatasetInput {
  /** `undefined` clears the active dataset rather than selecting one. */
  datasetId?: EntityId;
}

export interface ApplyFilterInput {
  datasetId: EntityId;
  columnId: EntityId;
  operator: FilterOperator;
  value?: unknown;
  /** Omitted for nullary operators (`is_null`, `is_not_null`). */
  enabled?: boolean;
}

export interface RemoveFilterInput {
  filterId: EntityId;
}

export interface ClearFiltersInput {
  /** Omitted clears every filter in the workspace; supplied clears only that dataset's filters. */
  datasetId?: EntityId;
}

export interface CreateVisualizationInput {
  datasetId: EntityId;
  title: string;
  kind: VisualizationKind;
  binding: VisualBinding;
  query?: AnalysisQuery;
  presentation?: Partial<VisualizationPresentation>;
  linkedSelection?: boolean;
}

export interface UpdateVisualizationInput {
  visualizationId: EntityId;
  title?: string;
  kind?: VisualizationKind;
  binding?: VisualBinding;
  query?: AnalysisQuery;
  presentation?: Partial<VisualizationPresentation>;
  linkedSelection?: boolean;
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

export interface ClearSelectionInput {
  /** Omitted clears every selection; supplied clears only that dataset's selections. */
  datasetId?: EntityId;
}

export interface CreateMetricInput {
  datasetId: EntityId;
  name: string;
  aggregate: AggregateFunction;
  /** Required for every aggregate except `count`, which counts rows rather than a column. */
  columnId?: EntityId;
  filters?: EntityId[];
  format?: MetricFormat;
}

export interface RemoveMetricInput {
  metricId: EntityId;
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

export interface UpdateLayoutInput {
  columns?: number;
  items?: WorkspaceLayoutItem[];
}

/**
 * Every state-changing operation the application supports.
 *
 * This union is the single mutation vocabulary. React commands and WebMCP tools both construct
 * members of it and hand them to the dispatcher; neither has a private path to the store.
 *
 * The dataset actions extend the set beyond the visualization/filter operations because import is
 * itself a state change that must be attributable and revisioned. Leaving it outside the dispatcher
 * would create the second mutation path this architecture exists to prevent.
 *
 * Import spans three actions rather than one because ingestion is slow enough to be visible.
 * `beginImport` commits a `loading` placeholder immediately, then `import` resolves it to `ready`
 * or `failImport` to `error`. Each transition is separately revisioned and attributable, so a
 * half-finished import is an observable workspace state rather than a gap.
 */
export type ApplicationAction =
  | { type: 'dataset.beginImport'; payload: BeginDatasetImportInput }
  | { type: 'dataset.import'; payload: ImportDatasetInput }
  | { type: 'dataset.failImport'; payload: FailDatasetImportInput }
  | { type: 'dataset.setActive'; payload: SetActiveDatasetInput }
  | { type: 'filter.apply'; payload: ApplyFilterInput }
  | { type: 'filter.remove'; payload: RemoveFilterInput }
  | { type: 'filters.clear'; payload: ClearFiltersInput }
  | { type: 'visualization.create'; payload: CreateVisualizationInput }
  | { type: 'visualization.update'; payload: UpdateVisualizationInput }
  | { type: 'visualization.remove'; payload: RemoveVisualizationInput }
  | { type: 'selection.set'; payload: SetSelectionInput }
  | { type: 'selection.clear'; payload: ClearSelectionInput }
  | { type: 'metric.create'; payload: CreateMetricInput }
  | { type: 'metric.remove'; payload: RemoveMetricInput }
  | { type: 'annotation.add'; payload: AddAnnotationInput }
  | { type: 'annotation.remove'; payload: RemoveAnnotationInput }
  | { type: 'layout.update'; payload: UpdateLayoutInput };

export type ApplicationActionType = ApplicationAction['type'];

/** Every action type, used by exhaustiveness tests and by handler-coverage assertions. */
export const APPLICATION_ACTION_TYPES: readonly ApplicationActionType[] = [
  'dataset.beginImport',
  'dataset.import',
  'dataset.failImport',
  'dataset.setActive',
  'filter.apply',
  'filter.remove',
  'filters.clear',
  'visualization.create',
  'visualization.update',
  'visualization.remove',
  'selection.set',
  'selection.clear',
  'metric.create',
  'metric.remove',
  'annotation.add',
  'annotation.remove',
  'layout.update',
] as const;

export interface ActionContext {
  actor: Actor;
  /**
   * Optimistic concurrency assertion. When supplied and unequal to the current workspace revision,
   * the action is rejected with `STALE_WORKSPACE_REVISION` before any validation or side effect.
   *
   * Human UI actions normally omit it because the human is looking at current state. Agent write
   * tools should supply it, since an agent's decision may be based on a workspace a human has since
   * changed.
   */
  expectedRevision?: number;
  signal?: AbortSignal;
}

export interface ActionResult {
  actionId: string;
  revision: number;
  changedEntityIds: EntityId[];
  /** Concise, agent-safe prose. Must contain no dataset cell values. */
  summary: string;
}

/**
 * The dispatcher contract.
 *
 * Deviates from the research's `Promise<ActionResult>` by returning a `Result`. Validation failure
 * is the expected case at the agent boundary, so it is modelled as a value rather than an
 * exception; the WebMCP adapter needs a typed failure to map onto a structured tool error, and
 * try/catch as control flow across the whole application would be worse.
 */
export interface ApplicationActions {
  execute(action: ApplicationAction, context: ActionContext): Promise<Result<ActionResult, DomainError>>;
}
