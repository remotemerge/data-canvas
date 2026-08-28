import type { EChartsCoreOption } from 'echarts/core';
import type { ChartResult } from '@/application/queries/visualization-query.ts';
import type { Visualization } from '@/domain/visualization/visualization.ts';
import { escapeText } from '@/visualization/formatting.ts';
import { buildAreaSeries } from '@/visualization/echarts/kinds/area.ts';
import { buildBarSeries } from '@/visualization/echarts/kinds/bar.ts';
import { buildDonutSeries } from '@/visualization/echarts/kinds/donut.ts';
import { buildLineSeries } from '@/visualization/echarts/kinds/line.ts';
import { buildScatterSeries } from '@/visualization/echarts/kinds/scatter.ts';

export interface ChartTheme {
  text: string;
  muted: string;
  border: string;
  colors: string[];
}

const columnNames = (result: ChartResult): string[] => result.columns.map((column) => column.name);

export const buildEChartsOption = (
  visualization: Visualization,
  result: ChartResult,
  theme: ChartTheme,
): EChartsCoreOption => {
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
    return {
      ...common,
      legend: { show: visualization.presentation.showLegend },
      series: buildDonutSeries(xName, measureNames[0]),
    };
  }
  const series =
    visualization.kind === 'scatter'
      ? buildScatterSeries(measureNames, xName)
      : visualization.kind === 'bar'
        ? buildBarSeries(measureNames, xName, visualization.presentation.stacked)
        : visualization.kind === 'area'
          ? buildAreaSeries(measureNames, xName, visualization.presentation.stacked)
          : buildLineSeries(measureNames, xName, visualization.presentation.stacked);
  return {
    ...common,
    legend: { show: visualization.presentation.showLegend },
    grid: { show: visualization.presentation.showGrid, containLabel: true },
    xAxis: { type: visualization.kind === 'scatter' ? 'value' : 'category', axisLabel: { color: theme.muted } },
    yAxis: { type: 'value', axisLabel: { color: theme.muted } },
    ...(visualization.kind === 'scatter' ? { brush: { toolbox: ['rect', 'clear'], xAxisIndex: 'all' } } : {}),
    series,
  };
};
