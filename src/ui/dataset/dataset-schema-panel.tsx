import { useState } from 'react';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import { ColumnProfile } from '@/ui/dataset/column-profile.tsx';

interface DatasetSchemaPanelProps {
  dataset: Dataset | undefined;
}

/**
 * Lists a dataset's columns.
 *
 * XSS constraint. `column.name` is the file's own header text and is therefore untrusted. It
 * renders as a text child, never as HTML — a header of `<img src=x onerror=alert(1)>` must appear
 * literally.
 *
 * Display name and physical name are both shown. Seeing that a header of `Q4 Sales!` maps to `c3`
 * is how the identifier-safety guarantee becomes visible rather than merely documented.
 */
export const DatasetSchemaPanel = ({ dataset }: DatasetSchemaPanelProps): React.JSX.Element => {
  // One profile at a time. Each is a query, so expanding every column at once would fire a burst of
  // them for a result the user is not looking at.
  const [profiledColumnId, setProfiledColumnId] = useState<string | null>(null);

  if (dataset === undefined) {
    return <p className="workspace__empty">Import a file to see its schema.</p>;
  }

  if (dataset.importStatus === 'loading') {
    return <p className="workspace__empty">Reading schema…</p>;
  }

  if (dataset.importStatus === 'error') {
    return <p className="workspace__empty">This dataset failed to import.</p>;
  }

  return (
    <div className="schema">
      <p className="schema__summary">
        {dataset.columns.length} columns · {dataset.rowCount === null ? 'unknown' : dataset.rowCount.toLocaleString()}{' '}
        rows
      </p>

      <ul className="schema__list">
        {dataset.columns.map((column) => (
          <li key={column.id} className="schema__column">
            <span className="schema__name" title={column.databaseType}>
              {column.name}
            </span>
            <span className="schema__type" data-logical-type={column.logicalType}>
              {column.logicalType}
            </span>
            {column.nullable ? <span className="schema__nullable">nullable</span> : null}
            <span className="schema__physical">{column.physicalName}</span>
            <button
              type="button"
              className="schema__profile-toggle"
              aria-expanded={profiledColumnId === column.id}
              onClick={() => setProfiledColumnId(profiledColumnId === column.id ? null : column.id)}
            >
              {profiledColumnId === column.id ? 'Hide stats' : 'Stats'}
            </button>
            {profiledColumnId === column.id ? <ColumnProfile dataset={dataset} column={column} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
};
