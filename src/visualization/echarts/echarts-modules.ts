import { BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  BrushComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

// Registered explicitly rather than importing all of ECharts. Each chart type and component is a
// separate bundle entry, so the distribution kinds add only what they actually draw.
use([
  BarChart,
  BoxplotChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  BrushComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
