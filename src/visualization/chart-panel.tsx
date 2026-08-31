import { LuTrash2 } from 'react-icons/lu';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { QueryProgress, QuerySkeleton } from '@/ui/components/query-progress.tsx';
import { SamplingBadge } from '@/ui/components/sampling-badge.tsx';
import { Button } from '@/ui/components/ui/button.tsx';

const readTheme = (): ChartTheme => {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--dc-color-text').trim(),
    muted: styles.getPropertyValue('--dc-color-text-muted').trim(),
    border: styles.getPropertyValue('--dc-color-border').trim(),
    grid: styles.getPropertyValue('--chart-grid').trim(),
    axis: styles.getPropertyValue('--chart-axis').trim(),
    tooltipBackground: styles.getPropertyValue('--chart-tooltip').trim(),
    tooltipText: styles.getPropertyValue('--background').trim(),
    colors: [
      '--dc-color-accent',
      '--dc-color-chart-2',
      '--dc-color-chart-3',
      '--dc-color-chart-4',
      '--dc-color-chart-5',
      '--dc-color-chart-6',
      '--dc-color-chart-7',
      '--dc-color-chart-8',
      '--dc-color-chart-9',
      '--dc-color-chart-10',
    ].map((token) => styles.getPropertyValue(token).trim()),
  };
};

// Width bucket used to choose temporal granularity.
const PLOT_WIDTH_QUANTUM = 200;

// Quantized chart width used by the sampling policy.
const usePlotWidth = (ref: React.RefObject<HTMLDivElement | null>): number | undefined => {
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const element = ref.current;

    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;

      if (measured <= 0) return;

      const quantised = Math.max(Math.round(measured / PLOT_WIDTH_QUANTUM) * PLOT_WIDTH_QUANTUM, PLOT_WIDTH_QUANTUM);

      setWidth((current) => (current === quantised ? current : quantised));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return width;
};

const useThemeRevision = (): number => {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = (): void => setRevision((current) => current + 1);
    window.addEventListener('data-canvas:theme-change', update);
    return () => window.removeEventListener('data-canvas:theme-change', update);
  }, []);
  return revision;
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
  // Derive dependent arrays in useMemo; selectors must return stable references.
  const annotationRecord = useWorkspace((state) => state.workspace.annotations);
  const annotations = useMemo(
    () => Object.values(annotationRecord).filter((item) => item.visualizationId === visualization.id),
    [annotationRecord, visualization.id],
  );
  const selectionRecord = useWorkspace((state) => state.workspace.selections);
  // The selected visualization object is already a stable record reference.
  const selection = useMemo(
    () => Object.values(selectionRecord).find((item) => item.datasetId === visualization.datasetId),
    [selectionRecord, visualization.datasetId],
  );
  const workspace = useWorkspace((state) => state.workspace);
  const themeRevision = useThemeRevision();
  const propagated = propagateSelection(workspace, visualization);
  // Highlight mode dims marks; filter mode has already removed them from the result.
  const highlightPredicate = useMemo(() => {
    if (propagated.effect !== 'highlight' || propagated.predicate === undefined) return undefined;

    // Dimension keys carry column IDs used by selection predicates.
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
    [annotations, highlightPredicate, result, visualization, themeRevision],
  );
  const onClick = useCallback(
    (event: unknown) => {
      const clicked = event as { value?: unknown[]; name?: unknown };
      if (Array.isArray(clicked.value) && clicked.value.length >= 2) {
        setAnnotationAnchor({ kind: 'point', x: clicked.value[0], y: clicked.value[1] });
      }
      const predicate = categorySelectionFromClick(visualization, event as never);
      if (predicate === null) return;
      // Ctrl/cmd-click extends selection; plain click replaces it; clicking again clears it.
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
  resizeControls,
}: {
  visualization: Visualization;
  onError: (error: DomainError) => void;
  // Layout controls rendered in the chart header.
  resizeControls?: React.ReactNode;
}) => {
  const workspace = useWorkspace((state) => state.workspace);
  const actions = useActions();
  const [result, setResult] = useState<ChartResult | null>(null);
  const [error, setError] = useState<DomainError | null>(null);
  const [loading, setLoading] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const plotWidth = usePlotWidth(bodyRef);

  useEffect(() => {
    const controller = new AbortController();
    // Keep the previous result visible while the next query runs.
    setLoading(true);
    void executeVisualizationQuery(visualization, workspace, undefined, controller.signal, plotWidth).then((next) => {
      if (controller.signal.aborted) return;
      // Ignore superseded results so they cannot blank the chart.
      if (next.ok && next.value.stale === true) return;
      if (next.ok) {
        setResult(next.value);
        setError(null);
      } else setError(next.error);
      setLoading(false);
    });
    return () => {
      controller.abort();
    };
    // Quantize width changes so resizing triggers only a few re-queries.
  }, [visualization, workspace.filters, workspace.selections, workspace.revision, plotWidth]);

  const remove = async () => {
    const outcome = await actions.removeVisualization({ visualizationId: visualization.id });
    if (!outcome.ok) onError(outcome.error);
  };

  return (
    <article className="chart-panel">
      <header className="chart-panel__header">
        <h3>
          <span className="chart-panel__title">{visualization.title}</span>
          <Provenance entityId={visualization.id} createdBy={visualization.createdBy} />
        </h3>
        <div className="chart-panel__controls">
          <LinkModeControl visualizationId={visualization.id} linkMode={visualization.linkMode} onError={onError} />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${visualization.title}`}
            onClick={() => void remove()}
          >
            <LuTrash2 size={15} aria-hidden="true" />
          </Button>
          {resizeControls}
        </div>
      </header>
      {loading && result !== null ? <QueryProgress /> : null}
      {error === null ? null : (
        <div className="chart-panel__error" role="alert">
          <strong>{error.code}</strong> {error.message}
        </div>
      )}
      {result?.disclosure === undefined ? null : <SamplingBadge disclosure={result.disclosure} />}
      {/* The body provides chart height and supplies the measured plot width. */}
      <div ref={bodyRef} className="chart-panel__body">
        {result !== null && result.rows.length === 0 ? (
          <p className="chart-panel__empty">No data matches current filters.</p>
        ) : null}
        {loading && result === null && error === null ? <QuerySkeleton label={visualization.title} /> : null}
        {result === null || result.rows.length === 0 ? null : visualization.kind === 'kpi' ? (
          <div className="chart-panel__kpi">{formatValue(result.rows[0]?.at(-1))}</div>
        ) : visualization.kind === 'table' ? (
          <WorkspaceTable dataset={workspace.datasets[visualization.datasetId]!} />
        ) : (
          <EChart visualization={visualization} result={result} onError={onError} />
        )}
      </div>
    </article>
  );
};
