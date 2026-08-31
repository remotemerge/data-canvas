import { useEffect, useState } from 'react';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectFilters, selectRevision } from '@/state/selectors/workspace-selectors.ts';
import { deltaTone, formatNumber, formatValue } from '@/visualization/formatting.ts';
import { MetricEditor } from '@/ui/canvas/metric-editor.tsx';
import { Provenance } from '@/ui/workspace/provenance.tsx';

export const MetricCard = ({ metric, onError }: { metric: Metric; onError: (error: DomainError) => void }) => {
  const filterRecord = useWorkspace(selectFilters);
  const revision = useWorkspace(selectRevision);
  const [value, setValue] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // Ignore superseded responses so a slow earlier query cannot overwrite a newer value.
    let cancelled = false;
    const filters = metric.filters.flatMap((id) => {
      const filter = filterRecord[id];
      return filter === undefined || !filter.enabled
        ? []
        : [
            {
              kind: 'comparison' as const,
              columnId: filter.columnId,
              operator: filter.operator,
              ...(filter.value === undefined ? {} : { value: filter.value }),
            },
          ];
    });
    void registeredDataEngine
      .executeAnalysis({
        datasetId: metric.datasetId,
        dimensions: [],
        measures: [
          {
            aggregate: metric.aggregate,
            ...(metric.columnId === undefined ? {} : { columnId: metric.columnId }),
            alias: metric.name,
            ...(metric.modifier === undefined ? {} : { modifier: metric.modifier }),
          },
        ],
        filters,
        // Time comparisons return one row per period; the card shows the most recent. Other modifiers return one row.
        limit: metric.modifier?.kind === 'timeComparison' ? 200 : 1,
      })
      .then((result) => {
        if (cancelled || !result.ok) return;

        const rows = result.value.rows;

        setValue(
          metric.modifier?.kind === 'timeComparison' ? (rows[rows.length - 1]?.[2] ?? null) : (rows[0]?.[0] ?? null),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [metric, filterRecord, revision]);

  const tone = typeof value === 'number' ? deltaTone(value, metric.format) : 'neutral';

  return (
    <article className="metric-card">
      <span>{metric.name}</span>
      <Provenance entityId={metric.id} createdBy={metric.createdBy} />
      <strong className="metric-card__value" data-tone={tone}>
        {typeof value === 'number' ? formatNumber(value, metric.format) : formatValue(value)}
      </strong>
      <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}>
        {editing ? 'Done' : 'Edit'}
      </button>
      {editing ? <MetricEditor metric={metric} onError={(error) => error !== null && onError(error)} /> : null}
    </article>
  );
};
