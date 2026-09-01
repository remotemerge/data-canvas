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
    const filters = Object.values(filterRecord).flatMap((filter) => {
      return filter.datasetId !== metric.datasetId || !filter.enabled
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
        ...(metric.modifier?.kind === 'timeComparison'
          ? {
              binnedDimensions: [
                {
                  columnId: metric.modifier.dateColumnId,
                  strategy: { kind: 'temporal' as const, unit: metric.modifier.unit },
                },
              ],
            }
          : {}),
        measures: [
          {
            aggregate: metric.aggregate,
            ...(metric.columnId === undefined ? {} : { columnId: metric.columnId }),
            alias: metric.name,
            ...(metric.modifier === undefined || metric.modifier.kind === 'timeComparison'
              ? {}
              : { modifier: metric.modifier }),
          },
        ],
        filters,
        // Fetch every temporal bucket so the card can compare the latest value
        // with the configured prior period.
        limit: metric.modifier?.kind === 'timeComparison' ? 200 : 1,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setValue(null);
          onError(result.error);
          return;
        }

        const rows = result.value.rows;
        if (metric.modifier?.kind === 'timeComparison') {
          // The query returns [period, value] rows, so calculate the requested comparison here.
          const ordered = rows.toSorted((left, right) => String(left[0]).localeCompare(String(right[0])));
          const current = Number(ordered.at(-1)?.[1]);
          const prior = Number(ordered.at(-(metric.modifier.offset + 1))?.[1]);
          if (!Number.isFinite(current) || !Number.isFinite(prior)) {
            setValue(null);
            return;
          }
          setValue(
            metric.modifier.as === 'absolute'
              ? prior
              : metric.modifier.as === 'difference'
                ? current - prior
                : prior === 0
                  ? null
                  : (current - prior) / prior,
          );
          return;
        }

        setValue(rows[0]?.[0] ?? null);
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
