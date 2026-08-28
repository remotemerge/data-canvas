import { getInstanceByDom, init, type EChartsCoreOption, type EChartsType } from 'echarts/core';
import { useEffect, useRef } from 'react';
import '@/visualization/echarts/echarts-modules.ts';
import { recordRenderCompletion } from '@/shared/perf/performance-marks.ts';

export const useECharts = (
  option: EChartsCoreOption,
  kind: string,
  onClick?: (params: unknown) => void,
  onBrush?: (params: unknown) => void,
) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const previousKind = useRef(kind);
  const clickHandler = useRef(onClick);
  const brushHandler = useRef(onBrush);
  clickHandler.current = onClick;
  brushHandler.current = onBrush;

  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    const chart = init(element, undefined, { renderer: 'canvas' });
    let disposed = false;
    chartRef.current = chart;
    chart.on('click', (params) => clickHandler.current?.(params));
    chart.on('brushEnd', (params) => brushHandler.current?.(params));
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (chartRef.current === chart) chart.resize();
      });
    });
    observer.observe(element);
    return () => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      chartRef.current = null;
      if (getInstanceByDom(element) === chart) chart.dispose();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) return;
    chart.setOption(option, { notMerge: previousKind.current !== kind });
    previousKind.current = kind;
    recordRenderCompletion('chart-render');
  }, [kind, option]);

  return elementRef;
};
