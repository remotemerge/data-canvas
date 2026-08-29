import type { EChartsCoreOption } from 'echarts/core';
import type { ChartResult } from '@/application/queries/visualization-query.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { escapeText } from '@/visualization/formatting.ts';
import { buildAreaSeries } from '@/visualization/echarts/kinds/area.ts';
import { buildBarSeries } from '@/visualization/echarts/kinds/bar.ts';
import { buildDonutSeries } from '@/visualization/echarts/kinds/donut.ts';
import { buildLineSeries } from '@/visualization/echarts/kinds/line.ts';
import { buildScatterSeries } from '@/visualization/echarts/kinds/scatter.ts';
import { buildBoxplotSeries } from '@/visualization/echarts/kinds/boxplot.ts';
import { buildHeatmapSeries } from '@/visualization/echarts/kinds/heatmap.ts';
import { buildHistogramSeries } from '@/visualization/echarts/kinds/histogram.ts';
import type { Annotation } from '@/domain/annotation/annotation.ts';
import { buildAnnotationMarks } from '@/visualization/annotations/annotation-marks.ts';

export interface ChartTheme {
  text: string;
  muted: string;
  border: string;
  colors: string[];
}

const columnNames = (result: ChartResult): string[] => result.columns.map((column) => column.name);

/** Opacity applied to a mark outside the selection. Dimmed, not hidden: the context is the point. */
const DIMMED_OPACITY = 0.25;

/**
 * Per-mark opacity for `highlight` mode.
 *
 * Returned as an ECharts `itemStyle` callback so dimming costs one predicate evaluation per mark at
 * render time and no re-query. Absent when nothing is selected, so an unselected chart carries no
 * per-item callback at all.
 */
const highlightStyle = (
  highlight: HighlightPredicate | undefined,
): { itemStyle: { opacity: (params: { dataIndex: number }) => number } } | undefined => {
  if (highlight === undefined) return undefined;

  return {
    itemStyle: {
      opacity: (params: { dataIndex: number }) => (highlight(params.dataIndex) ? 1 : DIMMED_OPACITY),
    },
  };
};

/** Decides whether the row at an index is inside the selection. */
export type HighlightPredicate = (rowIndex: number) => boolean;

export const buildEChartsOption = (
  visualization: Visualization,
  result: ChartResult,
  theme: ChartTheme,
  annotations: readonly Annotation[] = [],
  highlight?: HighlightPredicate,
): EChartsCoreOption => {
  const emphasis = highlightStyle(highlight);
  const dimensions = columnNames(result);
  const xName = dimensions[0];
  const measureNames = dimensions.slice(visualization.query.dimensions.length);
  const common = {
    color: theme.colors,
    textStyle: { color: theme.text },
    dataset: { dimensions, source: result.rows },
    tooltip: { trigger: 'item', formatter: (params: unknown) => escapeText(JSON.stringify(params)) },
  };
  if (visualization.kind === 'donut') {
    const marks = buildAnnotationMarks(annotations, visualization, result);
    return {
      ...common,
      legend: { show: visualization.presentation.showLegend },
      series: buildDonutSeries(xName, measureNames[0]).map((item, index) =>
        index === 0 ? { ...item, ...marks, ...emphasis } : item,
      ),
    };
  }
  // Box plot and heatmap map rows positionally rather than through the dataset's `encode`, because
  // ECharts expects a fixed tuple per mark for both. They return before the shared axis assembly.
  if (visualization.kind === 'boxplot') {
    const offset = visualization.query.dimensions.length;
    const { series, categories } = buildBoxplotSeries(result.rows, offset);

    return {
      ...common,
      dataset: undefined,
      legend: { show: visualization.presentation.showLegend },
      grid: { show: visualization.presentation.showGrid, containLabel: true },
      xAxis: { type: 'category', data: categories, axisLabel: { color: theme.muted } },
      yAxis: { type: 'value', axisLabel: { color: theme.muted } },
      series,
    };
  }

  if (visualization.kind === 'heatmap') {
    const { series, xCategories, yCategories, min, max } = buildHeatmapSeries(result.rows);

    return {
      ...common,
      dataset: undefined,
      grid: { show: visualization.presentation.showGrid, containLabel: true },
      xAxis: { type: 'category', data: xCategories, axisLabel: { color: theme.muted } },
      yAxis: { type: 'category', data: yCategories, axisLabel: { color: theme.muted } },
      visualMap: { min, max, calculable: true, orient: 'horizontal', left: 'center', textStyle: { color: theme.text } },
      series,
    };
  }

  const baseSeries =
    visualization.kind === 'histogram'
      ? buildHistogramSeries(measureNames[0], xName)
      : visualization.kind === 'scatter'
        ? buildScatterSeries(measureNames, xName)
        : visualization.kind === 'bar'
          ? buildBarSeries(measureNames, xName, visualization.presentation.stacked)
          : visualization.kind === 'area'
            ? buildAreaSeries(measureNames, xName, visualization.presentation.stacked)
            : buildLineSeries(measureNames, xName, visualization.presentation.stacked);
  const marks = buildAnnotationMarks(annotations, visualization, result);
  const series = baseSeries.map((item, index) => ({ ...item, ...(index === 0 ? marks : {}), ...emphasis }));
  return {
    ...common,
    legend: { show: visualization.presentation.showLegend },
    grid: { show: visualization.presentation.showGrid, containLabel: true },
    // A histogram's x is the bucket's lower bound, which is continuous: a category axis would space
    // the bins evenly and hide gaps where no rows fell.
    xAxis: {
      type: visualization.kind === 'scatter' || visualization.kind === 'histogram' ? 'value' : 'category',
      axisLabel: { color: theme.muted },
    },
    yAxis: { type: 'value', axisLabel: { color: theme.muted } },
    ...(visualization.kind === 'scatter' ? { brush: { toolbox: ['rect', 'clear'], xAxisIndex: 'all' } } : {}),
    series,
  };
};
