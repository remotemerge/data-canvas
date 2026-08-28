import { useCallback, useEffect, useMemo, useState } from 'react';
import { executeVisualizationQuery, type ChartResult } from '@/application/queries/visualization-query.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { WorkspaceTable } from '@/table/tanstack/workspace-table.tsx';
import { buildEChartsOption, type ChartTheme } from '@/visualization/echarts/build-echarts-option.ts';
import { useECharts } from '@/visualization/echarts/use-echarts.ts';
import { formatValue } from '@/visualization/formatting.ts';
import {
  categorySelectionFromClick,
  isSameSelection,
  rangeSelection,
} from '@/visualization/interaction/chart-events.ts';

const readTheme = (): ChartTheme => {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--dc-color-text').trim(),
    muted: styles.getPropertyValue('--dc-color-text-muted').trim(),
    border: styles.getPropertyValue('--dc-color-border').trim(),
    colors: ['--dc-color-accent', '--dc-color-chart-2', '--dc-color-chart-3', '--dc-color-chart-4'].map((token) =>
      styles.getPropertyValue(token).trim(),
    ),
  };
};

const EChart = ({ visualization, result }: { visualization: Visualization; result: ChartResult }) => {
  const actions = useActions();
  const selection = useWorkspace((state) =>
    Object.values(state.workspace.selections).find((item) => item.datasetId === visualization.datasetId),
  );
  const option = useMemo(() => buildEChartsOption(visualization, result, readTheme()), [result, visualization]);
  const onClick = useCallback(
    (event: unknown) => {
      const predicate = categorySelectionFromClick(visualization, event as never);
      if (predicate === null) return;
      if (isSameSelection(selection?.predicate, predicate))
        void actions.clearSelection({ datasetId: visualization.datasetId });
      else
        void actions.setSelection({
          datasetId: visualization.datasetId,
          mode: 'predicate',
          predicate,
          origin: 'chart',
        });
    },
    [actions, selection?.predicate, visualization],
  );
  const onBrush = useCallback(
    (event: unknown) => {
      const areas = (event as { areas?: { coordRange?: unknown[] }[] }).areas;
      if (areas?.length === 0) {
        void actions.clearSelection({ datasetId: visualization.datasetId });
        return;
      }
      const range = areas?.[0]?.coordRange;
      const columnId = visualization.binding.x;
      if (columnId === undefined || range === undefined || range.length < 2) return;
      const start = Number(range[0]);
      const end = Number(range[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      void actions.setSelection({
        datasetId: visualization.datasetId,
        mode: 'predicate',
        predicate: rangeSelection(columnId, start, end),
        origin: 'chart',
      });
    },
    [actions, visualization.binding.x, visualization.datasetId],
  );
  const ref = useECharts(option, visualization.kind, onClick, onBrush);
  return <div ref={ref} className="chart-panel__chart" role="img" aria-label={visualization.title} />;
};

export const ChartPanel = ({
  visualization,
  onError,
}: {
  visualization: Visualization;
  onError: (error: DomainError) => void;
}) => {
  const workspace = useWorkspace((state) => state.workspace);
  const actions = useActions();
  const [result, setResult] = useState<ChartResult | null>(null);
  const [error, setError] = useState<DomainError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void executeVisualizationQuery(visualization, workspace).then((next) => {
      if (!current) return;
      if (next.ok) {
        setResult(next.value);
        setError(null);
      } else setError(next.error);
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [visualization, workspace.filters, workspace.selections, workspace.revision]);

  const remove = async () => {
    const outcome = await actions.removeVisualization({ visualizationId: visualization.id });
    if (!outcome.ok) onError(outcome.error);
  };
  const toggleLinked = async () => {
    const outcome = await actions.updateVisualization({
      visualizationId: visualization.id,
      linkedSelection: !visualization.linkedSelection,
    });
    if (!outcome.ok) onError(outcome.error);
  };

  return (
    <article className="chart-panel">
      <header className="chart-panel__header">
        <h3>{visualization.title}</h3>
        <div className="chart-panel__controls">
          <button type="button" aria-pressed={visualization.linkedSelection} onClick={() => void toggleLinked()}>
            Link
          </button>
          <button type="button" onClick={() => void remove()}>
            Remove
          </button>
        </div>
      </header>
      {loading ? (
        <span className="chart-panel__loading" role="status">
          Updating
        </span>
      ) : null}
      {error === null ? null : (
        <div className="chart-panel__error" role="alert">
          <strong>{error.code}</strong> {error.message}
        </div>
      )}
      {result?.sampled ? (
        <span className="chart-panel__badge">Showing top {result.rows.length.toLocaleString()} points</span>
      ) : null}
      {result !== null && result.rows.length === 0 ? (
        <p className="chart-panel__empty">No data matches current filters.</p>
      ) : null}
      {result === null || result.rows.length === 0 ? null : visualization.kind === 'kpi' ? (
        <div className="chart-panel__kpi">{formatValue(result.rows[0]?.at(-1))}</div>
      ) : visualization.kind === 'table' ? (
        <WorkspaceTable dataset={workspace.datasets[visualization.datasetId]!} />
      ) : (
        <EChart visualization={visualization} result={result} />
      )}
    </article>
  );
};
