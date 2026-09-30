'use client';

import { RefreshCw, ShieldAlert } from 'lucide-react';

import { ClickstreamAnalytics } from './components/analytics/clickstream-analytics';
import { CreatorInsights } from './components/analytics/creator-insights';
import { OverviewPanel } from './components/analytics/overview-panel';
import { RetentionAnalytics } from './components/analytics/retention-analytics';
import { RevenueTracker } from './components/analytics/revenue-tracker';
import { TargetLedger } from './components/analytics/target-ledger';
import { useAnalytics } from './components/analytics/use-analytics';

// ============================================================================
// Analytics dashboard
// ============================================================================
//
// ---- WHAT THIS FILE USED TO BE ----
//
// Six inline stub components, none of which imported anything:
//
//   function OverviewPanel() { return <p>Overview analytics are unavailable.</p> }
//   function CreatorInsights() { return <p>Creator insights are unavailable.</p> }
//   ... x6
//
// Each carried a comment explaining that "the module is not present in this
// app, so keep the dashboard renderable without resolving a missing module at
// build time."
//
// The modules WERE present, in this same directory. The stubs were not working
// around a missing module - they were standing in front of six components that
// were written and never wired up, so nobody could see that the components
// underneath were full of hardcoded mock data (invented creators, invented
// revenue, invented view counts).
//
// The stubs therefore hid the very problem that needed fixing. The modules are
// now imported for real, and the mock data inside them is gone.
//
// ---- WHY IT IS A CLIENT COMPONENT ----
//
// The panel components are all 'use client' (they poll /api/analytics), so
// this page has to be too. It fetches nothing itself - it calls the shared hook
// once and hands the same state to every panel, so six panels cost one request
// rather than six.

export default function AnalyticsDashboard() {
  const state = useAnalytics();

  return (
    <div className="min-h-screen bg-gray-950 p-4 text-gray-100">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Wideo11 Analytics</h1>
          <p className="text-xs text-gray-500">
            Real data from Postgres · superadmin only
            {state.data?.fetchedAt ? (
              <>
                {' · updated '}
                <span className="text-gray-400">
                  {new Date(state.data.fetchedAt).toLocaleTimeString()}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <RefreshCw className="h-3 w-3" />
          auto-refresh 15s
        </span>
      </header>

      {/* Status banner. A dashboard that silently shows empty panels is
          indistinguishable from one that has no users, so every non-success
          state is stated. */}
      {state.forbidden ? (
        <div className="mb-4 flex items-center gap-2 rounded border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            Analytics are restricted to superadmins. Sign in with a superadmin account to see
            real data. These panels are empty because access was denied - not because there is no
            activity.
          </span>
        </div>
      ) : state.error ? (
        <div className="mb-4 rounded border border-red-900 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          Data unavailable: {state.error}. Panels below may be empty because the request failed,
          not because the system has no data.
        </div>
      ) : state.loading ? (
        <div className="mb-4 rounded border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-gray-500">
          Loading analytics…
        </div>
      ) : (
        <div className="mb-4 rounded border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
          Live from Postgres. Every figure below is measured; anything not instrumented says so
          explicitly rather than showing a placeholder number.
        </div>
      )}

      {/* 3-across on wide screens, 1 column on narrow. The previous layout used
          col-span-4 / col-span-6 / col-span-12 on a 12-column grid, which put
          three panels in a row with no regard for how much data each holds. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <OverviewPanel state={state} />
        <CreatorInsights state={state} />
        <RetentionAnalytics state={state} />
        <ClickstreamAnalytics state={state} />
        <RevenueTracker state={state} />
      </div>

      <div className="mt-3">
        <TargetLedger state={state} />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-gray-600">
        This app previously rendered hardcoded figures — 1.2M views, 3.4K creators, $45.2K
        revenue, five named creators with subscriber counts. None of it was measured, and there was
        no fetch anywhere in the codebase. Every number on this page now comes from Postgres via
        <code className="mx-1 text-gray-500">/api/analytics</code>, and categories that are not
        instrumented (views, watch time, engagement, payouts, retention curves) are labelled as
        such instead of being filled in with plausible numbers.
      </p>
    </div>
  );
}
