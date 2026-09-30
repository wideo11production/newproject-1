'use client';

// Signup timeline.
//
// ---- WHAT THIS USED TO BE ----
//
// A `RetentionAnalytics` component rendering a cohort/retention grid that had
// no cohort model behind it. There is no retention data in this system at
// all: no session history retention, no cohort table, no return-visit
// tracking. The `name` promised retention and there was no source for it.
//
// ---- WHAT REPLACED IT ----
//
// `signups_by_day` from the awareness endpoint - a real time series over
// `user_registrations.created_at`. It answers "how many people signed up",
// which is measurable, rather than "did they come back", which is not.
//
// The retention grid is not replaced with a similar-looking grid of zeros.
// A retention table full of 0% implies the measurement happened and found
// nothing; it did not happen at all. So the capability is listed as
// unavailable instead.

import { Chart } from 'wideo11-charts';
import { Panel, columnOption, fmtNum } from './ui';
import type { AnalyticsState } from './use-analytics';

export function RetentionAnalytics({ state }: { state: AnalyticsState }) {
  const { data } = state;
  const rows = data?.overview.signupsByDay ?? [];

  // The endpoint's row shape is not guaranteed, so accept the two plausible
  // spellings rather than silently rendering an empty chart if it changes.
  const points = rows
    .map((r) => {
      const label = String(r.date ?? r.day ?? r.bucket ?? '');
      const value = Number(r.count ?? r.value ?? 0);
      return { label, value: Number.isFinite(value) ? value : 0 };
    })
    .filter((p) => p.label !== '')
    .sort((a, b) => a.label.localeCompare(b.label));

  const total = points.reduce((s, p) => s + p.value, 0);

  return (
    <Panel
      title="Signups over time"
      note="Daily counts from user_registrations.created_at, grouped by the awareness endpoint."
    >
      {points.length > 0 ? (
        <Chart option={columnOption(points)} style={{ height: 168 }} />
      ) : (
        <div
          className="flex min-h-[140px] flex-col items-center justify-center gap-1 rounded border border-dashed border-gray-800 p-4 text-center"
          title="No signup rows to plot."
        >
          <span className="text-xs text-gray-500">no signup history yet</span>
          <span className="max-w-[40ch] text-[11px] leading-snug text-gray-600">
            The awareness endpoint returned no daily buckets. Register a user and this fills in.
          </span>
        </div>
      )}

      <div className="mt-2 border-t border-gray-800 pt-2 text-[11px] text-gray-600">
        Total across {points.length} day{points.length === 1 ? '' : 's'}:{' '}
        <span className="text-gray-400">{fmtNum(total)}</span>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-gray-800 pt-3 text-[11px] leading-snug text-gray-500">
        <p className="font-medium text-gray-400">Not instrumented</p>
        <p>
          <span className="text-gray-600">Actual retention</span> — cohorts, D1/D7/D30 return rates and
          retention curves need session-history and return-visit data that this system does not
          record. The previous version of this panel was called Retention and drew a retention grid
        </p>
      </div>
    </Panel>
  );
}
