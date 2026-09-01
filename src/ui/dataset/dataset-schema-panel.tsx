import { useState } from 'react';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import { ColumnProfile } from '@/ui/dataset/column-profile.tsx';

interface DatasetSchemaPanelProps {
  dataset: Dataset | undefined;
}

// Returns the glyph used for a logical type.
const TYPE_GLYPH: Readonly<Record<LogicalType, string>> = {
  number: '#',
  string: 'A',
  boolean: '◑',
  date: '◷',
  timestamp: '◷',
  category: '◆',
  unknown: '?',
};

// Tooltip content for one column, including its physical name.
const columnDetail = (column: Column): string =>
  [
    `${column.name} · ${column.logicalType}`,
    column.databaseType === '' ? undefined : column.databaseType,
    column.nullable ? 'nullable' : 'not null',
    `stored as ${column.physicalName}`,
  ]
    .filter((part) => part !== undefined)
    .join('\n');

// Lists a dataset's columns and their physical names.
export const DatasetSchemaPanel = ({ dataset }: DatasetSchemaPanelProps): React.JSX.Element => {
  // Load one profile at a time to avoid a burst of queries.
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
            {/* The text label already conveys the type to assistive technology. */}
            <span className="schema__glyph" data-logical-type={column.logicalType} aria-hidden="true">
              {TYPE_GLYPH[column.logicalType]}
            </span>
            <span className="schema__name">{column.name}</span>
            <span className="schema__type-label">{column.logicalType}</span>
            <button
              type="button"
              className="schema__profile-toggle"
              aria-label={`${profiledColumnId === column.id ? 'Hide' : 'Show'} statistics for ${column.name}`}
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
