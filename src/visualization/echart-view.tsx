import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChartResult } from '@/application/queries/visualization-query.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { useActions } from '@/state/use-actions.ts';
import { useWorkspace } from '@/state/use-workspace.ts';
import { buildEChartsOption, type ChartTheme } from '@/visualization/echarts/build-echarts-option.ts';
import { useECharts } from '@/visualization/echarts/use-echarts.ts';
import { measureSync } from '@/shared/perf/performance-marks.ts';
import {
  categorySelectionFromClick,
  isAdditiveClick,
  isSameSelection,
  rangeSelection,
  rowMatchesPredicate,
} from '@/visualization/interaction/chart-events.ts';
import { propagateSelection } from '@/application/selection/propagate-selection.ts';
import type { AnnotationAnchor } from '@/domain/annotation/annotation.ts';
import { AnnotationEditor } from '@/ui/canvas/annotation-editor.tsx';

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

const useThemeRevision = (): number => {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = (): void => setRevision((current) => current + 1);
    window.addEventListener('data-canvas:theme-change', update);
    return () => window.removeEventListener('data-canvas:theme-change', update);
  }, []);
  return revision;
};

/*
 * Chart renderer split into its own chunk. ECharts is only needed once a chart exists,
 * so the workspace shell loads without it.
 */
export const EChart = ({
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
    if (propagated.effect !== 'highlight' || propagated.predicate === undefined) {
      return undefined;
    }

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
      if (predicate === null) {
        return;
      }
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
      if (isSameSelection(selection?.predicate, predicate)) {
        void actions.clearSelection({ datasetId: visualization.datasetId });
      } else {
        void actions.setSelection({
          datasetId: visualization.datasetId,
          mode: 'predicate',
          predicate,
          origin: 'chart',
        });
      }
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
      if (columnId === undefined || range === undefined || range.length < 2) {
        return;
      }
      const start = Number(range[0]);
      const end = Number(range[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return;
      }
      void actions.setSelection({
        datasetId: visualization.datasetId,
        mode: 'predicate',
        predicate: rangeSelection(columnId, start, end),
        origin: 'chart',
      });
    },
    [actions, visualization.binding.x, visualization.datasetId],
  );
  const ref = useECharts(option, onClick, onBrush);
  return (
    <>
      <div
        ref={ref}
        className="chart-panel__chart"
        role="img"
        aria-label={`${visualization.title}. Select a chart mark to add an annotation.`}
      />
      {annotations.length === 0 ? null : (
        <section className="annotation-list" aria-label={`Annotations for ${visualization.title}`}>
          <h4>Annotations</h4>
          <ul>
            {annotations.map((annotation) => (
              <li key={annotation.id}>
                <span>{annotation.text}</span>
                <button
                  type="button"
                  aria-label={`Remove annotation: ${annotation.text}`}
                  onClick={() => void actions.removeAnnotation({ annotationId: annotation.id })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
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

export default EChart;
