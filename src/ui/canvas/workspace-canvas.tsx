import { useMemo } from 'react';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { ChartPanel } from '@/visualization/chart-panel.tsx';
import { MetricCard } from '@/ui/canvas/metric-card.tsx';
import { VisualizationBuilder } from '@/ui/canvas/visualization-builder.tsx';

export const WorkspaceCanvas = ({ onError }: { onError: (error: DomainError) => void }) => {
  const workspace = useWorkspace((state) => state.workspace);
  const actions = useActions();
  const visualizations = useMemo(() => Object.values(workspace.visualizations), [workspace.visualizations]);
  const metrics = useMemo(() => Object.values(workspace.metrics), [workspace.metrics]);
  const layoutById = useMemo(
    () => new Map(workspace.layout.items.map((item) => [item.visualizationId, item])),
    [workspace.layout.items],
  );

  const resize = async (visualizationId: string, amount: number) => {
    const current = layoutById.get(visualizationId);
    if (current === undefined) return;
    const items = workspace.layout.items.map((item) =>
      item.visualizationId === visualizationId
        ? { ...item, width: Math.max(3, Math.min(workspace.layout.columns, item.width + amount)) }
        : item,
    );
    const result = await actions.updateLayout({ items });
    if (!result.ok) onError(result.error);
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
          style={{ gridTemplateColumns: `repeat(${workspace.layout.columns}, minmax(0, 1fr))` }}
        >
          {visualizations.map((visualization) => {
            const item = layoutById.get(visualization.id);
            return (
              <div
                key={visualization.id}
                className="visualization-grid__item"
                style={{ gridColumn: `span ${item?.width ?? 6}`, gridRow: `span ${item?.height ?? 4}` }}
              >
                <div className="visualization-grid__size">
                  <button
                    type="button"
                    onClick={() => void resize(visualization.id, -1)}
                    aria-label={`Make ${visualization.title} narrower`}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => void resize(visualization.id, 1)}
                    aria-label={`Make ${visualization.title} wider`}
                  >
                    +
                  </button>
                </div>
                <ChartPanel visualization={visualization} onError={onError} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
