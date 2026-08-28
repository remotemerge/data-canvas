import { useEffect, useState } from 'react';
import { fetchPreview } from '@/application/queries/preview-query.ts';
import type { TableWindow } from '@/application/ports/data-engine-port.ts';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { PREVIEW_ROW_LIMIT } from '@/data/import/import-limits.ts';

interface DatasetPreviewTableProps {
  dataset: Dataset | undefined;
}

/**
 * Renders the first rows of an imported dataset.
 *
 * A plain HTML table on purpose. Its job is to prove the data path end to end — DuckDB to domain
 * metadata to DOM — without also taking on virtualization, windowed scrolling, or column sizing.
 * The virtualized TanStack table replaces this wholesale later; keeping the two concerns apart
 * makes that a contained swap rather than a rewrite.
 *
 * XSS constraint. Every cell renders as a text child. A value of `<img src=x onerror=alert(1)>`
 * must display literally, so nothing here may become `dangerouslySetInnerHTML`.
 */
export const DatasetPreviewTable = ({ dataset }: DatasetPreviewTableProps): React.JSX.Element | null => {
  const [window, setWindow] = useState<TableWindow | null>(null);
  const [failed, setFailed] = useState(false);

  const datasetId = dataset?.id;
  const isReady = dataset?.importStatus === 'ready';

  // Re-fetches when the dataset's revision moves, which is how a re-import or a later filter change
  // invalidates the preview without the component knowing why the data changed.
  const revision = dataset?.revision;

  useEffect(() => {
    if (datasetId === undefined || !isReady) {
      setWindow(null);

      return;
    }

    const controller = new AbortController();

    setFailed(false);

    void fetchPreview(registeredDataEngine, datasetId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;

      // A superseded read is discarded rather than rendered: the newer request will deliver the
      // window this view should show.
      if (result.ok && result.value.stale) return;

      if (result.ok) setWindow(result.value);
      else setFailed(true);
    });

    return () => controller.abort();
  }, [datasetId, isReady, revision]);

  if (dataset === undefined || !isReady) return null;

  if (failed) return <p className="workspace__empty">The preview could not be loaded.</p>;

  if (window === null) return <p className="workspace__empty">Loading preview…</p>;

  return (
    <div className="preview">
      <p className="preview__caption">
        First {Math.min(window.rows.length, PREVIEW_ROW_LIMIT)} of{' '}
        {dataset.rowCount === null ? 'unknown' : dataset.rowCount.toLocaleString()} rows
      </p>

      <div className="preview__scroll">
        <table className="preview__table">
          <thead>
            <tr>
              {dataset.columns.map((column) => (
                <th key={column.id} scope="col">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {window.rows.map((row, rowIndex) => (
              // Row position is the only identity a positional window has; rows carry no key column.
              <tr key={`${window.offset + rowIndex}`}>
                {dataset.columns.map((column, columnIndex) => (
                  <td key={column.id}>{row[columnIndex] === null ? '' : String(row[columnIndex])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
