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
  /** Split-line colour. Quieter than `border`, because grid lines sit behind the marks. */
  grid: string;
  /** Axis-line colour. Distinct from `grid` so the baseline reads without competing with the data. */
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

/**
 * Renders one hovered mark as a marker swatch, its series, and its formatted values.
 *
 * Every dataset-derived string is passed through `escapeText`, because a column header or category
 * value carrying markup would otherwise execute inside the tooltip's HTML. `marker` is ECharts' own
 * swatch span and is the one fragment interpolated raw.
 */
const formatTooltip = (raw: unknown, dimensions: string[]): string => {
  const params = raw as TooltipParams;
  const swatch = typeof params.marker === 'string' ? params.marker : '';
  const heading = escapeText(params.seriesName ?? params.name ?? '');
  const value = params.value;

  // A dataset-driven series hands back the whole row; positional kinds hand back a bare value.
  const pairs = Array.isArray(value)
    ? value.flatMap((cell, index) => {
        const label = (params.dimensionNames ?? dimensions)[index];

        return label === undefined ? [] : [`${escapeText(label)}: ${escapeText(cell)}`];
      })
    : [escapeText(value)];

  return [`${swatch}${heading}`, ...pairs].filter((line) => line !== '').join('<br/>');
};

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

/**
 * Whether a legend would tell the reader anything.
 *
 * A legend maps colours to series, so with one series it maps the only colour to the only thing on
 * screen. That costs vertical space and, because a measure column is named after its aggregate, it
 * usually renders as `sum` — a label that describes the SQL rather than the data. The user's
 * `showLegend` preference still gates it; this only removes the case where it is pure noise.
 */
const legendIsInformative = (seriesCount: number, showLegend: boolean): boolean => showLegend && seriesCount > 1;

/**
 * The axis label for a result whose time buckets were widened.
 *
 * `undefined` for every other result, so an unwidened chart carries no axis name and looks exactly
 * as it did before. Only widening needs the label: it is the one strategy that changes what the x
 * positions mean, and an axis still reading as daily when the marks are monthly is a wrong chart.
 */
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
  // Binned dimensions occupy leading result columns exactly as plain ones do, so both count when
  // deciding where the measures start. Omitting them treated the bucketed x column as a measure,
  // which drew a second series of dates against the value axis.
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
  /**
   * Chart chrome recedes so the marks carry the chart.
   *
   * Ticks are dropped because the labels already mark their own positions, and the category axis
   * keeps its baseline while the value axis drops it — a value axis is read off its split lines, so
   * a line there only boxes the plot in.
   */
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
  /**
   * `containLabel` measures the labels and reserves exactly what they need, so these are the margins
   * outside the labels rather than the plot's own insets. They stay tight because every pixel here
   * is taken from the marks.
   *
   * The axis `name` is the exception: `containLabel` does not measure it, so a chart carrying one
   * reserves the extra room itself or the granularity label is clipped off the bottom edge.
   */
  const axisNameHeight = temporalAxisName(result) === undefined ? 0 : 24;
  const gridSpacing = { top: 16, right: 16, bottom: 12 + axisNameHeight, left: 12, containLabel: true };
  if (visualization.kind === 'donut') {
    const marks = buildAnnotationMarks(annotations, visualization, result);
    // A donut's slices are its categories, so its legend names the rows rather than the series. It
    // stays keyed to the user's preference alone.
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
      // Both heatmap axes are categorical, so both keep a baseline and neither draws split lines
      // through the cells.
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
    // A histogram's x is the bucket's lower bound, which is continuous: a category axis would space
    // the bins evenly and hide gaps where no rows fell.
    // A continuous x is still a horizontal axis: it keeps the baseline and omits split lines, so
    // only the y axis rules the plot and the two sets never cross into a mesh.
    xAxis: {
      type: continuousX ? 'value' : 'category',
      ...categoryAxisStyle,
      // Widening a time bucket changes the question the chart answers, so the axis has to name the
      // granularity that actually produced these marks rather than the one that was requested.
      ...(axisName === undefined
        ? {}
        : { name: axisName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: theme.muted } }),
    },
    yAxis: { type: 'value', ...valueAxisStyle },
    ...(visualization.kind === 'scatter' ? { brush: { toolbox: ['rect', 'clear'], xAxisIndex: 'all' } } : {}),
    series,
  };
};
