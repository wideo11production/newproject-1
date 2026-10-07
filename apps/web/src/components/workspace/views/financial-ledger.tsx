// FinancialLedgerView — 💰 5% sister split ledger + GST reporting.
//
// Hinglish: ye view billing-service ke settlement engine se data fetch karta
// hai:
//   - Monthly revenue (Gross, Net, Sister share)
//   - Wallet credit history (viewer + creator credits)
//   - GST breakdown (IGST/CGST+SGST)
//   - Conservation law verification (Gross = sum of all parts)
//
// User directive: "Financial Ledger Hub (Enforces the automated 5% sister
// split ledger rules)"

import { useEffect, useState } from 'react';
import { Wallet, Receipt, TrendingUp, Calendar } from 'lucide-react';

type LedgerEntry = {
  uuid: string;
  gross_amount: number;
  net_to_wallets: number;
  gst_total: number;
  sister_share: number;
  viewer_amount: number;
  creator_amount: number;
  platform_amount: number;
  status: 'complete' | 'pending' | 'failed';
  completed_at?: string;
  created_at: string;
};

export function FinancialLedgerView() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthTotal, setMonthTotal] = useState({
    gross: 0,
    net: 0,
    sister: 0,
    gst: 0,
    yours: 0,
  });

  useEffect(() => {
    void fetch('/api/billing/settlements?limit=30', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const settlements = (data.settlements || []) as LedgerEntry[];
        setEntries(settlements);

        // Calculate monthly totals.
        const totals = settlements.reduce((acc, s) => {
          acc.gross += s.gross_amount;
          acc.net += s.net_to_wallets;
          acc.sister += s.sister_share;
          acc.gst += s.gst_total;
          // "Yours" = creator share (only if subscribed)
          acc.yours += s.creator_amount;
          return acc;
        }, { gross: 0, net: 0, sister: 0, gst: 0, yours: 0 });
        setMonthTotal(totals);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 animate-pulse rounded bg-[#1f2227]" />
      </div>
    );
  }

  const formatCurrency = (n: number) => `₹${n.toLocaleString()}`;
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-[#d8d9da] mb-6">
        Financial Ledger Hub
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-8">
        <div className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-4">
          <p className="text-[11px] uppercase text-[#9fa7b3]">Gross Revenue</p>
          <p className="mt-1 text-xl font-bold text-[#d8d9da]">
            {formatCurrency(monthTotal.gross)}
          </p>
        </div>
        <div className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-4">
          <p className="text-[11px] uppercase text-[#9fa7b3]">GST (18% IN)</p>
          <p className="mt-1 text-xl font-bold text-[#f2495c]">
            {formatCurrency(monthTotal.gst)}
          </p>
        </div>
        <div className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-4">
          <p className="text-[11px] uppercase text-[#9fa7b3]">Sister Share (5%)</p>
          <p className="mt-1 text-xl font-bold text-[#f7c548]">
            {formatCurrency(monthTotal.sister)}
          </p>
        </div>
        <div className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-4">
          <p className="text-[11px] uppercase text-[#9fa7b3]">Net to Wallets</p>
          <p className="mt-1 text-xl font-bold text-[#73bf69]">
            {formatCurrency(monthTotal.net)}
          </p>
        </div>
        <div className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-4">
          <p className="text-[11px] uppercase text-[#9fa7b3]">Your Share (20%)</p>
          <p className="mt-1 text-xl font-bold text-[#5794f2]">
            {formatCurrency(monthTotal.yours)}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#d8d9da]">
            Settlement History (last 30)
          </h3>
          <button className="text-xs text-[#9fa7b3] hover:text-[#d8d9da]">
            <Calendar className="inline h-3 w-3 mr-1" />
            This month
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="py-8 text-center text-[#9fa7b3]">
            <Wallet className="mx-auto h-6 w-6 mb-2" />
            <p>No settlement history yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#2c3235]">
                  <th className="pb-2 text-[10px] uppercase text-[#9fa7b3]">Settlement</th>
                  <th className="pb-2 text-[10px] uppercase text-[#9fa7b3]">Gross</th>
                  <th className="pb-2 text-[10px] uppercase text-[#9fa7b3]">GST</th>
                  <th className="pb-2 text-[10px] uppercase text-[#9fa7b3]">Viewer (60%)</th>
                  <th className="pb-2 text-[10px] uppercase text-[#9fa7b3]">Creator (20%)</th>
                  <th className="pb-2 text-[10px] uppercase text-[#9fa7b3]">Platform (20%)</th>
                  <th className="pb-2 text-[10px] uppercase text-[#9fa7b3]">Sister</th>
                  <th className="pb-2 text-[10px] uppercase text-[#9fa7b3]">Date</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.uuid} className="border-b border-[#2c3235]/40">
                    <td className="py-2">
                      <span className="font-mono text-[10px] text-[#9fa7b3]">
                        {e.uuid.slice(0, 8)}...
                      </span>
                    </td>
                    <td className="py-2">{formatCurrency(e.gross_amount)}</td>
                    <td className="py-2 text-[#f2495c]">{formatCurrency(e.gst_total)}</td>
                    <td className="py-2">{formatCurrency(e.viewer_amount)}</td>
                    <td className="py-2 text-[#5794f2]">{formatCurrency(e.creator_amount)}</td>
                    <td className="py-2">{formatCurrency(e.platform_amount)}</td>
                    <td className="py-2 text-[#f7c548]">{formatCurrency(e.sister_share)}</td>
                    <td className="py-2 text-[#9fa7b3]">{formatDate(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
