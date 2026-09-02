import { useMemo, useState } from 'react';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectActiveDatasetId, selectDatasets } from '@/state/selectors/workspace-selectors.ts';

export const DatasetList = ({ onError }: { onError: (error: DomainError) => void }): React.JSX.Element => {
  const datasets = useWorkspace(selectDatasets);
  const activeDatasetId = useWorkspace(selectActiveDatasetId);
  const actions = useActions();
  const [pendingRemoval, setPendingRemoval] = useState<{ datasetId: EntityId; message: string } | null>(null);

  const datasetList = useMemo(() => Object.values(datasets), [datasets]);

  const select = async (dataset: Dataset): Promise<void> => {
    const result = await actions.setActiveDataset({ datasetId: dataset.id });
    if (!result.ok) {
      onError(result.error);
    }
  };

  const remove = async (dataset: Dataset, cascade: boolean): Promise<void> => {
    const result = await actions.removeDataset({ datasetId: dataset.id, ...(cascade ? { cascade: true } : {}) });

    if (result.ok) {
      setPendingRemoval(null);
      return;
    }

    // DATASET_IN_USE provides the dependent count used by the confirmation prompt.
    if (result.error.code === 'DATASET_IN_USE') {
      setPendingRemoval({ datasetId: dataset.id, message: result.error.message });
      return;
    }

    setPendingRemoval(null);
    onError(result.error);
  };

  if (datasetList.length === 0) {
    return <p className="workspace__empty">No datasets yet.</p>;
  }

  return (
    <ul className="dataset-list">
      {datasetList.map((dataset) => (
        <li
          key={dataset.id}
          className="dataset-list__item"
          data-active={dataset.id === activeDatasetId ? 'true' : undefined}
        >
          <button
            type="button"
            className="dataset-list__select"
            aria-pressed={dataset.id === activeDatasetId}
            disabled={dataset.importStatus !== 'ready'}
            onClick={() => void select(dataset)}
          >
            {/* Dataset names are untrusted text. */}
            <span className="dataset-list__name">{dataset.name}</span>
            <span className="dataset-list__rows">
              {dataset.rowCount === null ? '—' : `${dataset.rowCount.toLocaleString()} rows`}
            </span>
          </button>

          <span className="dataset-list__status" data-status={dataset.importStatus}>
            {dataset.importStatus}
          </span>

          <button
            type="button"
            className="dataset-list__remove"
            aria-label={`Remove dataset ${dataset.name}`}
            onClick={() => void remove(dataset, pendingRemoval?.datasetId === dataset.id)}
          >
            {pendingRemoval?.datasetId === dataset.id ? 'Confirm' : 'Remove'}
          </button>

          {pendingRemoval?.datasetId === dataset.id ? (
            <p className="dataset-list__warning" role="alert">
              {pendingRemoval.message}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
};
