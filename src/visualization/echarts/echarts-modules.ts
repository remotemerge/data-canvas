import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { BrushComponent, DatasetComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  BrushComponent,
  CanvasRenderer,
]);
