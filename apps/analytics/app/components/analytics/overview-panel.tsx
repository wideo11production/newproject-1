'use client';

// Real overview numbers.
//
// ---- WHAT THIS USED TO BE ----
//
// A hardcoded array. No fetch, no API, no props:
//
//   { label: 'Total Views',     value: '1.2M',   change: '+12.5%' }
//   { label: 'Active Creators', value: '3.4K',   change: '+8.2%' }
//   { label: 'Revenue',         value: '$45.2K', change: '+15.3%' }
//   { label: 'Avg Watch Time',  value: '4m 32s', change: '+2.1%' }
//
// and a "Top Performing Videos" list of invented titles credited to "John
// Doe" and "Jane Smith".
//
// None of those quantities are measured by this system. There is no video
// table, no view counter, no revenue column. The numbers were plausible, the
// column headers were green, and an operator would have read them as fact.
//
// ---- WHAT REPLACED THEM ----
//
// Four figures that the database actually holds, and nothing more:
//
//   total users, verified, unverified, total registrations
//
// Views, watch time and revenue are NOT shown. They are not absent for want of
// space - they are not instrumented, and rendering a row for them (even as
// "n/a") would imply a category that exists. They are listed under
// "Not instrumented" on the page instead.

import { Activity, CheckCircle2, Clock3, UserPlus, Users } from 'lucide-react';
import { EmptyState, Panel, Stat, fmtNum } from './ui';
import type { AnalyticsState } from './use-analytics';

export function OverviewPanel({ state }: { state: AnalyticsState }) {
  const { data } = state;
  const o = data?.overview;

  return (
    <Panel
      title="Overview"
      note="Counts straight from Postgres (users, user_registrations). No derived metrics."
    >
      {!o ? (
        <EmptyState why={state.forbidden ? 'Superadmin access required.' : 'Waiting for data.'} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Total users"
            value={fmtNum(o.totalUsers)}
            tone={o.totalUsers > 0 ? 'good' : 'default'}
            hint="users table row count"
          />
          <Stat label="Verified" value={fmtNum(o.totalVerified)} hint="is_verified = true" />
          <Stat
            label="Unverified"
            value={fmtNum(o.totalUnverified)}
            tone={o.totalUnverified > 0 ? 'warn' : 'default'}
            hint="Registered but never confirmed their email"
          />
          <Stat label="Registrations" value={fmtNum(o.totalRegistrations)} hint="user_registrations rows - the permanent audit trail" />
        </div>
      )}

      {/* Columns that used to sit here with invented values. */}
      <div className="mt-3 space-y-1.5-800 pt-3 text-[11px] leading-snug text-gray-500">
        <p className="font-medium text-gray-400">Not instrumented</p>
        <p>
          <span className="text-gray-600">Total views, avg watch time, revenue</span> — this system has
          no video table, view counter or revenue column. The previous version of this panel showed
          1.2M views, 4m 32s watch time and $45.2K revenue. None of it was measured.
        </p>
        <div className="flex flex-wrap gap-3 pt-1 text-gray-600">
          <span className="inline-flex items-center gap-1">
            <Activity className="h-2.5 w-2.5" /> views
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-2.5 w-2.5" /> watch time
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-2.5 w-2.5" /> active creators
          </span>
          <span className="inline-flex items-center gap-1">
            <UserPlus className="h-2.5 w-2.5" /> signups/day history
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-2.5 w-2.5" /> engagement rate
          </span>
        </div>
      </div>
    </Panel>
  );
}
