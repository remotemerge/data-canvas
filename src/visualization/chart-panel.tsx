import { LuPencil, LuTrash2 } from 'react-icons/lu';
import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { executeVisualizationQuery, type ChartResult } from '@/application/queries/visualization-query.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { WorkspaceTable } from '@/table/tanstack/workspace-table.tsx';
import { formatValue } from '@/visualization/formatting.ts';
import { LinkModeControl } from '@/ui/canvas/link-mode-control.tsx';
import { Provenance } from '@/ui/workspace/provenance.tsx';
import { QueryProgress, QuerySkeleton } from '@/ui/components/query-progress.tsx';
import { SamplingBadge } from '@/ui/components/sampling-badge.tsx';
import { VisualizationEditor } from '@/ui/canvas/visualization-editor.tsx';
import { Button } from '@/ui/components/ui/button.tsx';

// ECharts is a large dependency that only chart kinds need, so it loads on first chart render.
const EChart = lazy(() => import('@/visualization/echart-view.tsx'));

class ChartErrorBoundary extends Component<
  { children: ReactNode; onError: (error: unknown, errorInfo: ErrorInfo) => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    this.props.onError(error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="chart-panel__error" role="alert">
          This chart could not be rendered. Remove it or change its configuration.
        </div>
      );
    }

    return this.props.children;
  }
}

// Width bucket used to choose temporal granularity.
const PLOT_WIDTH_QUANTUM = 200;

// Quantized chart width used by the sampling policy.
const usePlotWidth = (ref: React.RefObject<HTMLDivElement | null>): number | undefined => {
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const element = ref.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;

      if (measured <= 0) {
        return;
      }

      const quantised = Math.max(Math.round(measured / PLOT_WIDTH_QUANTUM) * PLOT_WIDTH_QUANTUM, PLOT_WIDTH_QUANTUM);

      setWidth((current) => (current === quantised ? current : quantised));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return width;
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
  const [editing, setEditing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const plotWidth = usePlotWidth(bodyRef);

  useEffect(() => {
    const controller = new AbortController();
    // Keep the previous result visible while the next query runs.
    setLoading(true);
    void executeVisualizationQuery(visualization, workspace, undefined, controller.signal, plotWidth).then((next) => {
      if (controller.signal.aborted) {
        return;
      }
      // Ignore superseded results so they cannot blank the chart.
      if (next.ok && next.value.stale === true) {
        return;
      }
      if (next.ok) {
        setResult(next.value);
        setError(null);
      } else {
        setError(next.error);
      }
      setLoading(false);
    });
    return () => {
      controller.abort();
    };
    /*
     * Depend on the workspace slices the query actually reads rather than on `revision`, which every
     * committed action bumps. Results are not cached, so a `revision` dependency re-runs the SQL for
     * every chart on annotation edits, layout drags, and other unrelated actions.
     *
     * Width changes are quantized upstream so resizing triggers only a few re-queries.
     */
  }, [
    visualization,
    workspace.filters,
    workspace.selections,
    workspace.relationships,
    workspace.derivedColumns,
    plotWidth,
  ]);

  const remove = async () => {
    const outcome = await actions.removeVisualization({ visualizationId: visualization.id });
    if (!outcome.ok) {
      onError(outcome.error);
    }
  };

  // KPI and table views render their own presentation; every other kind goes through ECharts.
  const renderBody = (): React.ReactNode => {
    if (result === null || result.rows.length === 0) {
      return null;
    }

    if (visualization.kind === 'kpi') {
      return <div className="chart-panel__kpi">{formatValue(result.rows[0]?.at(-1))}</div>;
    }

    if (visualization.kind === 'table') {
      return <WorkspaceTable dataset={workspace.datasets[visualization.datasetId]!} />;
    }

    return (
      <ChartErrorBoundary
        key={`${visualization.id}:${workspace.revision}`}
        onError={() => {
          onError({
            code: 'UNSUPPORTED_OPERATION',
            message: 'A chart failed to render. Its workspace card remains available for recovery.',
          });
        }}
      >
        <Suspense fallback={<QuerySkeleton label={visualization.title} />}>
          <EChart visualization={visualization} result={result} onError={onError} />
        </Suspense>
      </ChartErrorBoundary>
    );
  };

  return (
    <article className="chart-panel">
      <header className="chart-panel__header">
        <h3>
          {/* The header truncates a long title, so the full text stays available on hover. */}
          <span className="chart-panel__title" title={visualization.title}>
            {visualization.title}
          </span>
          <Provenance entityId={visualization.id} createdBy={visualization.createdBy} />
        </h3>
        <div className="chart-panel__controls">
          <LinkModeControl visualizationId={visualization.id} linkMode={visualization.linkMode} onError={onError} />
          {/* Table views render dataset rows directly, so they have no binding to rebind. */}
          {visualization.kind === 'table' ? null : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${visualization.title}`}
              aria-expanded={editing}
              onClick={() => setEditing(!editing)}
            >
              <LuPencil size={15} aria-hidden="true" />
            </Button>
          )}
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
      {editing ? (
        <VisualizationEditor visualization={visualization} onError={onError} onDone={() => setEditing(false)} />
      ) : null}
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
        {renderBody()}
      </div>
    </article>
  );
};
