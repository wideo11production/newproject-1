// Currency Dashboard - live exchange rates table
//
// Ye page currency-service (port 8086) se REAL rates fetch karta hai.
// Data source service ke andar hai (exchange_rates table) - ye page sirf
// display karta hai, koi calculation YAHAN nahi hoti.
//
// LIVE badge: jab service healthy ho
// STALE badge: jab rate 24h se purana ho (warning)
//
// Hinglish comments: har block ka arth
'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, TrendingUp, Clock, AlertTriangle, CheckCircle2, ArrowRightLeft, Loader2 } from 'lucide-react';

// API base URL - SAME-ORIGIN proxy
//
// PEHLE (broken): seedha "http://localhost:8086" call hota tha.
// Wo CROSS-ORIGIN request tha (page :3007 par hai, service :8086 par) aur
// browser CORS block kar deta tha -> "Cannot reach currency service".
//
// AB: "/api/*" SAME-ORIGIN proxy use hota hai (Next.js server-side service
// tak pahunchta hai). CORS ka issue permanently khatam, aur service
// browser se directly expose bhi nahi hota.
// Hinglish: same-origin proxy - CORS problem permanently solved
const CURRENCY_API = ''; // empty = same origin (relative URLs)
// Currency ka display naam + flag emoji
const CURRENCY_META: Record<string, { name: string; flag: string }> = {
  INR: { name: 'Indian Rupee', flag: '🇮🇳' },
  USD: { name: 'US Dollar', flag: '🇺🇸' },
  EUR: { name: 'Euro', flag: '🇪🇺' },
  GBP: { name: 'British Pound', flag: '🇬🇧' },
  JPY: { name: 'Japanese Yen', flag: '🇯🇵' },
  AUD: { name: 'Australian Dollar', flag: '🇦🇺' },
  CAD: { name: 'Canadian Dollar', flag: '🇨🇦' },
  SGD: { name: 'Singapore Dollar', flag: '🇸🇬' },
  AED: { name: 'UAE Dirham', flag: '🇦🇪' },
  CNY: { name: 'Chinese Yuan', flag: '🇨🇳' },
  NZD: { name: 'New Zealand Dollar', flag: '🇳🇿' },
  CHF: { name: 'Swiss Franc', flag: '🇨🇭' },
};

interface Rate {
  base_currency: string;
  quote_currency: string;
  rate: number;
  source: string;
  fetched_at: string;
}

interface RatesResponse {
  base_currency: string;
  count: number;
  source: string;
  rates: Rate[];
}

export default function CurrencyPage() {
  const [data, setData] = useState<RatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetch, setLastFetch] = useState('');

  // ---- Rates fetch karo ----
  async function fetchRates() {
    try {
      const res = await fetch(`${CURRENCY_API}/api/rates`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastFetch(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch rates');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchRates();
    // Auto-refresh har 60 second (rate 24h wala hai, par UI fresh dikhe)
    const interval = setInterval(fetchRates, 60000);
    return () => clearInterval(interval);
  }, []);

  // ---- Manual refresh (service ko force karke) ----
  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch(`${CURRENCY_API}/api/refresh`, { method: 'POST' });
    } catch {
      // Fail ho jaye to bhi rates fetch kar lo
    }
    await fetchRates();
  }

  // ---- Convert amount (rounded 2dp server side) ----
  const [amount, setAmount] = useState('1000');
  const [from, setFrom] = useState('INR');
  const [to, setTo] = useState('USD');
  const [result, setResult] = useState<{ converted: number; rate_used: number } | null>(null);
  const [converting, setConverting] = useState(false);

  async function handleConvert() {
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) {
      setResult(null);
      return;
    }

    setConverting(true);
    try {
      const res = await fetch(`${CURRENCY_API}/api/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: value, from, to }),
      });
      const json = await res.json();
      if (res.ok) setResult(json);
      else setResult(null);
    } catch {
      setResult(null);
    } finally {
      setConverting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  // Rate age check (24h = 86400s)
  const STALE_SECONDS = 86400;
  const isStale = data
    ? (Date.now() - new Date(data.rates[0]?.fetched_at ?? Date.now()).getTime()) / 1000 > STALE_SECONDS
    : false;

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-gray-100">
      <div className="mx-auto max-w-5xl">
        {/* ---- Header ---- */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Currency Rates</h1>
            <p className="text-sm text-gray-400">
              Base: {data?.base_currency ?? 'INR'} • Source:{' '}
              <span className="text-blue-400">{data?.source ?? 'unknown'}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </button>
          </div>
        </div>

        {/* ---- Status banner ---- */}
        <div
          className={`mb-6 flex items-center gap-3 rounded-lg border p-4 ${
            error
              ? 'border-red-700/60 bg-red-950/30'
              : isStale
              ? 'border-amber-700/60 bg-amber-950/30'
              : 'border-green-700/60 bg-green-950/30'
          }`}
        >
          {error ? (
            <>
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <div>
                <p className="font-semibold text-red-300">Cannot reach currency service</p>
                <p className="text-sm text-gray-400">{error}</p>
              </div>
            </>
          ) : isStale ? (
            <>
              <Clock className="h-5 w-5 text-amber-400" />
              <div>
                <p className="font-semibold text-amber-300">Rates are stale</p>
                <p className="text-sm text-gray-400">
                  Rates older than 24 hours. Refresh or wait for the scheduled update.
                </p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5 text-green-400" />
              <div>
                <p className="font-semibold text-green-300">Live rates</p>
                <p className="text-sm text-gray-400">
                  Last updated {lastFetch ? new Date(lastFetch).toLocaleString() : 'just now'}
                </p>
              </div>
            </>
          )}
        </div>

        {/* ---- Converter ---- */}
        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900/50 p-5">
          <div className="mb-4 flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-blue-400" />
            <h2 className="font-semibold text-white">Convert</h2>
            <span className="rounded-full border border-gray-700 bg-gray-800/60 px-2 py-0.5 text-[10px] text-gray-400">
              2 decimal rounding
            </span>
          </div>

          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">From</label>
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                {Object.keys(CURRENCY_META).map((c) => (
                  <option key={c} value={c}>
                    {c} - {CURRENCY_META[c].name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">To</label>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                {Object.keys(CURRENCY_META).map((c) => (
                  <option key={c} value={c}>
                    {c} - {CURRENCY_META[c].name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleConvert}
              disabled={converting}
              className="h-10 rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {converting ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Convert'}
            </button>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">Result</label>
              <div className="flex h-10 items-center rounded-lg border border-gray-800 bg-gray-950 px-3 font-mono text-sm text-green-400">
                {result !== null ? result.converted.toFixed(2) : '--'}
              </div>
            </div>
          </div>
          {result !== null && (
            <p className="mt-3 text-xs text-gray-500">
              Rate used: {result.rate_used.toPrecision(6)} (rounded to 2 decimals)
            </p>
          )}
        </div>

        {/* ---- Rates table ---- */}
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-900/70">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Currency
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Name
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Rate (1 {data?.base_currency ?? 'INR'})
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
                  1 Unit =
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Source
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {data?.rates
                .filter((r) => r.quote_currency !== data.base_currency)
                .map((r) => {
                  const meta = CURRENCY_META[r.quote_currency];
                  return (
                    <tr key={r.quote_currency} className="bg-gray-950/40 hover:bg-gray-900/50">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold text-white">
                          {meta?.flag} {r.quote_currency}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {meta?.name ?? r.quote_currency}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-blue-400">
                        {r.rate < 0.01 ? r.rate.toPrecision(4) : r.rate.toFixed(4)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-green-400">
                        {data.base_currency} {r.rate !== 0 ? (1 / r.rate).toFixed(2) : '0.00'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="rounded-full border border-gray-700 bg-gray-800/50 px-2 py-0.5 text-[10px] text-gray-400">
                          {r.source}
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* ---- Footer info ---- */}
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-gray-800 bg-gray-900/40 p-4 text-xs text-gray-500">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-gray-600" />
          <p>
            Rates update every 24 hours (fixed interval) and are stored in the
            service&apos;s own table. All platform calculations read from that table -
            no per-request rate fetching. Rounding: 2 decimal places.
          </p>
        </div>
      </div>
    </div>
  );
}
