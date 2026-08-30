import { useState } from 'react';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import { ColumnProfile } from '@/ui/dataset/column-profile.tsx';

interface DatasetSchemaPanelProps {
  dataset: Dataset | undefined;
}

/**
 * One glyph per logical type, standing in for the type badge.
 *
 * A badge per column turned a twenty-column list into twenty repetitions of the same few words, and
 * the type competed with the name for attention when the name is what a user scans for. A glyph
 * carries the same distinction at a glance; the word itself stays available in the tooltip.
 */
const TYPE_GLYPH: Readonly<Record<LogicalType, string>> = {
  number: '#',
  string: 'A',
  boolean: '◑',
  date: '◷',
  timestamp: '◷',
  category: '◆',
  unknown: '?',
};

/**
 * The full detail for one column, shown on hover rather than printed under every row.
 *
 * Physical name is included because the mapping from an arbitrary header to a generated identifier
 * is the identifier-safety guarantee made visible — it just does not need to be visible at all times.
 */
const columnDetail = (column: Column): string =>
  [
    `${column.name} · ${column.logicalType}`,
    column.databaseType === '' ? undefined : column.databaseType,
    column.nullable ? 'nullable' : 'not null',
    `stored as ${column.physicalName}`,
  ]
    .filter((part) => part !== undefined)
    .join('\n');

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
          <li key={column.id} className="schema__column" title={columnDetail(column)}>
            {/* The glyph is decoration over the type, which the adjacent label already states to
                assistive technology, so it is hidden rather than announced as a stray character. */}
            <span className="schema__glyph" data-logical-type={column.logicalType} aria-hidden="true">
              {TYPE_GLYPH[column.logicalType]}
            </span>
            <span className="schema__name">{column.name}</span>
            <span className="schema__type-label">{column.logicalType}</span>
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
