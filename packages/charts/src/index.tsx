"use client"
import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsType, EChartsCoreOption } from 'echarts/core';
import { useMemo } from 'react';

// ---------------------------------------------------------------------------
// ECharts component registration - THE FILE WAS MISSING THIS ENTIRELY
// ---------------------------------------------------------------------------
//
// `echarts/core` is the tree-shakeable build. Unlike the full `echarts`
// package, it ships NO chart types, axes, or renderers - each one must be
// registered explicitly with `echarts.use([...])`.
//
// Without this call the symptom is the worst kind: NO ERROR, no warning, no
// failed request. `echarts.init()` succeeds, `setOption()` succeeds, and the
// canvas simply stays blank. The page renders, the API returns data, and the
// charts are invisible - which reads as "the dashboard is broken" when
// nothing is actually wrong with the data.
//
// That is exactly what happened: the monitor dashboard's six panels were all
// empty while `/api/timeseries` was returning 121-241 points each.
//
// Registering per component (rather than importing the full bundle) is the
// point of `echarts/core` - it keeps the JS payload down. Registering only
// what the wrapper components below can render is deliberate: adding
// everything back would undo the tree-shaking this import path exists for.
// Aliased because this file ALSO exports wrapper components with the same
// names (`BarChart`, `PieChart`, `HeatmapChart`). Importing unaliased makes
// TypeScript fail with TS2440 "Import declaration conflicts with local
// declaration", because the export below and this import would be the same
// identifier. The `E` prefix also reads clearly: these are ECharts'
// registrations, ours are React components.
import {
  LineChart as ELineChart,
  BarChart as EBarChart,
  PieChart as EPieChart,
  ScatterChart as EScatterChart,
  MapChart as EMapChart,
  HeatmapChart as EHeatmapChart,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  ToolboxComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  PolarComponent,
  GraphicComponent,
  DatasetComponent,
  TransformComponent,
  GeoComponent,
  SingleAxisComponent,
  ParallelComponent,
} from 'echarts/components';
import { LabelLayout, UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  // charts
  ELineChart,
  EBarChart,
  EPieChart,
  EScatterChart,
  EMapChart,
  EHeatmapChart,
  // axes + grid
  GridComponent,
  SingleAxisComponent,
  PolarComponent,
  // interaction
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  VisualMapComponent,
  // markers
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  // composition
  GraphicComponent,
  GeoComponent,
  DatasetComponent,
  TransformComponent,
  ParallelComponent,
  // features
  LabelLayout,
  UniversalTransition,
  // renderer - canvas only; SVG would double the work for no benefit here
  CanvasRenderer,
]);

export interface ChartProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'opt'> {
  option: EChartsCoreOption;
  loading?: boolean;
  theme?: 'light' | 'dark';
  height?: string | number;
  width?: string | number;
  notMerge?: boolean;
  lazyUpdate?: boolean;
  onChartReady?: (chart: echarts.EChartsType) => void;
}

export const useChart = (option: EChartsCoreOption, theme: 'light' | 'dark' = 'dark') => {
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Init ONCE. Re-initialising on every option change throws away the
    // existing canvas and restarts animations, which reads as visible flicker
    // on a dashboard that refreshes every 15s.
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current, theme, {
        renderer: 'canvas',
        useDirtyRect: false,
      });
    }

    // ---- Resize handling ----
    //
    // ECharts caches its canvas dimensions at init time. Without a resize
    // observer, a chart initialised while its container is still 0-wide (very
    // common: the panel renders before fonts/layout settle) stays 0-wide
    // forever, even after the container grows. The symptom is a chart that
    // "does not render" on a layout that is visibly correct in DevTools.
    const ro = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
    // NOTE: `theme` is intentionally not a dependency. Changing it would
    // require dispose + re-init, and no caller in this repo switches theme
    // at runtime. If one ever does, add a remount key on the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Options update on their own effect, so a data refresh never recreates the
  // chart instance.
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.setOption(option, { notMerge: false, lazyUpdate: true });
    }
  }, [option]);

  const resize = () => {
    chartRef.current?.resize();
  };

  return { containerRef, resize };
};

export const Chart: React.FC<ChartProps> = ({
  option,
  loading = false,
  theme = 'dark',
  height = '100%',
  width = '100%',
  notMerge = false,
  lazyUpdate = false,
  onChartReady,
  ...props
}) => {
  const { containerRef } = useChart(
    { ...option, backgroundColor: 'transparent' },
    theme
  );

  return (
    <div ref={containerRef} style={{ width, height }} {...props} />
  );
};

export const TimeSeriesChart: React.FC<ChartProps> = ({ option, ...props }) => {
  const defaultOption: EChartsCoreOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e1e',
      borderColor: '#333',
      textStyle: { color: '#fff' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'time',
      axisLabel: { color: '#888' },
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#888' },
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { show: false },
    },
    series: [{
      type: 'line',
      smooth: true,
      areaStyle: {
        opacity: 0.1,
      },
      lineStyle: {
        width: 2,
      },
    }],
  }), []);

  const merged = useMemo(() => ({ ...defaultOption, ...option }), [defaultOption, option]);

  return <Chart option={merged} {...props} />;
};

export const StatChart: React.FC<ChartProps> = ({ option, ...props }) => {
  const defaultOption: EChartsCoreOption = useMemo(() => ({
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1e1e1e',
      borderColor: '#333',
      textStyle: { color: '#fff' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      show: false,
    },
    yAxis: {
      type: 'category',
      axisLabel: { color: '#888' },
      axisLine: { show: false },
      splitLine: { show: false },
    },
    series: [{
      type: 'bar',
      horizontal: true,
      label: {
        show: true,
        position: 'right',
        color: '#fff',
      },
    }],
  }), []);

  const merged = useMemo(() => ({ ...defaultOption, ...option }), [defaultOption, option]);

  return <Chart option={merged} {...props} />;
};

export const TableChart: React.FC<ChartProps> = ({ option, ...props }) => {
  return <Chart option={option} {...props} />;
};

export const BarChart: React.FC<ChartProps> = ({ option, ...props }) => {
  const defaultOption: EChartsCoreOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#888' },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category',
      axisLabel: { color: '#888' },
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { show: false },
    },
    series: [{
      type: 'bar',
      label: {
        show: true,
        position: 'right',
        color: '#fff',
      },
    }],
  }), []);

  const merged = useMemo(() => ({ ...defaultOption, ...option }), [defaultOption, option]);

  return <Chart option={merged} {...props} />;
};

export const PieChart: React.FC<ChartProps> = ({ option, ...props }) => {
  return <Chart option={option} {...props} />;
};

export const HeatmapChart: React.FC<ChartProps> = ({ option, ...props }) => {
  return <Chart option={option} {...props} />;
};

export const GeomapChart: React.FC<ChartProps> = ({ option, ...props }) => {
  return <Chart option={option} {...props} />;
};

export const LogsChart: React.FC<ChartProps> = ({ option, ...props }) => {
  return <Chart option={option} {...props} />;
};

// BUG FIX: yahan pehle `ECharts` export hota tha, par wo KABHI import hi
// nahi hua tha. Upar ka import `import * as echarts from 'echarts/core'`
// hai - yaani namespace `echarts` hai, `ECharts` koi identifier nahi. To
// `export { ECharts }` par TypeScript deta tha:
//
//   error TS2552: Cannot find name 'ECharts'. Did you mean 'echarts'?
//
// Ye bug isliye pakda nahi gaya tha kyunki ye package KISI ne import nahi
// kiya tha (dead code) - isliye kabhi compile bhi nahi hua. Jaise hi
// monitor dashboard ne `wideo11-charts` import kiya, turant saamne aaya.
//
// Namespace ko alias karke export kiya hai, taaki consumer ke liye API
// wahi rahe (`ECharts.use(...)` wagairah) jo is file ka maqsad tha.
export {
  echarts as ECharts,
  EChartsCoreOption as ChartOption,
};

export type { EChartsType as EChartsInstance };

export default Chart;
