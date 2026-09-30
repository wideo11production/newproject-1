'use client';

// Real creator data.
//
// ---- WHAT THIS USED TO BE ----
//
// Five invented creators with subscriber counts and revenue:
//
//   { id: '1', name: 'Alex Creator',  avatar: 'AC', subscribers: 125000, views: 2400000, revenue: 12500, growth: 15.2, status: 'growing' },
//   { id: '2', name: 'Sarah Videos',  avatar: 'SV', subscribers: 89000,  views: 1800000, revenue: 8900,  growth: 8.5,  status: 'growing' },
//   { id: '3', name: 'Mike Tutorials', avatar: 'MT', subscribers: 67000,  views: 1200000, revenue: 6200,  growth: -2.1,  status: 'declining' },
//   ...
//
// `subscribers`, `views`, `revenue` and `growth` are columns that do not exist
// anywhere in this schema. The names are fiction.
//
// ---- WHAT REPLACED THEM ----
//
// The real per-registration rows, straight from `user_registrations`. There is
// no creator ranking to compute, so none is shown - the panel lists actual
// accounts and their observed signup metadata instead of a leaderboard of
// people who do not exist.

import { Chart } from 'wideo11-charts';
import { Panel, Stat, barOption, fmtNum } from './ui';
import type { AnalyticsState } from './use-analytics';

export function CreatorInsights({ state }: { state: AnalyticsState }) {
  const { data } = state;
  const regs = data?.registrations ?? [];
  const o = data?.overview;

  // Device split is the closest thing to a real "who is signing up" signal.
  const deviceCounts: Record<string, number> = {};
  for (const r of regs) {
    const d = String(r.device_type ?? 'unknown');
    deviceCounts[d] = (deviceCounts[d] ?? 0) + 1;
  }
  const hasDevices = Object.values(deviceCounts).some((v) => v > 0);

  return (
    <Panel
      title="Signups"
      note="Real rows from user_registrations - the permanent audit trail, not a computed leaderboard."
    >
      {!o ? (
        <div className="text-xs text-gray-500">Waiting for data.</div>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Stat label="Accounts" value={fmtNum(o.totalUsers)} />
            <Stat
              label="Confirmed"
              value={fmtNum(o.totalVerified)}
              tone={o.totalVerified > 0 ? 'good' : 'default'}
            />
          </div>

          {hasDevices ? (
            <Chart
              option={barOption(deviceCounts)}
              style={{ height: 150 }}
            />
          ) : (
            <EmptyWhenNone regs={regs} />
          )}

          {regs.length > 0 && (
            <ul className="mt-3 max-h-[150px] space-y-1 overflow-y-auto border-t border-gray-800 pt-2">
              {regs.slice(0, 12).map((r, i) => (
                <li key={String(r.id ?? i)} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-gray-300">{String(r.email ?? '(unknown)')}</span>
                  <span className="shrink-0 text-gray-600">
                    {String(r.os ?? 'unknown OS')} · {String(r.device_type ?? 'unknown')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

function EmptyWhenNone({ regs }: { regs: Array<Record<string, unknown>> }) {
  return (
    <div
      className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded border border-dashed border-gray-800 p-4 text-center"
      title="No registration rows to break down yet."
    >
      <span className="text-xs text-gray-500">
        {regs.length === 0 ? 'no registrations yet' : 'no device data'}
      </span>
      <span className="max-w-[36ch] text-[11px] leading-snug text-gray-600">
        {regs.length === 0
          ? 'The registration audit table is empty. Register a user and this fills in.'
          : 'Registrations exist but none carried a device_type.'}
      </span>
    </div>
  );
}
