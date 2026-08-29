import { useEffect, useState } from 'react';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { deltaTone, formatNumber, formatValue } from '@/visualization/formatting.ts';
import { MetricEditor } from '@/ui/canvas/metric-editor.tsx';
import { Provenance } from '@/ui/workspace/provenance.tsx';

export const MetricCard = ({ metric, onError }: { metric: Metric; onError: (error: DomainError) => void }) => {
  const workspace = useWorkspace((state) => state.workspace);
  const [value, setValue] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const filters = metric.filters.flatMap((id) => {
      const filter = workspace.filters[id];
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
        // A time comparison returns one row per period, and the card shows the most recent. The
        // other modifiers still collapse to a single row.
        limit: metric.modifier?.kind === 'timeComparison' ? 200 : 1,
      })
      .then((result) => {
        if (!result.ok) return;

        const rows = result.value.rows;

        setValue(
          metric.modifier?.kind === 'timeComparison' ? (rows[rows.length - 1]?.[2] ?? null) : (rows[0]?.[0] ?? null),
        );
      });
  }, [metric, workspace.filters, workspace.revision]);

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
