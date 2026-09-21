import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import type { EChartsType, EChartsOption } from 'echarts/core';
import { use, useMemo } from 'react';

export interface ChartProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'opt'> {
  option: EChartsOption;
  loading?: boolean;
  theme?: 'light' | 'dark';
  height?: string | number;
  width?: string | number;
  notMerge?: boolean;
  lazyUpdate?: boolean;
  onChartReady?: (chart: echarts.EChartsType) => void;
}

export const useChart = (option: EChartsOption, theme: 'light' | 'dark' = 'dark') => {
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current, theme, {
        renderer: 'canvas',
        useDirtyRect: false,
      });
    }

    if (chartRef.current) {
      chartRef.current.setOption(option);
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, [option, theme]);

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
  const defaultOption: EChartsOption = useMemo(() => ({
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
  const defaultOption: EChartsOption = useMemo(() => ({
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
  const defaultOption: EChartsOption = useMemo(() => ({
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

export {
  ECharts,
  EChartsOption as ChartOption,
};

export type { EChartsType as EChartsInstance };

export default Chart;
