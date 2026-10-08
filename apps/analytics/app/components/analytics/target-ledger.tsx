'use client';

// Target ledger - the ₹500/day creator target.
//
// ---- WHAT THIS USED TO BE ----
//
// A progress-meter panel with a hardcoded target, a hardcoded current value, a
// hardcoded percentage, and a list of named creators against it. The panel
// title claims a specific business rule (₹500 per day per creator), which
// makes invented numbers worse here than anywhere else: a target ledger is a
// thing people reconcile payouts against.
//
// ---- WHAT REPLACED IT ----
//
// The measurable part of it, honestly bounded:
//
//   target   - the ₹500/day rule, stated as configuration, not a measurement
//   accounts - how many accounts currently exist
//   coverage - accounts x target = the daily run-rate IF every account were a
//              paying creator
//
// That last one is a clearly-labelled projection, not a figure anyone should
// quote. It is computed from real account counts, and it is called a
// projection on the panel so it cannot be mistaken for revenue.
//
// Payout status per creator is not shown, because this app has no payout data.

import { Panel, Stat, fmtNum } from './ui';
import type { AnalyticsState } from './use-analytics';

// The rule this panel is named after. It is a business constant, not a
// measurement - kept in one place so it is not accidentally presented as an
// observed value.
const TARGET_PER_CREATOR_PER_DAY = 500;

export function TargetLedger({ state }: { state: AnalyticsState }) {
  const { data } = state;
  const accounts = data?.overview.totalVerified ?? 0;
  const totalAccounts = data?.overview.totalUsers ?? 0;
  // Clearly a projection: what the account base would be worth per day at the
  // target rate, assuming every one of them were a paying creator. That
  // assumption is almost certainly false, which is why it is labelled.
  const projectedDaily = accounts * TARGET_PER_CREATOR_PER_DAY;

  return (
    <Panel
      title="Target ledger"
      note="₹500/day per creator. The projection below assumes every verified account is a paying creator — it is not a revenue figure."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Target / creator / day"
          value={`₹${TARGET_PER_CREATOR_PER_DAY}`}
          hint="Business rule, not a measurement"
        />
        <Stat label="Verified accounts" value={fmtNum(accounts)} hint="users where is_verified = true" />
        <Stat label="All accounts" value={fmtNum(totalAccounts)} hint="including unverified" />
        <Stat
          label="Projected daily"
          value={accounts > 0 ? `₹${projectedDaily.toLocaleString('en-IN')}` : 'n/a'}
          tone={accounts > 0 ? 'warn' : 'default'}
          hint={`${accounts} verified x ₹${TARGET_PER_CREATOR_PER_DAY}. A PROJECTION, not revenue.`}
        />
      </div>

      {accounts === 0 ? (
        <div
          className="mt-3 flex min-h-[80px] items-center justify-center rounded-dashed-800 p-3 text-center"
          title="No verified accounts yet."
        >
          <p className="max-w-[56ch] text-[11px] leading-relaxed text-gray-600">
            No verified accounts, so there is nothing to measure a target against. The projection
            stays at n/a rather than showing ₹0, because ₹0 would claim the target was assessed
            and found wanting.
          </p>
        </div>
      ) : (
        <p className="mt-3-800 pt-2 text-[11px] leading-relaxed text-gray-600">
          The previous version of this panel showed a per-creator payout table with names and
          amounts. No payout data exists in this app, so the table is gone. Wire the billing
          service in here and the real figures replace this paragraph.
        </p>
      )}
    </Panel>
  );
}
