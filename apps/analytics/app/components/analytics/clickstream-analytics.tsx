'use client';

// Clickstream.
//
// ---- WHAT THIS USED TO BE ----
//
// A `ClickstreamAnalytics` component with no fetch. It rendered a "live event
// stream" shape - and a live event stream is the single most convincing thing a
// dashboard can fake, because real event streams look chaotic and detailed.
// Nothing about it was connected to `click_events`.
//
// ---- WHAT REPLACED IT ----
//
// The actual rows: `GET /api/v1/auth/admin/clicks` (superadmin-gated),
// forwarded through the server-side `/api/analytics` route. These are real
// events captured from the browser by `GlobalActivityTracker`, with page,
// target, label, device and timestamp.
//
// Aggregation is derived from those rows rather than invented: which pages get
// clicked, and how often.

import { Chart } from 'wideo11-charts';
import { EmptyState, Panel, Stat, barOption, fmtNum } from './ui';
import type { AnalyticsState } from './use-analytics';

export function ClickstreamAnalytics({ state }: { state: AnalyticsState }) {
  const { data } = state;
  const clicks = data?.clicks ?? [];

  // Aggregate by page. Normalised so "/auth/register" and "/auth/register/"
  // do not count as two pages, and the leading slash is dropped so the label
  // is readable.
  const pageCounts: Record<string, number> = {};
  for (const c of clicks) {
    const raw = String(c.page ?? 'unknown').replace(/\/$/, '') || '/';
    pageCounts[raw] = (pageCounts[raw] ?? 0) + 1;
  }
  const topPages = Object.entries(pageCounts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const uniquePages = topPages.length;
  const recent = [...clicks]
    .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))
    .slice(0, 15);

  return (
    <Panel
      title="Clickstream"
      note="Real events from click_events, captured in-browser by GlobalActivityTracker."
    >
      <div className="mb-2 grid grid-cols-3 gap-2">
        <Stat label="Events" value={fmtNum(clicks.length)} hint="rows in this window (server caps the fetch at 100)" />
        <Stat label="Pages hit" value={fmtNum(uniquePages)} />
        <Stat
          label="Devices"
          value={fmtNum(new Set(clicks.map((c) => String(c.device_type ?? '?'))).size)}
        />
      </div>

      {topPages.length > 0 ? (
        <Chart option={barOption(Object.fromEntries(topPages))} style={{ height: 150 }} />
      ) : (
        <EmptyState why="No click events recorded yet. Browse the app with the tracker active and this fills in." />
      )}

      {recent.length > 0 && (
        <ul className="mt-3 max-h-[160px] space-y-1 overflow-y-auto-800 pt-2">
          {recent.map((c, i) => {
            const ts = String(c.timestamp ?? '');
            // Coerce through String(): the API returns `unknown` values, and
            // rendering one directly is a type error AND a crash risk if a
            // value is ever an object.
            const page = String(c.page ?? '');
            const label = c.label == null ? '' : String(c.label);
            return (
              <li key={String(c.id ?? i)} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="truncate text-gray-300">
                  <span className="text-gray-500">{page}</span>
                  {label ? <span className="ml-1.5">{label}</span> : null}
                </span>
                <span className="shrink-0 text-gray-600">
                  {ts ? new Date(ts).toLocaleTimeString() : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
