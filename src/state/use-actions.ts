import { useMemo } from 'react';
import type {
  ActionResult,
  AddAnnotationInput,
  ApplyFilterInput,
  BeginDatasetImportInput,
  ClearFiltersInput,
  ClearSelectionInput,
  CreateDerivedColumnInput,
  ExtendSelectionInput,
  CreateMetricInput,
  CreateRelationshipInput,
  CreateVisualizationInput,
  FailDatasetImportInput,
  ImportDatasetInput,
  RemoveAnnotationInput,
  RemoveDatasetInput,
  RemoveDerivedColumnInput,
  RemoveFilterInput,
  RemoveMetricInput,
  RemoveRelationshipInput,
  RemoveVisualizationInput,
  SetActiveDatasetInput,
  SetSelectionInput,
  SetTableSortInput,
  SetVisualizationLinkModeInput,
  UpdateLayoutInput,
  UpdateMetricInput,
  UpdateVisualizationInput,
} from '@/application/actions/action-types.ts';
import { dispatcher } from '@/application/actions/dispatcher.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';
import { createUndoRedo } from '@/application/history/undo-redo.ts';
import { workspaceStore } from '@/state/workspace-store.ts';

type Command<TInput> = (input: TInput) => Promise<Result<ActionResult, DomainError>>;

export interface WorkspaceCommands {
  beginDatasetImport: Command<BeginDatasetImportInput>;
  importDataset: Command<ImportDatasetInput>;
  failDatasetImport: Command<FailDatasetImportInput>;
  setActiveDataset: Command<SetActiveDatasetInput>;
  removeDataset: Command<RemoveDatasetInput>;
  createRelationship: Command<CreateRelationshipInput>;
  removeRelationship: Command<RemoveRelationshipInput>;
  applyFilter: Command<ApplyFilterInput>;
  removeFilter: Command<RemoveFilterInput>;
  clearFilters: Command<ClearFiltersInput>;
  setTableSort: Command<SetTableSortInput>;
  createVisualization: Command<CreateVisualizationInput>;
  updateVisualization: Command<UpdateVisualizationInput>;
  removeVisualization: Command<RemoveVisualizationInput>;
  setVisualizationLinkMode: Command<SetVisualizationLinkModeInput>;
  setSelection: Command<SetSelectionInput>;
  extendSelection: Command<ExtendSelectionInput>;
  clearSelection: Command<ClearSelectionInput>;
  createMetric: Command<CreateMetricInput>;
  updateMetric: Command<UpdateMetricInput>;
  removeMetric: Command<RemoveMetricInput>;
  createDerivedColumn: Command<CreateDerivedColumnInput>;
  removeDerivedColumn: Command<RemoveDerivedColumnInput>;
  addAnnotation: Command<AddAnnotationInput>;
  removeAnnotation: Command<RemoveAnnotationInput>;
  updateLayout: Command<UpdateLayoutInput>;
  undo: () => Promise<Result<ActionResult, DomainError>>;
  redo: () => Promise<Result<ActionResult, DomainError>>;
}

const historyCommands = createUndoRedo({ dispatcher, store: workspaceStore });

// Human commands omit expectedRevision; agent writes supply the revision they observed.
const humanCommands: WorkspaceCommands = {
  beginDatasetImport: (input) =>
    dispatcher.execute({ type: 'dataset.beginImport', payload: input }, { actor: 'human' }),
  importDataset: (input) => dispatcher.execute({ type: 'dataset.import', payload: input }, { actor: 'human' }),
  failDatasetImport: (input) => dispatcher.execute({ type: 'dataset.failImport', payload: input }, { actor: 'human' }),
  setActiveDataset: (input) => dispatcher.execute({ type: 'dataset.setActive', payload: input }, { actor: 'human' }),
  removeDataset: (input) => dispatcher.execute({ type: 'dataset.remove', payload: input }, { actor: 'human' }),
  createRelationship: (input) =>
    dispatcher.execute({ type: 'relationship.create', payload: input }, { actor: 'human' }),
  removeRelationship: (input) =>
    dispatcher.execute({ type: 'relationship.remove', payload: input }, { actor: 'human' }),
  applyFilter: (input) => dispatcher.execute({ type: 'filter.apply', payload: input }, { actor: 'human' }),
  removeFilter: (input) => dispatcher.execute({ type: 'filter.remove', payload: input }, { actor: 'human' }),
  clearFilters: (input) => dispatcher.execute({ type: 'filters.clear', payload: input }, { actor: 'human' }),
  setTableSort: (input) => dispatcher.execute({ type: 'table.sort', payload: input }, { actor: 'human' }),
  createVisualization: (input) =>
    dispatcher.execute({ type: 'visualization.create', payload: input }, { actor: 'human' }),
  updateVisualization: (input) =>
    dispatcher.execute({ type: 'visualization.update', payload: input }, { actor: 'human' }),
  removeVisualization: (input) =>
    dispatcher.execute({ type: 'visualization.remove', payload: input }, { actor: 'human' }),
  setVisualizationLinkMode: (input) =>
    dispatcher.execute({ type: 'visualization.setLinkMode', payload: input }, { actor: 'human' }),
  setSelection: (input) => dispatcher.execute({ type: 'selection.set', payload: input }, { actor: 'human' }),
  extendSelection: (input) => dispatcher.execute({ type: 'selection.extend', payload: input }, { actor: 'human' }),
  clearSelection: (input) => dispatcher.execute({ type: 'selection.clear', payload: input }, { actor: 'human' }),
  createMetric: (input) => dispatcher.execute({ type: 'metric.create', payload: input }, { actor: 'human' }),
  updateMetric: (input) => dispatcher.execute({ type: 'metric.update', payload: input }, { actor: 'human' }),
  removeMetric: (input) => dispatcher.execute({ type: 'metric.remove', payload: input }, { actor: 'human' }),
  createDerivedColumn: (input) =>
    dispatcher.execute({ type: 'derivedColumn.create', payload: input }, { actor: 'human' }),
  removeDerivedColumn: (input) =>
    dispatcher.execute({ type: 'derivedColumn.remove', payload: input }, { actor: 'human' }),
  addAnnotation: (input) => dispatcher.execute({ type: 'annotation.add', payload: input }, { actor: 'human' }),
  removeAnnotation: (input) => dispatcher.execute({ type: 'annotation.remove', payload: input }, { actor: 'human' }),
  updateLayout: (input) => dispatcher.execute({ type: 'layout.update', payload: input }, { actor: 'human' }),
  undo: historyCommands.undo,
  redo: historyCommands.redo,
};

// React's shared mutation commands.
export const useActions = (): WorkspaceCommands => useMemo(() => humanCommands, []);
