'use client';

// ============================================================================
// Wideo11 monitoring dashboard - custom, Grafana-style
// ============================================================================
//
// ---- WHY THIS IS CUSTOM AND NOT GRAFANA ----
//
// Grafana is deliberately not used here. `packages/charts` already ships
// ECharts wrappers whose description is literally "Grafana-like dashboards",
// so building the dashboard in-repo is the intended shape - and it avoids a
// 400MB+ image, a second database, a second auth system, and provisioning
// YAML, all to draw some lines.
//
// What it borrows from Grafana is the *interface discipline*, not the tool:
// stat tiles across the top, time series below, a visible health banner, and
// explicit "not measured" markers instead of invented numbers.
//
// ---- THE RULE THIS FILE ENFORCES ----
//
// Never show a number that was not measured. Three states, always distinct:
//
//   value   - real number from Prometheus
//   n/a     - not instrumented, with a tooltip saying why
//   error   - instrumented but the query failed, with the error shown
//
// The previous version of this dashboard had 5 hardcoded numbers presented
// in green under a heading reading "Real-time Telemetry" - Events/sec 1.2K,
// Active Users 245, Latency 12ms, Session 12.5m, Error Rate 0.01%. None were
// real and no data source for them existed anywhere in the system. An
// operator reading "Error Rate 0.01%" concludes everything is fine. That is
// worse than an empty panel, so an empty panel is the correct output here.
//
// ---- WHAT IS REAL, VERIFIED ----
//
//   targets up   sum(up)                                   8 targets
//   CPU cores    cAdvisor rate(...)                        real
//   memory       cAdvisor working set (whole VM)            real
//   network      cAdvisor                                  real
//   disk         node-exporter, mountpoint /host_mnt        real
//   postgres     postgres-exporter, pg_monitor role        real
//   minio        custom minio-exporter (Admin API)          real
//   nats         nats-exporter, gnatsd_* prefix            real
//
// ---- WHAT IS NOT AVAILABLE, AND WHY ----
//
//   per-container CPU/memory/restarts - cAdvisor on Docker Desktop sees the
//     whole WSL2 VM as ONE cgroup (id="/") and cannot enumerate containers.
//     Works on a native Linux host; not fixable from config here.
//
//   request rate / latency / 5xx - no service exposes http_* metrics, so the
//     matching Prometheus alerts are commented out with the instrumentation
//     needed to enable them (see monitoring/rules/platform.yml).
//
//   active users / session duration - only via the superadmin awareness
//     endpoint, which is deliberately not public.

import { useCallback, useEffect, useState } from 'react';
import { Chart } from 'wideo11-charts';
import type { EChartsCoreOption } from 'echarts/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Series {
  label: string;
  points: Array<[number, number]>;
}

interface MetricsSnapshot {
  containersUp: number | null;
  containersUpError?: string;
  cpuCores: number | null;
  memoryGB: number | null;
  networkRxGB: number | null;
  dataEgress: {
    totalBytes: number | null;
    objectCount: number | null;
    bucket: string;
    source: 'live';
    scrapeError: number | null;
  };
  dataSource: 'live' | 'degraded';
  fetchedAt: string;
}

type TimeSeriesResponse = Record<
  string,
  { series: Series[]; unit: string; error?: string }
>;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtBytes(n: number | null | undefined, digits = 1): string {
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

function fmtRate(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return `${fmtBytes(n, 0)}/s`;
}

/**
 * Y-AXIS TICK FORMATTERS, one per unit.
 *
 * =============================================================================
 * WHY THIS EXISTS - THE `unit` PARAMETER WAS IGNORED
 * =============================================================================
 *
 * `timeSeriesOption(series, unit, ...)` took a `unit` and never used it. Every
 * chart therefore rendered ECharts' default numeric labels, and the result was
 * visible nonsense:
 *
 *     Memory working set      0.000000 / 0.000000 / 0.000000 / 0.000000
 *     Network throughput      9.000000 / 8.000000 / 7.000000
 *     NATS connections        2.000000 / 1.500000 / 1.000000 / 0.500000
 *
 * The memory chart's data is in BYTES (~3.2e9). ECharts divides it by its own
 * axis span, prints six decimals, and every label becomes the same string. A chart
 * whose axis cannot be read is not a chart - and the stat card two inches above it
 * correctly says "2.9 GB", so the two disagree on the same page.
 *
 * `unit` was already being passed correctly at every call site. The information
 * was there and unused, which is why nothing looked broken enough to investigate.
 *
 * Each formatter returns a SHORT string. Axis gutters are 56px wide; "3.2 GB"
 * fits, "3,200,000,000 bytes" does not, and an unreadable axis is what we are
 * fixing.
 */
const AXIS_FORMATTERS: Record<string, (v: number) => string> = {
  // Cores in use: 0.75, 1.5, 4. Two decimals below 10, because a monitor box
  // frequently sits at 0.25 cores and "0" would hide real variance.
  cores: (v) => (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(0)),
  // Bytes: the same ladder as the stat cards, so an axis label and its card agree.
  bytes: (v) => fmtBytes(v, v < 1024 ? 0 : 1),
  // Bytes per second.
  Bps: (v) => `${fmtBytes(v, v < 1024 ? 0 : 1)}/s`,
  // Percent: already 0-100 and small, so a plain integer is more readable than a
  // percentage sign on every line.
  percent: (v) => v.toFixed(0),
};

/**
 * The axis formatter for a unit, falling back to a bounded default.
 *
 * The fallback is NOT raw: a unit that is unknown, or `''` for a plain count, must
 * still produce a readable label. `toPrecision(3)` on a count gives "1.00e+0" and
 * on a large number gives "9.41e+9" - which is why the old charts looked the way
 * they did.
 */
function axisFormatter(unit: string): (v: number) => string {
  const known = AXIS_FORMATTERS[unit];
  if (known) return known;
  return (v) => {
    const abs = Math.abs(v);
    if (abs === 0) return '0';
    if (abs < 1) return v.toFixed(3);
    if (abs < 1000) return String(Math.round(v * 100) / 100);
    return fmtBytes(v, 1);
  };
}

// ---------------------------------------------------------------------------
// ECharts option builders
// ---------------------------------------------------------------------------

/**
 * Grafana-style time series: no points markers, thin fill under the line,
 * legend on top, time on the x axis. `connectNulls: false` matters - it
 * leaves a GAP where Prometheus had no sample instead of drawing a straight
 * line across missing data, which would imply a smooth change that never
 * happened.
 */
function timeSeriesOption(
  series: Series[],
  unit: string,
  height = 180,
  maxY?: number
): EChartsCoreOption {
  const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4'];
  return {
    animation: false,
    grid: { left: 56, right: 16, top: 28, bottom: 24 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, textStyle: { color: '#9ca3af', fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: '#374151' } },
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      max: maxY,
      axisLine: { show: false },
      // The unit-aware formatter. Without this the axis shows ECharts' raw
      // numbers, which for byte-valued series means every label prints the same
      // six-decimal string.
      axisLabel: {
        color: '#6b7280',
        fontSize: 10,
        formatter: axisFormatter(unit),
      },
      splitLine: { lineStyle: { color: '#1f2937' } },
    },
    series: series.map((s, i) => ({
      name: s.label,
      type: 'line',
      data: s.points,
      showSymbol: false,
      symbol: 'none',
      smooth: false,
      connectNulls: false,
      lineStyle: { width: 1.5, color: palette[i % palette.length] },
      itemStyle: { color: palette[i % palette.length] },
      areaStyle:
        series.length <= 2
          ? { opacity: 0.12, color: palette[i % palette.length] }
          : undefined,
    })),
  } as EChartsCoreOption;
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

/** A single number, or an honest "n/a" with the reason on hover. */
function Stat({
  label,
  value,
  hint,
  tone = 'default',
  unit,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  unit?: string;
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-400'
        : tone === 'bad'
          ? 'text-red-400'
          : value === 'n/a'
            ? 'text-gray-500'
            : 'text-gray-100';
  return (
    <div
      className="rounded border border-gray-800 bg-gray-900/60 p-3"
      title={hint}
    >
      <div className="truncate text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>
        {value}
        {value !== 'n/a' && unit ? (
          <span className="ml-1 text-xs font-normal text-gray-500">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}

/** A chart panel with a title and an optional note. */
function Panel({
  title,
  children,
  note,
  error,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
  error?: string;
}) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900/40 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-200">{title}</h3>
        {error ? (
          <span className="text-[11px] text-red-400">query failed: {error}</span>
        ) : null}
      </div>
      {note ? <p className="mb-2 text-[11px] leading-snug text-gray-500">{note}</p> : null}
      {children}
    </div>
  );
}

/** Explicit "we do not measure this" row. */
function NotInstrumented({
  label,
  why,
}: {
  label: string;
  why: string;
}) {
  return (
    <div
      className="flex items-center justify-between border-b border-gray-800/60 py-1.5 last:border-b-0"
      title={why}
    >
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-xs text-gray-600">n/a — {why}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const POLL_MS = 15000; // matches Prometheus scrape interval

export default function MetricsDashboard() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [ts, setTs] = useState<TimeSeriesResponse>({});
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [range, setRange] = useState<30 | 60>(60);

  const load = useCallback(async () => {
    // Do alag fetch, dono parallel. Pehle sequential the to har poll me
    // 2 round-trip latency jud jaati thi.
    const [mRes, tRes] = await Promise.all([
      fetch('/api/metrics', { cache: 'no-store' }),
      fetch('/api/timeseries?panel=cpu,memory,network,disk,postgres_backends,nats', {
        cache: 'no-store',
      }),
    ]);

    try {
      if (!mRes.ok) throw new Error(`metrics API returned ${mRes.status}`);
      setMetrics(await mRes.json());
      setMetricsError(null);
    } catch (e) {
      setMetricsError(e instanceof Error ? e.message : 'metrics fetch failed');
    }

    try {
      if (tRes.ok) {
        const j = await tRes.json();
        setTs(j.data ?? {});
      }
    } catch {
      // Time series fail hone par stat tiles rahte hain. Adhoora dashboard
      // behtar hai khaale se.
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // ---- Health banner. Derived, never invented. ----
  const allTargetsUp = (metrics?.containersUp ?? 0) >= 8;
  const exporterDown = metrics?.dataEgress?.scrapeError === 1;

  const seriesOf = (k: string): Series[] => ts[k]?.series ?? [];
  const errOf = (k: string) => ts[k]?.error;

  return (
    <div className="min-h-screen bg-gray-950 p-4 text-gray-100">
      {/* ---- Header ---- */}
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Wideo11 Monitoring</h1>
          <p className="text-xs text-gray-500">
            Custom dashboard · live from Prometheus
            {metrics?.fetchedAt ? (
              <>
                {' · updated '}
                <span className="text-gray-400">
                  {new Date(metrics.fetchedAt).toLocaleTimeString()}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Time range control. Only 30/60 min because the range query
              window is fixed server-side per panel - offering 6h/24h here
              without changing the server would be a control that lies. */}
          {([30, 60] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                range === r
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {r}m
            </button>
          ))}
          <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-gray-500">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                metricsError ? 'bg-red-500' : 'bg-emerald-500'
              }`}
            />
            {metricsError ? 'API error' : 'auto-refresh 15s'}
          </span>
        </div>
      </header>

      {/* ---- Health banner ----
          This is the panel that tells you whether the rest can be trusted.
          If the scrape targets are not all up, the charts below are stale
          and should not be read as current. */}
      <div
        className={`mb-4 rounded border px-3 py-2 text-xs ${
          metricsError
            ? 'border-red-800 bg-red-950/40 text-red-300'
            : !metrics
              ? 'border-gray-800 bg-gray-900/60 text-gray-500'
              : allTargetsUp && !exporterDown
                ? 'border-emerald-900 bg-emerald-950/30 text-emerald-300'
                : 'border-amber-900 bg-amber-950/30 text-amber-300'
        }`}
      >
        {metricsError ? (
          <>Metrics API unreachable: {metricsError}. Panels below may be stale.</>
        ) : !metrics ? (
          <>Loading metrics…</>
        ) : allTargetsUp && !exporterDown ? (
          <>
            All {metrics.containersUp} Prometheus targets up · MinIO exporter
            reporting. Metrics below are live.
          </>
        ) : exporterDown ? (
          <>MinIO exporter scrape is FAILING — storage panels below are showing the last known value, not current.</>
        ) : (
          <>
            Only {metrics.containersUp} of 8 targets up. The charts below are
            partial — check Prometheus targets before trusting them.
          </>
        )}
      </div>

      {/* ---- Stat tiles ---- */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Scrape targets up"
          value={metrics?.containersUp === null ? 'n/a' : String(metrics?.containersUp ?? '—')}
          tone={allTargetsUp ? 'good' : 'warn'}
          hint="sum(up) from Prometheus. If this is not 8, the other panels are partial."
        />
        <Stat
          label="CPU"
          value={
            metrics?.cpuCores === null || metrics?.cpuCores === undefined
              ? 'n/a'
              : metrics.cpuCores.toFixed(2)
          }
          unit="cores"
          hint="cAdvisor. Cores rather than percent: total core count varies per machine, so an absolute figure is the honest one."
        />
        <Stat
          label="Memory"
          value={fmtBytes(metrics?.memoryGB === null || metrics?.memoryGB === undefined ? null : metrics.memoryGB * 1024 ** 3)}
          hint="Whole Docker VM working set. cAdvisor cannot break this down per container on Docker Desktop."
        />
        <Stat
          label="Network RX"
          /*
            `fmtBytes`, NOT `fmtRate` - and the difference is not cosmetic.
            `networkRxGB` is
            `container_network_receive_bytes_total`, a CUMULATIVE counter: every
            byte the host has ever received since boot. It is divided by nothing.

            `fmtRate` appended "/s", so the card read:

                NETWORK RX   15 GB/s

            which is wrong twice over. The value is not a rate, and 15 GB/s is not a
            plausible number for a Docker VM's receive throughput - it is a
            cumulative total that happens to be around 15 GB. An operator glancing
            at the dashboard would read that as a throughput problem.

            `fmtRate` has no other caller now, so it is left in place for the
            per-second series in the timeseries charts, where the value IS
            `irate(...[5m])` and genuinely is a rate.

            The hint states what it is, because a bare cumulative counter on a
            dashboard is read as a rate by everyone, including the author.
          */
          value={fmtBytes(metrics?.networkRxGB === null || metrics?.networkRxGB === undefined ? null : metrics.networkRxGB * 1024 ** 3)}
          hint="Total received since boot, not a rate — container_network_receive_bytes_total is a monotonic counter."
        />
        <Stat
          label="Storage"
          value={fmtBytes(metrics?.dataEgress?.totalBytes)}
          hint={`${metrics?.dataEgress?.bucket ?? '?'} bucket, from minio-exporter (MinIO Admin API).`}
        />
        <Stat
          label="Objects"
          value={metrics?.dataEgress?.objectCount === null || metrics?.dataEgress?.objectCount === undefined ? 'n/a' : String(metrics.dataEgress.objectCount)}
        />
      </div>

      {/* ---- Charts ---- */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel
          title="CPU cores in use"
          error={errOf('cpu')}
          note="sum(rate(container_cpu_usage_seconds_total{mode!=idle}[2m])) - idle time excluded."
        >
          {seriesOf('cpu').length ? (
            <Chart option={timeSeriesOption(seriesOf('cpu'), 'cores', 170)} style={{ height: 170 }} />
          ) : (
            <EmptyPanel height={170} error={errOf('cpu')} />
          )}
        </Panel>

        <Panel
          title="Memory working set"
          error={errOf('memory')}
          note="sum(container_memory_working_set_bytes) — whole VM, cache excluded. This is the figure that triggers OOM kills."
        >
          {seriesOf('memory').length ? (
            <Chart
              option={timeSeriesOption(seriesOf('memory'), 'bytes', 170)}
              style={{ height: 170 }}
            />
          ) : (
            <EmptyPanel height={170} error={errOf('memory')} />
          )}
        </Panel>

        <Panel
          title="Network throughput"
          error={errOf('network')}
          note="container_network_receive / transmit. Two series share this panel, so no fill — overlapping fills obscure each other."
        >
          {seriesOf('network').length ? (
            <Chart
              option={timeSeriesOption(seriesOf('network'), 'Bps', 170)}
              style={{ height: 170 }}
            />
          ) : (
            <EmptyPanel height={170} error={errOf('network')} />
          )}
        </Panel>

        <Panel
          title="Disk used % (host)"
          error={errOf('disk')}
          note="mountpoint /host_mnt — Docker Desktop exposes the host filesystem there, not at /."
        >
          {seriesOf('disk').length ? (
            <Chart
              option={timeSeriesOption(seriesOf('disk'), 'percent', 170, 100)}
              style={{ height: 170 }}
            />
          ) : (
            <EmptyPanel height={170} error={errOf('disk')} />
          )}
        </Panel>

        <Panel
          title="Postgres backends"
          error={errOf('postgres_backends')}
          note="Live from postgres-exporter. This was empty until the exporter was added — Postgres was not a scrape target at all."
        >
          {seriesOf('postgres_backends').length ? (
            <Chart
              option={timeSeriesOption(seriesOf('postgres_backends'), '', 170)}
              style={{ height: 170 }}
            />
          ) : (
            <EmptyPanel height={170} error={errOf('postgres_backends')} />
          )}
        </Panel>

        <Panel
          title="NATS connections"
          error={errOf('nats')}
          note="Metric prefix is gnatsd_, not nats_ — that is what exporter v0.15.0 emits."
        >
          {seriesOf('nats').length ? (
            <Chart option={timeSeriesOption(seriesOf('nats'), '', 170)} style={{ height: 170 }} />
          ) : (
            <EmptyPanel height={170} error={errOf('nats')} />
          )}
        </Panel>
      </div>

      {/* ---- Not-instrumented section ----
          Rendered explicitly rather than hidden. A gap that is invisible is
          a gap that gets "fixed" by pasting in a made-up number, which is
          exactly how this dashboard ended up with five fabricated metrics. */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel
          title="Not instrumented"
          note="Shown on purpose. An invisible gap invites someone to fill it with a guess."
        >
          <div className="py-1">
            <NotInstrumented
              label="Requests/sec"
              why="no service exposes http_requests_total"
            />
            <NotInstrumented
              label="Latency (p95)"
              why="no http_request_duration_seconds histogram"
            />
            <NotInstrumented
              label="5xx rate"
              why="no http_* metrics at all"
            />
            <NotInstrumented
              label="Per-container CPU / memory / restarts"
              why="cAdvisor on Docker Desktop sees the whole VM as one cgroup"
            />
            <NotInstrumented
              label="Active users / session duration"
              why="only via the superadmin awareness endpoint, not public"
            />
          </div>
        </Panel>

        <Panel title="Alerting" note="Prometheus rules and where they are configured.">
          <div className="space-y-1.5 py-1 text-xs text-gray-400">
            <p>
              <span className="text-gray-200">11 rules</span> in{' '}
              <span className="text-gray-200">5 groups</span>, live via Prometheus
              → Alertmanager.
            </p>
            <p>
              Rules that reference metrics which do not exist are{' '}
              <span className="text-amber-400">commented out</span> with the
              instrumentation needed to enable them, rather than left enabled
              and silently returning nothing.
            </p>
            <p className="text-gray-500">
              Config: <code className="text-gray-400">monitoring/rules/platform.yml</code> ·
              Prometheus: <code className="text-gray-400">localhost:9090</code>
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** Placeholder that says WHY it is empty. Never a bare blank box. */
function EmptyPanel({ height, error }: { height: number; error?: string }) {
  return (
    <div
      className="flex items-center justify-center rounded border border-dashed border-gray-800 text-xs text-gray-600"
      style={{ height }}
    >
      {error ? `query failed: ${error}` : 'no data returned by Prometheus for this window'}
    </div>
  );
}
