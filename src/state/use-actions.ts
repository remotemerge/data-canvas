import { useMemo } from 'react';
import type {
  ActionResult,
  AddAnnotationInput,
  ApplyFilterInput,
  BeginDatasetImportInput,
  ClearFiltersInput,
  ClearSelectionInput,
  CreateMetricInput,
  CreateVisualizationInput,
  FailDatasetImportInput,
  ImportDatasetInput,
  RemoveAnnotationInput,
  RemoveFilterInput,
  RemoveMetricInput,
  RemoveVisualizationInput,
  SetActiveDatasetInput,
  SetSelectionInput,
  SetTableSortInput,
  UpdateLayoutInput,
  UpdateVisualizationInput,
} from '@/application/actions/action-types.ts';
import { dispatcher } from '@/application/actions/dispatcher.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';

type Command<TInput> = (input: TInput) => Promise<Result<ActionResult, DomainError>>;

export interface WorkspaceCommands {
  beginDatasetImport: Command<BeginDatasetImportInput>;
  importDataset: Command<ImportDatasetInput>;
  failDatasetImport: Command<FailDatasetImportInput>;
  setActiveDataset: Command<SetActiveDatasetInput>;
  applyFilter: Command<ApplyFilterInput>;
  removeFilter: Command<RemoveFilterInput>;
  clearFilters: Command<ClearFiltersInput>;
  setTableSort: Command<SetTableSortInput>;
  createVisualization: Command<CreateVisualizationInput>;
  updateVisualization: Command<UpdateVisualizationInput>;
  removeVisualization: Command<RemoveVisualizationInput>;
  setSelection: Command<SetSelectionInput>;
  clearSelection: Command<ClearSelectionInput>;
  createMetric: Command<CreateMetricInput>;
  removeMetric: Command<RemoveMetricInput>;
  addAnnotation: Command<AddAnnotationInput>;
  removeAnnotation: Command<RemoveAnnotationInput>;
  updateLayout: Command<UpdateLayoutInput>;
}

/*
 * Human commands are attributed `actor: 'human'` and omit `expectedRevision`: the person issuing
 * them is looking at current state, so there is no earlier observation to assert against. Agent
 * writes, whose decisions may predate a human's edit, supply it.
 */
const humanCommands: WorkspaceCommands = {
  beginDatasetImport: (input) =>
    dispatcher.execute({ type: 'dataset.beginImport', payload: input }, { actor: 'human' }),
  importDataset: (input) => dispatcher.execute({ type: 'dataset.import', payload: input }, { actor: 'human' }),
  failDatasetImport: (input) => dispatcher.execute({ type: 'dataset.failImport', payload: input }, { actor: 'human' }),
  setActiveDataset: (input) => dispatcher.execute({ type: 'dataset.setActive', payload: input }, { actor: 'human' }),
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
  setSelection: (input) => dispatcher.execute({ type: 'selection.set', payload: input }, { actor: 'human' }),
  clearSelection: (input) => dispatcher.execute({ type: 'selection.clear', payload: input }, { actor: 'human' }),
  createMetric: (input) => dispatcher.execute({ type: 'metric.create', payload: input }, { actor: 'human' }),
  removeMetric: (input) => dispatcher.execute({ type: 'metric.remove', payload: input }, { actor: 'human' }),
  addAnnotation: (input) => dispatcher.execute({ type: 'annotation.add', payload: input }, { actor: 'human' }),
  removeAnnotation: (input) => dispatcher.execute({ type: 'annotation.remove', payload: input }, { actor: 'human' }),
  updateLayout: (input) => dispatcher.execute({ type: 'layout.update', payload: input }, { actor: 'human' }),
};

/**
 * The only mutation path available to React.
 *
 * Components call these commands and never `workspaceStore.setState`. Because the commands are the
 * same dispatcher calls the WebMCP adapter makes, a human click and an agent tool call reach
 * identical validation, revision, and history behaviour.
 *
 * The command object is a module-level constant, so the `useMemo` returns a stable reference and
 * commands are safe in dependency arrays.
 */
export const useActions = (): WorkspaceCommands => useMemo(() => humanCommands, []);
