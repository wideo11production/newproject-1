import type { EChartsCoreOption } from 'echarts/core';

// ============================================================================
// Shared analytics UI helpers
// ============================================================================
//
// Every panel used to be a hardcoded array of invented numbers. These helpers
// exist so that "we have no data" and "we have zero" can never be confused,
// and so a panel that has nothing to show says so instead of rendering a
// plausible-looking zero.

// SERIES palette matches the monitor dashboard so the two apps read as one
// product rather than two.
export const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'];

export function fmtBytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : digits)} ${u[i]}`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return n.toLocaleString('en-IN');
}

/**
 * A panel that has no data.
 *
 * The point of rendering this instead of `0` is that `0` is a claim: it says
 * "we counted and found nothing". "Not instrumented" says something quite
 * different, and the previous version of this app claimed the first while
 * actually knowing only the second.
 */
export function EmptyState({ why }: { why: string }) {
  return (
    <div
      className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-dashed-800 p-4 text-center"
      title={why}
    >
      <span className="text-xs text-gray-500">no data</span>
      <span className="max-w-[38ch] text-[11px] leading-snug text-gray-600">{why}</span>
    </div>
  );
}

/** A stat tile. `n/a` renders grey, a real 0 renders in the normal colour. */
export function Stat({
  label,
  value,
  hint,
  unit,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  unit?: string;
  tone?: 'default' | 'good' | 'warn';
}) {
  const toneClass =
    tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : value === 'n/a' ? 'text-gray-500' : 'text-gray-100';
  return (
    <div className="rounded border-800 bg-gray-900/60 p-3" title={hint}>
      <div className="truncate text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
        {value !== 'n/a' && unit ? <span className="ml-1 text-xs font-normal text-gray-500">{unit}</span> : null}
      </div>
    </div>
  );
}

/** A titled panel with an optional note and optional error. */
export function Panel({
  title,
  note,
  error,
  children,
}: {
  title: string;
  note?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border-800 bg-gray-900/40 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-200">{title}</h3>
        {error ? <span className="text-[11px] text-red-400">{error}</span> : null}
      </div>
      {note ? <p className="mb-2 text-[11px] leading-snug text-gray-500">{note}</p> : null}
      {children}
    </div>
  );
}

/** Horizontal bar chart for a label -> count map. */
export function barOption(
  data: Record<string, number>,
  opts?: { horizontal?: boolean; unit?: string; max?: number }
): EChartsCoreOption {
  const entries = Object.entries(data)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const horizontal = opts?.horizontal ?? true;
  const names = entries.map((e) => e[0]);
  const values = entries.map((e) => e[1]);

  return {
    animation: false,
    grid: { left: horizontal ? 110 : 44, right: 24, top: 10, bottom: 22 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: horizontal
      ? { type: 'value', max: opts?.max, splitLine: { lineStyle: { color: '#1f2937' } }, axisLabel: { color: '#6b7280', fontSize: 10 } }
      : { type: 'category', data: names, axisLabel: { color: '#6b7280', fontSize: 10 }, axisLine: { lineStyle: { color: '#374151' } } },
    yAxis: horizontal
      ? { type: 'category', data: names, axisLabel: { color: '#6b7280', fontSize: 10 }, axisLine: { show: false } }
      : { type: 'value', splitLine: { lineStyle: { color: '#1f2937' } }, axisLabel: { color: '#6b7280', fontSize: 10 } },
    series: [
      {
        type: 'bar',
        data: values.map((v, i) => ({ value: v, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        barMaxWidth: 18,
        label: {
          show: true,
          position: horizontal ? 'right' : 'top',
          color: '#9ca3af',
          fontSize: 10,
          formatter: (p: { value: number }) => (opts?.unit === 'bytes' ? fmtBytes(p.value) : String(p.value)),
        },
      },
    ],
  } as EChartsCoreOption;
}

/** Vertical column chart for a date -> count series. */
export function columnOption(
  points: Array<{ label: string; value: number }>,
  unit?: string
): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 44, right: 16, top: 14, bottom: 34 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: points.map((p) => p.label),
      axisLabel: { color: '#6b7280', fontSize: 10, rotate: points.length > 10 ? 40 : 0 },
      axisLine: { lineStyle: { color: '#374151' } },
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#1f2937' } }, axisLabel: { color: '#6b7280', fontSize: 10 } },
    series: [
      {
        type: 'bar',
        data: points.map((p) => p.value),
        barMaxWidth: 26,
        itemStyle: { color: PALETTE[0], borderRadius: [3, 3, 0, 0] },
        label: {
          show: true,
          position: 'top',
          color: '#9ca3af',
          fontSize: 10,
          formatter: (p: { value: number }) => (unit === 'bytes' ? fmtBytes(p.value) : String(p.value)),
        },
      },
    ],
  } as EChartsCoreOption;
}
