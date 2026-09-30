'use client';

// Revenue.
//
// ---- WHAT THIS USED TO BE ----
//
// A `RevenueTracker` that rendered currency figures: MRR, ARPU, payout totals,
// a "top earners" table. It had no data source at all.
//
// Money is the one category where a plausible-looking invented number does the
// most damage, because it is the number people make decisions on. A dashboard
// showing $45.2K that no one can reconcile against a ledger is worse than an
// empty panel: it will end up in a deck.
//
// ---- WHAT REPLACED IT ----
//
// Nothing numeric. The billing service exists (port 3003) and owns the ledger,
// but this app has no route to it and the schema here has no revenue column.
// Rather than invent a substitute, the panel states plainly where the number
// lives and why it is absent.
//
// That is the honest version of this panel. When a revenue endpoint is wired up,
// the numbers go here - the structure is ready for it.

import { ExternalLink } from 'lucide-react';
import { Panel } from './ui';
import type { AnalyticsState } from './use-analytics';

export function RevenueTracker({ state }: { state: AnalyticsState }) {
  const { data } = state;
  const verified = data?.overview.totalVerified ?? 0;

  return (
    <Panel
      title="Revenue"
      note="Deliberately shows no figures. See the note below."
    >
      <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded border border-dashed border-gray-800 p-4 text-center">
        <span className="text-sm text-gray-400">not available on this app</span>
        <p className="max-w-[52ch] text-[11px] leading-relaxed text-gray-600">
          Revenue is owned by the billing service, not by this analytics app, and there is no
          route from here to it. The previous version of this panel rendered MRR, ARPU and payout
          totals as hardcoded literals.
        </p>
        <p className="max-w-[52ch] text-[11px] leading-relaxed text-gray-600">
          Those were not read from a ledger. Any number shown here would have to come from the
          billing service, so none is shown.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-800 pt-3 text-[11px] text-gray-500">
        <div>
          <div className="text-gray-400">Where the ledger lives</div>
          <div className="mt-0.5 flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            <span>billing-service · port 3003</span>
          </div>
        </div>
        <div>
          <div className="text-gray-400">Closest real signal here</div>
          <div className="mt-0.5">
            <span className="text-gray-300">{verified}</span> verified account{verified === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    </Panel>
  );
}
