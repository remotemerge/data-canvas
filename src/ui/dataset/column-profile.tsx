import { useEffect, useState } from 'react';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import { getColumnProfile } from '@/application/queries/column-statistics.ts';
import type { ColumnProfile as Profile } from '@/application/queries/column-statistics.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { useWorkspace } from '@/state/use-workspace.ts';

/** Formats a statistic for display, keeping long decimals from overflowing the panel. */
const formatNumber = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? '—' : String(Math.round(value * 1000) / 1000);

/**
 * Shows a column's statistical profile.
 *
 * The values come from aggregates in DuckDB rather than from any row read into JavaScript, so the
 * cost is the same whether the dataset has a thousand rows or ten million. Frequent values are
 * dataset content and are rendered as plain text.
 */
export const ColumnProfile = ({ dataset, column }: { dataset: Dataset; column: Column }): React.JSX.Element => {
  const workspace = useWorkspace((state) => state.workspace);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setProfile(null);
    setFailed(false);

    void getColumnProfile(registeredDataEngine, workspace, dataset.id, column.id).then((result) => {
      if (cancelled) return;

      if (result.ok) setProfile(result.value);
      else setFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [workspace, dataset.id, column.id]);

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
                  {/* Rendered as text content, never as markup: these are imported cell values. */}
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
