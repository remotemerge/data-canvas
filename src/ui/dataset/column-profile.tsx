import { useEffect, useRef, useState } from 'react';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import { getColumnProfile } from '@/application/queries/column-statistics.ts';
import type { ColumnProfile as Profile } from '@/application/queries/column-statistics.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectFilters } from '@/state/selectors/workspace-selectors.ts';

// Formats a statistic for display without long decimals.
const formatNumber = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? '—' : String(Math.round(value * 1000) / 1000);

// Shows bounded aggregate statistics for a column.
export const ColumnProfile = ({ dataset, column }: { dataset: Dataset; column: Column }): React.JSX.Element => {
  /*
   * Profiling is an engine round trip, so it re-runs only for inputs that change the statistics.
   * The workspace stays in a ref because getColumnProfile reads it only to resolve the column.
   */
  const filterRecord = useWorkspace(selectFilters);
  const workspace = useWorkspace((state) => state.workspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setProfile(null);
    setFailed(false);

    void getColumnProfile(registeredDataEngine, workspaceRef.current, dataset.id, column.id).then((result) => {
      if (cancelled) return;

      if (result.ok) setProfile(result.value);
      else setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [filterRecord, dataset.id, dataset.revision, column.id]);

  if (failed) return <p className="column-profile__status">Statistics are unavailable for this column.</p>;
  if (profile === null) return <p className="column-profile__status">Profiling {column.name}…</p>;

  return (
    <dl className="column-profile">
      <dt>Type</dt>
      <dd>{profile.logicalType}</dd>
      <dt>Rows</dt>
      <dd>{profile.rowCount}</dd>
      <dt>Null values</dt>
      <dd>{profile.nullCount}</dd>
      <dt>Distinct</dt>
      <dd>
        {profile.distinctCount}
        {profile.distinctCountCapped ? '+' : ''}
      </dd>

      {profile.min === undefined ? null : (
        <>
          <dt>Min</dt>
          <dd>{formatNumber(profile.min)}</dd>
          <dt>Max</dt>
          <dd>{formatNumber(profile.max)}</dd>
          <dt>Mean</dt>
          <dd>{formatNumber(profile.mean)}</dd>
          <dt>Median</dt>
          <dd>{formatNumber(profile.median)}</dd>
          <dt>Standard deviation</dt>
          <dd>{formatNumber(profile.stddev)}</dd>
        </>
      )}

      {profile.topValues === undefined || profile.topValues.length === 0 ? null : (
        <>
          <dt>Most common</dt>
          <dd>
            <ul className="column-profile__values">
              {profile.topValues.map((entry, index) => (
                <li key={`${String(entry.value)}-${index}`}>
                  {/* Imported values render as text, never markup. */}
                  <span>{String(entry.value ?? '—')}</span> <small>{entry.count}</small>
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </dl>
  );
};
