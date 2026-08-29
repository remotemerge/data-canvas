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
import { measureSync } from '@/shared/perf/performance-marks.ts';
import {
  categorySelectionFromClick,
  isAdditiveClick,
  isSameSelection,
  rangeSelection,
  rowMatchesPredicate,
} from '@/visualization/interaction/chart-events.ts';
import { propagateSelection } from '@/application/selection/propagate-selection.ts';
import { LinkModeControl } from '@/ui/canvas/link-mode-control.tsx';
import type { AnnotationAnchor } from '@/domain/annotation/annotation.ts';
import { AnnotationEditor } from '@/ui/canvas/annotation-editor.tsx';
import { Provenance } from '@/ui/workspace/provenance.tsx';

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

const EChart = ({
  visualization,
  result,
  onError,
}: {
  visualization: Visualization;
  result: ChartResult;
  onError: (error: DomainError) => void;
}) => {
  const actions = useActions();
  const [annotationAnchor, setAnnotationAnchor] = useState<AnnotationAnchor | null>(null);
  const annotations = useWorkspace((state) =>
    Object.values(state.workspace.annotations).filter((item) => item.visualizationId === visualization.id),
  );
  const selection = useWorkspace((state) =>
    Object.values(state.workspace.selections).find((item) => item.datasetId === visualization.datasetId),
  );
  const workspace = useWorkspace((state) => state.workspace);
  const propagated = propagateSelection(workspace, visualization);
  // Only `highlight` dims here. `filter` already removed the excluded rows from `result`, so dimming
  // as well would fade every remaining mark.
  const highlightPredicate = useMemo(() => {
    if (propagated.effect !== 'highlight' || propagated.predicate === undefined) return undefined;

    // `key` carries the column ID for dimension columns, which is what a selection predicate
    // references; measure columns key on their alias and simply never match.
    const columnIndexById = new Map(result.columns.map((column, index) => [column.key, index]));
    const predicate = propagated.predicate;

    return (rowIndex: number): boolean => {
      const row = result.rows[rowIndex];

      return row === undefined ? true : rowMatchesPredicate(predicate, row, columnIndexById);
    };
  }, [propagated.effect, propagated.predicate, result]);
  const option = useMemo(
    () =>
      measureSync('chart-conversion', () =>
        buildEChartsOption(visualization, result, readTheme(), annotations, highlightPredicate),
      ),
    [annotations, highlightPredicate, result, visualization],
  );
  const onClick = useCallback(
    (event: unknown) => {
      const clicked = event as { value?: unknown[]; name?: unknown };
      if (Array.isArray(clicked.value) && clicked.value.length >= 2) {
        setAnnotationAnchor({ kind: 'point', x: clicked.value[0], y: clicked.value[1] });
      }
      const predicate = categorySelectionFromClick(visualization, event as never);
      if (predicate === null) return;
      // Ctrl/cmd-click adds to the selection; a plain click replaces it, and clicking the current
      // selection again clears it.
      if (isAdditiveClick(clicked as { event?: { ctrlKey?: boolean; metaKey?: boolean } })) {
        void actions.extendSelection({
          datasetId: visualization.datasetId,
          mode: 'predicate',
          predicate,
          origin: 'chart',
        });
        return;
      }
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
  return (
    <>
      <div ref={ref} className="chart-panel__chart" role="img" aria-label={visualization.title} />
      {annotationAnchor === null ? null : (
        <AnnotationEditor
          visualizationId={visualization.id}
          anchor={annotationAnchor}
          onClose={() => setAnnotationAnchor(null)}
          onError={onError}
        />
      )}
    </>
  );
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

  return (
    <article className="chart-panel">
      <header className="chart-panel__header">
        <h3>
          {visualization.title}
          <Provenance entityId={visualization.id} createdBy={visualization.createdBy} />
        </h3>
        <div className="chart-panel__controls">
          <LinkModeControl visualizationId={visualization.id} linkMode={visualization.linkMode} onError={onError} />
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
        <EChart visualization={visualization} result={result} onError={onError} />
      )}
    </article>
  );
};
