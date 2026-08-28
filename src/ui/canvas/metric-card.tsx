import { useEffect, useState } from 'react';
import { registeredDataEngine } from '@/application/ports/engine-registry.ts';
import type { Metric } from '@/domain/metric/metric.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { formatNumber, formatValue } from '@/visualization/formatting.ts';

export const MetricCard = ({ metric }: { metric: Metric }) => {
  const workspace = useWorkspace((state) => state.workspace);
  const [value, setValue] = useState<unknown>(null);
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
          },
        ],
        filters,
        limit: 1,
      })
      .then((result) => {
        if (result.ok) setValue(result.value.rows[0]?.[0] ?? null);
      });
  }, [metric, workspace.filters, workspace.revision]);
  return (
    <article className="metric-card">
      <span>{metric.name}</span>
      <strong>{typeof value === 'number' ? formatNumber(value, metric.format) : formatValue(value)}</strong>
    </article>
  );
};
