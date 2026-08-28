import type {
  ActionContext,
  ActionResult,
  ApplicationAction,
  ApplicationActions,
} from '@/application/actions/action-types.ts';
import { handleImportDataset, handleSetActiveDataset } from '@/application/actions/handlers/dataset-handlers.ts';
import {
  handleApplyFilter,
  handleClearFilters,
  handleRemoveFilter,
} from '@/application/actions/handlers/filter-handlers.ts';
import type { HandlerDeps, HandlerOutcome } from '@/application/actions/handlers/handler-types.ts';
import { handleUpdateLayout } from '@/application/actions/handlers/layout-handlers.ts';
import { handleCreateMetric, handleRemoveMetric } from '@/application/actions/handlers/metric-handlers.ts';
import { handleAddAnnotation, handleRemoveAnnotation } from '@/application/actions/handlers/annotation-handlers.ts';
import { handleClearSelection, handleSetSelection } from '@/application/actions/handlers/selection-handlers.ts';
import {
  handleCreateVisualization,
  handleRemoveVisualization,
  handleUpdateVisualization,
} from '@/application/actions/handlers/visualization-handlers.ts';
import { appendHistoryEntry } from '@/application/history/action-history.ts';
import type { ActionHistoryEntry } from '@/application/history/action-history.ts';
import { unavailableDataEngine } from '@/application/ports/data-engine-port.ts';
import type { DataEnginePort } from '@/application/ports/data-engine-port.ts';
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
    case 'dataset.import':
      return handleImportDataset(workspace, action.payload, deps);
    case 'dataset.setActive':
      return handleSetActiveDataset(workspace, action.payload, deps);
    case 'filter.apply':
      return handleApplyFilter(workspace, action.payload, deps);
    case 'filter.remove':
      return handleRemoveFilter(workspace, action.payload, deps);
    case 'filters.clear':
      return handleClearFilters(workspace, action.payload, deps);
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
    case 'metric.remove':
      return handleRemoveMetric(workspace, action.payload, deps);
    case 'annotation.add':
      return handleAddAnnotation(workspace, action.payload, deps);
    case 'annotation.remove':
      return handleRemoveAnnotation(workspace, action.payload, deps);
    case 'layout.update':
      return handleUpdateLayout(workspace, action.payload, deps);
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
    const entry: ActionHistoryEntry = {
      actionId,
      type: action.type,
      actor: context.actor,
      revision,
      changedEntityIds: outcome.value.changedEntityIds,
      timestamp: new Date().toISOString(),
      summary: outcome.value.summary,
    };

    // One `setState` call. Splitting the workspace and history writes would let a subscriber
    // observe changed entities at an unchanged revision, breaking the concurrency contract that
    // `expectedRevision` rests on.
    deps.store.setState((state) => ({
      ...state,
      workspace: {
        ...outcome.value.workspace,
        revision,
        updatedAt: entry.timestamp,
      },
      history: appendHistoryEntry(state.history, entry),
    }));

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
 * The data engine starts unavailable; actions needing it fail with `ENGINE_UNAVAILABLE` until a
 * real engine is installed. Metadata-only actions are fully functional regardless.
 */
export const dispatcher = createDispatcher({ store: workspaceStore, dataEngine: unavailableDataEngine });
