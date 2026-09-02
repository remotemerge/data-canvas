import { useEffect, useMemo, useRef } from 'react';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { selectVisualizations } from '@/state/selectors/workspace-selectors.ts';
import { ChartPanel } from '@/visualization/chart-panel.tsx';
import { MetricCard } from '@/ui/canvas/metric-card.tsx';
import { VisualizationBuilder } from '@/ui/canvas/visualization-builder.tsx';
import { Button } from '@/ui/components/ui/button.tsx';

export const WorkspaceCanvas = ({ onError }: { onError: (error: DomainError) => void }) => {
  const visualizationRecord = useWorkspace(selectVisualizations);
  const metricRecord = useWorkspace((state) => state.workspace.metrics);
  const layout = useWorkspace((state) => state.workspace.layout);
  const actions = useActions();
  const visualizations = useMemo(() => Object.values(visualizationRecord), [visualizationRecord]);
  const metrics = useMemo(() => Object.values(metricRecord), [metricRecord]);
  const layoutById = useMemo(() => new Map(layout.items.map((item) => [item.visualizationId, item])), [layout.items]);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  // IDs already on screen, so only a genuinely new chart scrolls the canvas.
  const seenIds = useRef<Set<string> | null>(null);

  /*
   * Bring a newly added chart into view. The canvas scrolls and new charts are appended below the
   * fold, so an agent-created chart otherwise lands outside the viewport with nothing indicating the
   * workspace changed. Scrolling on the first render would fight the initial paint, so the first pass
   * only records what was already present.
   */
  useEffect(() => {
    const ids = new Set(visualizations.map((visualization) => visualization.id));

    if (seenIds.current === null) {
      seenIds.current = ids;
      return;
    }

    const added = visualizations.find((visualization) => !seenIds.current?.has(visualization.id));
    seenIds.current = ids;

    if (added !== undefined) {
      itemRefs.current.get(added.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [visualizations]);

  const resize = async (visualizationId: string, amount: number) => {
    if (!layoutById.has(visualizationId)) {
      return;
    }
    const items = layout.items.map((item) =>
      item.visualizationId === visualizationId
        ? { ...item, width: Math.max(3, Math.min(layout.columns, item.width + amount)) }
        : item,
    );
    const result = await actions.updateLayout({ items });
    if (!result.ok) {
      onError(result.error);
    }
  };

  return (
    <>
      <VisualizationBuilder onError={onError} />
      {metrics.length === 0 ? null : (
        <div className="metric-grid">
          {metrics.map((metric) => (
            <MetricCard key={metric.id} metric={metric} onError={onError} />
          ))}
        </div>
      )}
      {visualizations.length === 0 ? (
        <div className="workspace__empty">
          <p className="workspace__empty-title">No views yet</p>
          <p>Use the builder above to add a chart.</p>
        </div>
      ) : (
        <div
          className="visualization-grid"
          style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}
        >
          {visualizations.map((visualization) => {
            const item = layoutById.get(visualization.id);
            return (
              <div
                key={visualization.id}
                ref={(element) => {
                  if (element === null) {
                    itemRefs.current.delete(visualization.id);
                  } else {
                    itemRefs.current.set(visualization.id, element);
                  }
                }}
                className="visualization-grid__item"
                /*
                 * Honor the stored column position so placement from `placeNewVisualization`, layout
                 * edits, and the layout WebMCP tool are visible. Rows keep auto-placement, which
                 * closes vertical gaps left by removed charts.
                 */
                style={{
                  gridColumn: item === undefined ? `span ${6}` : `${item.x + 1} / span ${item.width}`,
                  gridRow: `span ${item?.height ?? 4}`,
                }}
              >
                <ChartPanel
                  visualization={visualization}
                  onError={onError}
                  resizeControls={
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => void resize(visualization.id, -1)}
                        aria-label={`Make ${visualization.title} narrower`}
                      >
                        −
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => void resize(visualization.id, 1)}
                        aria-label={`Make ${visualization.title} wider`}
                      >
                        +
                      </Button>
                    </>
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
