// Currency Dashboard - live exchange rates table
//
// Ye page currency-service (port 8086) se REAL rates fetch karta hai.
// Data source service ke andar hai (exchange_rates table) - ye page sirf
// display karta hai, koi calculation YAHAN nahi hoti.
//
// LIVE badge: jab service healthy ho
// STALE badge: jab rate 24h se purana ho (warning)
//
// ============================================================================
// BORDERLESS COLOR-BOX OVERHAUL (is pass me kya badla)
// ============================================================================
// Hinglish line-by-line:
//   1. Native <select> HATAYA -> Radix Select (@wideo11/ui/select).
//      KYU: native dropdown popup Windows/Chrome par OS draw karta hai — usme
//      option ka text invisible ho jata tha (dark bg par dark text) aur
//      selection highlight DEFAULT BLUE (browser styling) tha. Radix apna DOM
//      banata hai: yahan text 100% visible (`text-[#ffffff]`) aur highlight
//      hamara #ff6500 hai, 150ms transition ke saath.
//   2. Saare legacy wireframe classes gaye: `border-700`, `border-800`,
//      `divide-y divide-gray-800` (row divider lines) — sab REMOVE. Separation
//      ab sirf flat color-blocking se hoti hai, koi line nahi.
//   3. Color-box mapping (globals.css tokens ke mutabik):
//        Converter / selection container : #161616 (deep matte charcoal)
//        Rates table / footer panels      : #1e1e1e (grayish-black slate)
//        Page canvas                     : #0d0d0d (pitch black)
//   4. Blue accents (#ff6500 se replace): `bg-blue-600` Convert button ->
//      `bg-[#ff6500]` + `duration-150`, `text-blue-400` -> `text-[#ff6500]`,
//      `focus:border-blue-500` -> `focus:ring-[#ff6500]`.
//   5. Sab kuch `rounded-md`, zero shadow, segments flush jude hue.
//
// Hinglish comments: har block ka arth
'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, TrendingUp, Clock, AlertTriangle, CheckCircle2, ArrowRightLeft, Loader2 } from 'lucide-react';
// Hinglish: Radix Select — custom dropdown. Native select ki invisible-text
// aur blue-highlight problem isi se permanently khatam hoti hai.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wideo11/ui/select';

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

// Hinglish: Shared trigger class — dono currency dropdowns ek jaisi dikhein.
// Borderless: koi border/ring frame nahi, sirf flat #161616 block +
// rounded-md. Focus par #ff6500 ring (blue nahi).
const SELECT_TRIGGER_CLASS =
  'h-10 w-full rounded-md border-0 bg-[#161616] px-3 text-left text-sm text-[#ffffff] shadow-none outline-none transition-colors duration-150 hover:text-[#ff6500] focus:ring-1 focus:ring-[#ff6500] data-[state=open]:text-[#ff6500]';

// Hinglish: Dropdown ITEM class — text hamesha #ffffff (100% visible),
// hover/focus/selected par #ff6500 highlight (default blue gaya), 150ms.
const SELECT_ITEM_CLASS =
  'rounded-md text-sm text-[#ffffff] outline-none transition-colors duration-150 focus:bg-[#ff6500] focus:text-white data-[state=checked]:bg-[#ff6500] data-[state=checked]:text-white';

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

  // Hinglish: loading state bhi borderless color-box — pitch black canvas par
  // 16px (micro-16px dimension) #ff6500 spinner, koi frame nahi.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0d0d]">
        <Loader2 className="h-4 w-4 animate-spin text-[#ff6500]" />
      </div>
    );
  }

  // Rate age check (24h = 86400s)
  const STALE_SECONDS = 86400;
  const isStale = data
    ? (Date.now() - new Date(data.rates[0]?.fetched_at ?? Date.now()).getTime()) / 1000 > STALE_SECONDS
    : false;

  return (
    // Hinglish: Page canvas = #0d0d0d (solid deep pitch black). Poore page me
    // ZERO border/divide/shadow — sab kuch flat color blocks.
    <div className="min-h-screen bg-[#0d0d0d] p-6 text-[#ffffff]">
      <div className="mx-auto max-w-5xl">
        {/* ---- Header ---- */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#ffffff]">Currency Rates</h1>
            <p className="text-sm text-[#9fa7b3]">
              Base: {data?.base_currency ?? 'INR'} • Source:{' '}
              {/* Blue -> orange-red accent */}
              <span className="text-[#ff6500]">{data?.source ?? 'unknown'}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-md bg-[#161616] px-3 py-2 text-sm text-[#ffffff] transition-colors duration-150 hover:text-[#ff6500] disabled:opacity-50"
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

        {/* ---- Status banner ----
            Hinglish: Pehle yahan `border-red-700/60` jaise wireframe borders
            the — sab hate. Ab sirf tinted flat panel + rounded-md; status ka
            signal COLOR se aata hai (red/amber/green tint), line se nahi. */}
        <div
          className={`mb-6 flex items-center gap-3 rounded-md p-4 ${
            error
              ? 'bg-red-950/30'
              : isStale
              ? 'bg-amber-950/30'
              : 'bg-green-950/30'
          }`}
        >
          {error ? (
            <>
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <div>
                <p className="font-semibold text-red-300">Cannot reach currency service</p>
                <p className="text-sm text-[#9fa7b3]">{error}</p>
              </div>
            </>
          ) : isStale ? (
            <>
              <Clock className="h-4 w-4 text-amber-400" />
              <div>
                <p className="font-semibold text-amber-300">Rates are stale</p>
                <p className="text-sm text-[#9fa7b3]">
                  Rates older than 24 hours. Refresh or wait for the scheduled update.
                </p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <div>
                <p className="font-semibold text-green-300">Live rates</p>
                <p className="text-sm text-[#9fa7b3]">
                  Last updated {lastFetch ? new Date(lastFetch).toLocaleString() : 'just now'}
                </p>
              </div>
            </>
          )}
        </div>

        {/* ---- Converter ----
            Hinglish: Currency selection container = #161616 deep matte
            charcoal, rounded-md, ZERO border (pehle `border-800` tha).
            Conversion ke saare controls isi color-box ke andar flush fit hain. */}
        <div className="mb-6 rounded-md bg-[#161616] p-5">
          <div className="mb-4 flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-[#ff6500]" />
            <h2 className="font-semibold text-[#ffffff]">Convert</h2>
            {/* Badge bhi borderless — flat #1e1e1e chip */}
            <span className="rounded-md bg-[#1e1e1e] px-2 py-0.5 text-[10px] text-[#9fa7b3]">
              2 decimal rounding
            </span>
          </div>

          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
            <div className="space-y-1.5">
              <label className="text-xs text-[#9fa7b3]">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-10 w-full rounded-md border-0 bg-[#0d0d0d] px-3 text-sm text-[#ffffff] outline-none transition-colors duration-150 focus:ring-1 focus:ring-[#ff6500]"
              />
            </div>
            {/* ---- From dropdown (Radix) ----
                Hinglish: Native select ki jagah Radix — option text
                `text-[#ffffff]` se 100% visible, highlight #ff6500. */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#9fa7b3]">From</label>
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger aria-label="From currency" className={SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-md border-0 bg-[#1e1e1e] p-1 shadow-none">
                  {Object.keys(CURRENCY_META).map((c) => (
                    <SelectItem key={c} value={c} className={SELECT_ITEM_CLASS}>
                      {c} - {CURRENCY_META[c].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* ---- To dropdown (Radix) ---- */}
            <div className="space-y-1.5">
              <label className="text-xs text-[#9fa7b3]">To</label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger aria-label="To currency" className={SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-md border-0 bg-[#1e1e1e] p-1 shadow-none">
                  {Object.keys(CURRENCY_META).map((c) => (
                    <SelectItem key={c} value={c} className={SELECT_ITEM_CLASS}>
                      {c} - {CURRENCY_META[c].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Convert button: blue-600 -> #ff6500, 150ms transition */}
            <button
              onClick={handleConvert}
              disabled={converting}
              className="h-10 rounded-md bg-[#ff6500] text-sm font-medium text-white transition-colors duration-150 hover:bg-[#e55800] disabled:opacity-50"
            >
              {converting ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Convert'}
            </button>
            <div className="space-y-1.5">
              <label className="text-xs text-[#9fa7b3]">Result</label>
              <div className="flex h-10 items-center rounded-md border-0 bg-[#0d0d0d] px-3 font-mono text-sm text-green-400">
                {result !== null ? result.converted.toFixed(2) : '--'}
              </div>
            </div>
          </div>
          {result !== null && (
            <p className="mt-3 text-xs text-[#9fa7b3]">
              Rate used: {result.rate_used.toPrecision(6)} (rounded to 2 decimals)
            </p>
          )}
        </div>

        {/* ---- Rates table ----
            Hinglish: Rates matrix = #1e1e1e grayish-black slate container,
            rounded-md. PEHLE `divide-y divide-gray-800` se har row ke beech
            GREY DIVIDER LINE thi (wireframe) — wo permanently hata di.
            Ab row separation flat hai: transparent rows + hover par #161616
            block. Header apna flat #161616 block hai. */}
        <div className="overflow-hidden rounded-md bg-[#1e1e1e]">
          <table className="w-full">
            <thead className="bg-[#161616]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[#9fa7b3]">
                  Currency
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[#9fa7b3]">
                  Name
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[#9fa7b3]">
                  Rate (1 {data?.base_currency ?? 'INR'})
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[#9fa7b3]">
                  1 Unit =
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-[#9fa7b3]">
                  Source
                </th>
              </tr>
            </thead>
            {/* Hinglish: tbody par koi divide class NAHI — zero line gaps */}
            <tbody>
              {data?.rates
                .filter((r) => r.quote_currency !== data.base_currency)
                .map((r) => {
                  const meta = CURRENCY_META[r.quote_currency];
                  return (
                    <tr key={r.quote_currency} className="bg-transparent transition-colors duration-150 hover:bg-[#161616]">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold text-[#ffffff]">
                          {meta?.flag} {r.quote_currency}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[#d8d9da]">
                        {meta?.name ?? r.quote_currency}
                      </td>
                      {/* Blue -> orange-red accent */}
                      <td className="px-4 py-3 text-right font-mono text-sm text-[#ff6500]">
                        {r.rate < 0.01 ? r.rate.toPrecision(4) : r.rate.toFixed(4)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-green-400">
                        {data.base_currency} {r.rate !== 0 ? (1 / r.rate).toFixed(2) : '0.00'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* Source chip: borderless flat block */}
                        <span className="rounded-md bg-[#161616] px-2 py-0.5 text-[10px] text-[#9fa7b3]">
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
        <div className="mt-6 flex items-start gap-2 rounded-md bg-[#1e1e1e] p-4 text-xs text-[#9fa7b3]">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-[#ff6500]" />
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
