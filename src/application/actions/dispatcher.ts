import type {
  ActionContext,
  ActionResult,
  ApplicationAction,
  ApplicationActions,
} from '@/application/actions/action-types.ts';
import {
  handleBeginDatasetImport,
  handleFailDatasetImport,
  handleImportDataset,
  handleSetActiveDataset,
} from '@/application/actions/handlers/dataset-handlers.ts';
import {
  handleApplyFilter,
  handleClearFilters,
  handleRemoveFilter,
} from '@/application/actions/handlers/filter-handlers.ts';
import type { HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import { handleUpdateLayout } from '@/application/actions/handlers/layout-handlers.ts';
import {
  handleCreateRelationship,
  handleRemoveDataset,
  handleRemoveRelationship,
} from '@/application/actions/handlers/relationship-handlers.ts';
import { handleSetTableSort } from '@/application/actions/handlers/table-handlers.ts';
import {
  handleCreateMetric,
  handleRemoveMetric,
  handleUpdateMetric,
} from '@/application/actions/handlers/metric-handlers.ts';
import {
  handleCreateDerivedColumn,
  handleRemoveDerivedColumn,
} from '@/application/actions/handlers/derived-column-handlers.ts';
import { handleAddAnnotation, handleRemoveAnnotation } from '@/application/actions/handlers/annotation-handlers.ts';
import { handleClearSelection, handleSetSelection } from '@/application/actions/handlers/selection-handlers.ts';
import {
  handleCreateVisualization,
  handleRemoveVisualization,
  handleUpdateVisualization,
} from '@/application/actions/handlers/visualization-handlers.ts';
import { appendHistoryEntry } from '@/application/history/action-history.ts';
import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { invertAction } from '@/application/history/invert-action.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';
import { workspaceStore } from '@/state/workspace-store.ts';
import type { WorkspaceState } from '@/state/workspace-store.ts';

/**
 * What the dispatcher needs in order to reach state and the outside world.
 *
 * Passing the store rather than importing a singleton lets tests drive an isolated dispatcher, and
 * lets the data engine be swapped for the real one without touching a handler.
 */
export interface DispatcherDeps {
  store: {
    getState(): WorkspaceState;
    setState(partial: (state: WorkspaceState) => WorkspaceState): void;
  };
  dataEngine: DataEnginePort;
}

/** Dispatches one action to its handler. Exhaustive over `ApplicationAction` by construction. */
const runHandler = (
  workspace: Workspace,
  action: ApplicationAction,
  deps: HandlerDeps,
): Result<HandlerOutcome, DomainError> | Promise<Result<HandlerOutcome, DomainError>> => {
  switch (action.type) {
    case 'dataset.beginImport':
      return handleBeginDatasetImport(workspace, action.payload, deps);
    case 'dataset.import':
      return handleImportDataset(workspace, action.payload, deps);
    case 'dataset.failImport':
      return handleFailDatasetImport(workspace, action.payload, deps);
    case 'dataset.setActive':
      return handleSetActiveDataset(workspace, action.payload, deps);
    case 'dataset.remove':
      return handleRemoveDataset(workspace, action.payload, deps);
    case 'relationship.create':
      return handleCreateRelationship(workspace, action.payload, deps);
    case 'relationship.remove':
      return handleRemoveRelationship(workspace, action.payload, deps);
    case 'filter.apply':
      return handleApplyFilter(workspace, action.payload, deps);
    case 'filter.remove':
      return handleRemoveFilter(workspace, action.payload, deps);
    case 'filters.clear':
      return handleClearFilters(workspace, action.payload, deps);
    case 'table.sort':
      return handleSetTableSort(workspace, action.payload, deps);
    case 'visualization.create':
      return handleCreateVisualization(workspace, action.payload, deps);
    case 'visualization.update':
      return handleUpdateVisualization(workspace, action.payload, deps);
    case 'visualization.remove':
      return handleRemoveVisualization(workspace, action.payload, deps);
    case 'selection.set':
      return handleSetSelection(workspace, action.payload, deps);
    case 'selection.clear':
      return handleClearSelection(workspace, action.payload, deps);
    case 'metric.create':
      return handleCreateMetric(workspace, action.payload, deps);
    case 'metric.update':
      return handleUpdateMetric(workspace, action.payload, deps);
    case 'metric.remove':
      return handleRemoveMetric(workspace, action.payload, deps);
    case 'derivedColumn.create':
      return handleCreateDerivedColumn(workspace, action.payload, deps);
    case 'derivedColumn.remove':
      return handleRemoveDerivedColumn(workspace, action.payload, deps);
    case 'annotation.add':
      return handleAddAnnotation(workspace, action.payload, deps);
    case 'annotation.remove':
      return handleRemoveAnnotation(workspace, action.payload, deps);
    case 'layout.update':
      return handleUpdateLayout(workspace, action.payload, deps);
    case 'history.restore':
      return ok({
        workspace: { ...workspace, ...action.payload.state },
        changedEntityIds: action.payload.changedEntityIds,
        summary: 'Restored workspace metadata from history.',
      });
  }
};

const abortedError = (): DomainError =>
  domainError('UNSUPPORTED_OPERATION', 'The action was cancelled before it was committed.', { aborted: true });

/**
 * Reads the signal's current state.
 *
 * A function rather than an inline check: the dispatcher tests the same signal twice around an
 * `await`, and control-flow narrowing from the first test would otherwise convince the compiler the
 * second is unreachable, even though the signal can abort in between.
 */
const isAborted = (context: ActionContext): boolean => context.signal?.aborted ?? false;

/**
 * Creates the application's single mutation entry point.
 *
 * Sequence, in order: revision check → semantic validation and side effects → atomic commit →
 * history append. Every step before the commit is free of state changes, so a rejected action
 * leaves the workspace exactly as it was.
 */
export const createDispatcher = (deps: DispatcherDeps): ApplicationActions => {
  /**
   * Serializes execution.
   *
   * Two `execute` calls arriving together would otherwise both read the same revision, both pass
   * their revision checks, and the second commit would silently overwrite the first — the precise
   * failure the revision mechanism exists to prevent. Chaining onto a single promise makes
   * read-validate-commit atomic with respect to other actions.
   */
  let queue: Promise<unknown> = Promise.resolve();

  const run = async (action: ApplicationAction, context: ActionContext): Promise<Result<ActionResult, DomainError>> => {
    if (isAborted(context)) return err(abortedError());

    const workspace = deps.store.getState().workspace;

    // Revision check first: a stale caller must be rejected before any validation or side effect
    // runs, since its decision was made against a workspace that no longer exists.
    if (context.expectedRevision !== undefined && context.expectedRevision !== workspace.revision) {
      return err(
        domainError(
          'STALE_WORKSPACE_REVISION',
          `The workspace has changed since revision ${context.expectedRevision}; it is now at revision ${workspace.revision}.`,
          { expectedRevision: context.expectedRevision, currentRevision: workspace.revision },
        ),
      );
    }

    const outcome = await runHandler(workspace, action, { dataEngine: deps.dataEngine, actor: context.actor });

    if (!outcome.ok) return outcome;

    // Handlers may await the data engine, so re-check abortion before committing. Abandoning here
    // costs the completed work but never leaves partially applied state.
    if (isAborted(context)) return err(abortedError());

    const actionId = createEntityId(ID_PREFIX.action);
    const revision = workspace.revision + 1;
    const inverseAction = invertAction(action, workspace, outcome.value.changedEntityIds);
    const entry: ActionHistoryEntry = {
      actionId,
      type: action.type,
      actor: context.actor,
      revision,
      changedEntityIds: outcome.value.changedEntityIds,
      timestamp: new Date().toISOString(),
      summary: outcome.value.summary,
      undoable: inverseAction !== undefined,
      ...(inverseAction === undefined ? {} : { inverseAction }),
      ...(context.origin === undefined ? {} : { origin: context.origin }),
    };

    // One `setState` call. Splitting the workspace and history writes would let a subscriber
    // observe changed entities at an unchanged revision, breaking the concurrency contract that
    // `expectedRevision` rests on.
    deps.store.setState((state) => {
      const undoStack =
        context.origin === 'undo'
          ? state.undoStack.slice(0, -1)
          : context.origin === 'redo'
            ? [...state.undoStack, actionId].slice(-100)
            : [...state.undoStack, actionId].slice(-100);
      const redoStack =
        context.origin === 'undo'
          ? [...state.redoStack, actionId].slice(-100)
          : context.origin === 'redo'
            ? state.redoStack.slice(0, -1)
            : [];

      return {
        ...state,
        workspace: {
          ...outcome.value.workspace,
          revision,
          updatedAt: entry.timestamp,
        },
        history: appendHistoryEntry(state.history, entry),
        undoStack,
        redoStack,
      };
    });

    return ok({
      actionId,
      revision,
      changedEntityIds: outcome.value.changedEntityIds,
      summary: outcome.value.summary,
    });
  };

  return {
    execute: (action, context) => {
      const result = queue.then(() => run(action, context));

      // The queue must not stay rejected. `run` already returns failures as values, so this only
      // guards against an unexpected throw poisoning every subsequent action.
      queue = result.catch(() => undefined);

      return result;
    },
  };
};

/**
 * The application's dispatcher instance.
 *
 * The engine arrives through the registry rather than by direct import, so this module carries no
 * DuckDB dependency. Until bootstrap registers and starts one, engine-backed actions fail with
 * `ENGINE_UNAVAILABLE` while metadata-only actions stay fully functional.
 */
export const dispatcher = createDispatcher({ store: workspaceStore, dataEngine: registeredDataEngine });
