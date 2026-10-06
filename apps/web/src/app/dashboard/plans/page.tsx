'use client';

/**
 * ============================================================================
 * PLAN & ENTITLEMENTS  -  /dashboard/plans
 * ============================================================================
 *
 * REQUIREMENT: trial-countdown.tsx ke "View plans" / "Manage" links
 * is page par jate the, aur ye page NAHI tha - 404. Ab ye wahan hai.
 *
 * Ye page dikhata hai:
 *   1. CURRENT PLAN   - plan ka naam, trial ya nahi, kab tak chalega
 *   2. LIMITS GRID    - har capability aur uski allowance (uploads etc.)
 *   3. EXPIRY         - server-computed countdown (browser clock nahi)
 *
 * -----------------------------------------------------------------------------
 * WHY ONLY THE CALLER'S OWN PLAN (security rationale)
 * -----------------------------------------------------------------------------
 * Data same-origin BFF (`/api/auth/my-plan`) se aata hai, jo httpOnly
 * `wideo11_session` cookie se token attach karke auth-service ke
 * `/me/entitlements` tak pahunchata hai. Browser ke haath me token
 * KABHI nahi hota, aur response me koi `user_id` nahi hota - identity
 * token se resolve hoti hai, URL ya body se nahi.
 *
 * Plan CATALOGUE (prices, codes) yahan nahi hai kyunki wo surface
 * superadmin-gated hai (`GET /admin/entitlements`). Ek user ko doosre
 * ki grant ya price list dikhana is page ka kaam nahi. Upgrade ek
 * OPERATOR decision hai - `POST /admin/entitlements` se hota hai,
 * audited aur ek insaan se attributed. Isliye yahan koi "Buy" button
 * nahi: ek button jo kisi bhi plan ko self-service se de do, us plan
 * ko bechne ka matlab hai.
 *
 * -----------------------------------------------------------------------------
 * COUNTDOWN SOURCE
 * -----------------------------------------------------------------------------
 * `expires_in_seconds` SERVER ne compute kiya hai, isliye countdown
 * browser ki clock par depend nahi karta (jise network round-trip aur
 * device time dono se error milta hai). Zero par ye server se dobara
 * poochta hai - local decrement negatives me jaata.
 *
 * Hinglish comments: har block ka arth
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  CreditCard,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@wideo11/ui/button';

// ---------------------------------------------------------------------------
// Types (BFF `/api/auth/my-plan` ka response - `trial-countdown.tsx` se
// same shape, wahan se import isliye NAHI kiya kyunki wahan component hai
// aur ye page uske state se juda nahi hai)
// ---------------------------------------------------------------------------
type MyPlan = {
  plan: string;
  plan_name: string;
  has_plan: boolean;
  is_trial: boolean;
  /** ISO string, or null for a lifetime plan. Display only. */
  expires_at: string | null;
  /** Server-computed seconds remaining. -1 means "never expires". */
  expires_in_seconds: number;
  trial_expiring_soon: boolean;
  limits: Record<string, number | 'unlimited'>;
  error?: string;
};

/** `media_assets` -> "Media assets". Keys snake_case hain, humans nahi. */
function humanize(key: string): string {
  return key
    .split('_')
    .map((part) => (part.length ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/** `2d 4h`, `4h 12m`, `12m 05s` - same ladder as the countdown banner. */
function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'now';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** `2026-12-31T00:00:00Z` -> `31 Dec 2026`. Invalid par "—". */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function DashboardPlansPage() {
  const [plan, setPlan] = useState<MyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Server-computed seconds; local tick sirf display karne ke liye.
  const [remaining, setRemaining] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      // `no-store` - ek cached countdown ek jhoothi countdown hai.
      const res = await fetch('/api/auth/my-plan', { cache: 'no-store' });
      const body = (await res.json()) as MyPlan;
      setPlan(body);
      setError(null);
      setRemaining(body.expires_in_seconds >= 0 ? body.expires_in_seconds : null);
    } catch {
      // BFF upar 503 deta hai jab auth-service unreachable ho. Ye page
      // error ke sath render karta hai - banner silently gayab nahi hota.
      setError('Could not reach the plan service. Your plan is unchanged.');
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Ek minute baad refresh - tab tak local tick enough hai.
    const poll = setInterval(() => void load(), 60_000);
    return () => clearInterval(poll);
  }, [load]);

  // ---- Visible tick: 1s decrement, zero par server se sach poocho ----
  useEffect(() => {
    if (remaining === null) return;
    const tick = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          void load();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [remaining === null, load]);

  const limits = plan?.limits ?? {};
  const limitRows = Object.entries(limits);

  return (
    <div className="min-h-screen bg-[#0d0f11] text-[#e6e6e6]">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* ---- Header: back + title ---- */}
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 rounded-md text-sm text-[#8b949e] transition-colors hover:text-[#e6e6e6]"
          >
            <ChevronLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </div>

        <h1 className="mb-1 text-2xl font-bold">Your plan</h1>
        <p className="mb-6 text-sm text-[#8b949e]">
          Capabilities and expiry for your account. Upgrades are granted by
          an operator, not purchased here.
        </p>

        {loading && !plan ? (
          <div className="flex items-center gap-2 rounded-lg border border-[#2c3235] bg-[#16181d] p-6 text-sm text-[#8b949e]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your plan…
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-950/20 p-4 text-sm text-red-200" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : !plan || !plan.has_plan ? (
          /* ---- No plan: honest empty state, fake "free trial" nahi ---- */
          <div className="rounded-lg border border-[#2c3235] bg-[#16181d] p-6">
            <CreditCard className="mb-3 h-6 w-6 text-[#8b949e]" />
            <p className="text-sm font-medium">No active plan</p>
            <p className="mt-1 text-xs text-[#8b949e]">
              Your account has no granted plan. An operator can grant one
              from the admin surface — this page cannot sell or self-grant
              a plan, by design.
            </p>
          </div>
        ) : (
          <>
            {/* ---- Current plan card ---- */}
            <div className="rounded-lg border border-[#2c3235] bg-[#16181d] p-5">
              <div className="flex flex-wrap items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-[#5794f2]" />
                <span className="text-lg font-semibold">{plan.plan_name}</span>
                <code className="rounded bg-[#0d0f11] px-1.5 py-0.5 text-xs text-[#8b949e]">
                  {plan.plan}
                </code>
                {plan.is_trial && (
                  <span className="rounded-full border border-amber-500/50 bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-200">
                    trial
                  </span>
                )}
                {plan.trial_expiring_soon && remaining !== null && remaining <= 3600 && (
                  <span className="flex items-center gap-1 rounded-full border border-amber-500/60 bg-amber-950/60 px-2 py-0.5 text-xs font-semibold text-amber-100">
                    <AlertTriangle className="h-3 w-3" />
                    expiring
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-[#8b949e]">Expires</p>
                  <p className="mt-0.5 font-medium">
                    {plan.expires_at ? formatDate(plan.expires_at) : 'Never (lifetime)'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#8b949e]">Time remaining</p>
                  <p className="mt-0.5 font-mono font-medium">
                    {remaining === null ? '—' : formatRemaining(remaining)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#8b949e]">Status</p>
                  <p className="mt-0.5 font-medium">
                    {remaining !== null && remaining <= 0
                      ? 'Expired — refresh pending'
                      : 'Active'}
                  </p>
                </div>
              </div>
            </div>

            {/* ---- Limits grid ---- */}
            {limitRows.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#8b949e]">
                  <CalendarClock className="h-4 w-4" />
                  What your plan includes
                </h2>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {limitRows.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-lg border border-[#2c3235] bg-[#16181d] px-4 py-3"
                    >
                      <dt className="text-sm text-[#c9d1d9]">{humanize(key)}</dt>
                      <dd className="font-mono text-sm font-medium text-[#e6e6e6]">
                        {value === 'unlimited' ? 'Unlimited' : value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-[#8b949e]">
                  A limit of 0 means "not in your plan" — that is a denial,
                  not a quota you have used up.
                </p>
              </div>
            )}

            <div className="mt-8">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load()}
                className="border-[#2c3235] text-[#c9d1d9] hover:bg-[#1f2227]"
              >
                Refresh
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
