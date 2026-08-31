import type { EChartsCoreOption } from 'echarts/core';
import type { ChartResult } from '@/application/queries/visualization-query.ts';
import { temporalUnitLabel } from '@/application/queries/adaptive-sampling.ts';
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
  // Grid split-line colour.
  grid: string;
  // Axis-line colour.
  axis: string;
  tooltipBackground: string;
  tooltipText: string;
  colors: string[];
}

const columnNames = (result: ChartResult): string[] => result.columns.map((column) => column.name);

interface TooltipParams {
  marker?: string;
  seriesName?: string;
  name?: string;
  value?: unknown;
  dimensionNames?: string[];
  encode?: { x?: number[]; y?: number[] };
}

// Builds an escaped tooltip for a hovered mark.
const formatTooltip = (raw: unknown, dimensions: string[]): string => {
  const params = raw as TooltipParams;
  const swatch = typeof params.marker === 'string' ? params.marker : '';
  const heading = escapeText(params.seriesName ?? params.name ?? '');
  const value = params.value;

  // Dataset-backed series return full rows; positional series return a scalar.
  const pairs = Array.isArray(value)
    ? value.flatMap((cell, index) => {
        const label = (params.dimensionNames ?? dimensions)[index];

        return label === undefined ? [] : [`${escapeText(label)}: ${escapeText(cell)}`];
      })
    : [escapeText(value)];

  return [`${swatch}${heading}`, ...pairs].filter((line) => line !== '').join('<br/>');
};

// Opacity for marks outside a highlight selection.
const DIMMED_OPACITY = 0.25;

// Returns per-mark opacity for highlight mode.
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

// Returns whether a result row is selected.
export type HighlightPredicate = (rowIndex: number) => boolean;

// Returns whether the chart should display a legend.
const legendIsInformative = (seriesCount: number, showLegend: boolean): boolean => showLegend && seriesCount > 1;

// Axis label shown when time buckets were widened.
const temporalAxisName = (result: ChartResult): string | undefined => {
  const strategy = result.disclosure?.strategy;

  return strategy?.kind === 'temporalWiden' ? temporalUnitLabel[strategy.to] : undefined;
};

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
  // Count binned dimensions with plain dimensions when locating measures.
  const groupedCount = visualization.query.dimensions.length + (visualization.query.binnedDimensions ?? []).length;
  const measureNames = dimensions.slice(groupedCount);
  const common = {
    color: theme.colors,
    backgroundColor: 'transparent',
    textStyle: { color: theme.text },
    dataset: { dimensions, source: result.rows },
    tooltip: {
      trigger: 'item',
      backgroundColor: theme.tooltipBackground,
      borderWidth: 0,
      textStyle: { color: theme.tooltipText },
      formatter: (params: unknown) => formatTooltip(params, dimensions),
    },
  };
  // Configures chart chrome so marks remain prominent.
  const categoryAxisStyle = {
    axisLabel: { color: theme.muted },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: theme.axis } },
    splitLine: { show: false },
  };
  const valueAxisStyle = {
    axisLabel: { color: theme.muted },
    axisTick: { show: false },
    axisLine: { show: false },
    splitLine: { lineStyle: { color: theme.grid } },
  };
  // Margins outside labels; reserve extra space for an axis name.
  const axisNameHeight = temporalAxisName(result) === undefined ? 0 : 24;
  const gridSpacing = { top: 16, right: 16, bottom: 12 + axisNameHeight, left: 12, containLabel: true };
  if (visualization.kind === 'donut') {
    const marks = buildAnnotationMarks(annotations, visualization, result);
    // A donut legend names slices, so it follows the user's legend preference.
    return {
      ...common,
      legend: { show: visualization.presentation.showLegend },
      series: buildDonutSeries(xName, measureNames[0]).map((item, index) =>
        index === 0 ? { ...item, ...marks, ...emphasis } : item,
      ),
    };
  }
  // Box plots and heatmaps map fixed row tuples positionally.
  if (visualization.kind === 'boxplot') {
    const offset = visualization.query.dimensions.length;
    const { series, categories } = buildBoxplotSeries(result.rows, offset);

    return {
      ...common,
      dataset: undefined,
      legend: { show: legendIsInformative(series.length, visualization.presentation.showLegend) },
      grid: { show: visualization.presentation.showGrid, ...gridSpacing },
      xAxis: { type: 'category', data: categories, ...categoryAxisStyle },
      yAxis: { type: 'value', ...valueAxisStyle },
      series,
    };
  }

  if (visualization.kind === 'heatmap') {
    const { series, xCategories, yCategories, min, max } = buildHeatmapSeries(result.rows);

    return {
      ...common,
      dataset: undefined,
      grid: { show: visualization.presentation.showGrid, ...gridSpacing },
      // Categorical heatmap axes keep baselines and omit split lines through cells.
      xAxis: { type: 'category', data: xCategories, ...categoryAxisStyle },
      yAxis: { type: 'category', data: yCategories, ...categoryAxisStyle },
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
  const axisName = temporalAxisName(result);
  const continuousX = visualization.kind === 'scatter' || visualization.kind === 'histogram';

  return {
    ...common,
    legend: { show: legendIsInformative(series.length, visualization.presentation.showLegend) },
    grid: { show: visualization.presentation.showGrid, ...gridSpacing },
    // Histogram buckets use a continuous x-axis so gaps remain visible.
    // Keep the baseline and omit split lines through the plot.
    xAxis: {
      type: continuousX ? 'value' : 'category',
      ...categoryAxisStyle,
      // Label widened temporal buckets with the unit actually rendered.
      ...(axisName === undefined
        ? {}
        : { name: axisName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: theme.muted } }),
    },
    yAxis: { type: 'value', ...valueAxisStyle },
    ...(visualization.kind === 'scatter' ? { brush: { toolbox: ['rect', 'clear'], xAxisIndex: 'all' } } : {}),
    series,
  };
};
