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
import {
  handleClearSelection,
  handleExtendSelection,
  handleSetSelection,
} from '@/application/actions/handlers/selection-handlers.ts';
import {
  handleCreateVisualization,
  handleRemoveVisualization,
  handleSetVisualizationLinkMode,
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

// Dependencies injected into the dispatcher.
export interface DispatcherDeps {
  store: {
    getState(): WorkspaceState;
    setState(partial: (state: WorkspaceState) => WorkspaceState): void;
  };
  dataEngine: DataEnginePort;
}

// Routes an action to its handler; the switch is exhaustive over `ApplicationAction`.
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
    case 'selection.extend':
      return handleExtendSelection(workspace, action.payload, deps);
    case 'selection.clear':
      return handleClearSelection(workspace, action.payload, deps);
    case 'visualization.setLinkMode':
      return handleSetVisualizationLinkMode(workspace, action.payload, deps);
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

// Reads the signal at each check around an `await`; it may change between checks.
const isAborted = (context: ActionContext): boolean => context.signal?.aborted ?? false;

// Creates the application's single mutation entry point.
export const createDispatcher = (deps: DispatcherDeps): ApplicationActions => {
  // Serializes action execution so revision checks cannot race.
  let queue: Promise<unknown> = Promise.resolve();

  const run = async (action: ApplicationAction, context: ActionContext): Promise<Result<ActionResult, DomainError>> => {
    if (isAborted(context)) {
      return err(abortedError());
    }

    const workspace = deps.store.getState().workspace;

    // Reject stale actions before validation or side effects.
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

    if (!outcome.ok) {
      return outcome;
    }

    // Handlers may await the engine. Check cancellation again before committing their result.
    if (isAborted(context)) {
      return err(abortedError());
    }

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

    // Commit workspace and history together so subscribers never observe only one update.
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

      // Keep the queue usable after an unexpected throw; normal failures are returned as values.
      queue = result.catch(() => undefined);

      return result;
    },
  };
};

// Shared application dispatcher.
export const dispatcher = createDispatcher({ store: workspaceStore, dataEngine: registeredDataEngine });
