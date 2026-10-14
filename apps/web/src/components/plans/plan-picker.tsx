'use client';

/**
 * PLAN PICKER  -  which plan a user may choose, and the choice itself.
 *
 * =============================================================================
 * WHAT THIS RENDERS, AND WHERE THE DECISION LIVES
 * =============================================================================
 *
 * The list comes from the server (`GET /api/plans` -> `GET /me/plans`). This file
 * does not hold prices, plan codes, or a rule about which plans are selectable.
 *
 * That is not modesty, it is the boundary that keeps the UI honest. The service
 * refuses lifetime plans by CYCLE - a subscription that can end when payment
 * stops, versus a grant that cannot. A second copy of that rule here would be a
 * plan the UI offers and the service refuses, or the reverse, with nothing saying
 * which is right.
 *
 * =============================================================================
 * WHY THE BUTTON IS NOT A LOOPHOLE
 * =============================================================================
 *
 * A session token can now grant a plan, which was once impossible. The reason it
 * is safe is that the plan no longer gates PERMISSION - it gates EARNING.
 * Uploading is free and unlimited for everyone, so a user who picks `starter`
 * gains the right to be paid and nothing else they could not already do.
 *
 * What is still refused server-side, and refused there rather than hidden here:
 *
 *   - lifetime plans (by cycle)
 *   - unknown plans (with the list of what IS available)
 *   - any request with no session, since the buyer is resolved from the token
 *
 * =============================================================================
 * COUNTRY/CURRENCY DETECTION
 * =============================================================================
 *
 * Plans are displayed in the user's detected country currency. Detection uses
 * IP geolocation (works with VPN) with timezone/locale fallbacks. The region
 * (India/High/Low) determines pricing tiers per billing-service PlanPriceTable.
 *
 * =============================================================================
 * MINIMUM BALANCE NOT SHOWN IN PLAN CARDS
 * =============================================================================
 *
 * Per user directive: minimum balance is NOT shown in plan picker.
 * It only appears in Terms & Conditions AFTER user subscribes.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Globe, AlertCircle, Info } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { useCountryCurrency, type Region, type CountryCurrencyInfo } from '@/lib/country-currency';

import {
  grafanaPrimary,
  grafanaPrimaryBg,
  productPanel,
  productPanelDeep,
  productPanelHover,
  productSeparation,
  productTextBody,
  productTextMuted,
  productTextTertiary,
} from '@wideo11/ui/design-system';

type SelectablePlan = {
  code: string;
  name: string;
  price_minor: number;
  currency: string;
  cycle: string;
  trial_days?: number;
  /** Minimum units of the plan's currency the account must maintain. */
  min_balance: number;
  max_channels?: number | 'unlimited';
  monetization?: number | 'unlimited';
};

/** 29000 USD -> "$290.00". Minor units, so the division is by 100. */
function formatPrice(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(major);
  } catch {
    return `${major} ${currency}`;
  }
}

export function PlanPicker({
  currentPlan,
  isTrial,
  onSubscribed,
}: {
  currentPlan: string;
  isTrial: boolean;
  onSubscribed: () => void;
}) {
  const [plans, setPlans] = useState<SelectablePlan[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [justSubscribed, setJustSubscribed] = useState<string | null>(null);
  const { info: countryInfo, loading: countryLoading, refresh: refreshCountry } = useCountryCurrency();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/plans', { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as {
          plans?: SelectablePlan[];
          message?: string;
        };
        if (!alive) return;
        if (res.ok) {
          setPlans(body.plans ?? []);
          setLoadError(null);
        } else {
          setLoadError('Could not load available plans. Your current plan is unchanged.');
        }
      } catch {
        if (alive) setLoadError('Could not load available plans. Your current plan is unchanged.');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const subscribe = useCallback(
    async (code: string) => {
      setBusy(code);
      setActionError(null);
      setJustSubscribed(null);
      try {
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_code: code }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
          plan_name?: string;
        };
        if (!res.ok) {
          setActionError(body.message ?? body.error ?? 'Could not subscribe to that plan.');
          return;
        }
        setJustSubscribed(body.plan_name ?? code);
        onSubscribed();
      } catch {
        setActionError('Could not reach the plan service. Your plan is unchanged.');
      } finally {
        setBusy(null);
      }
    },
    [onSubscribed]
  );

  // Filter plans based on user's detected region
  // Server returns all plans, but we can highlight the region-appropriate ones
  const getRegionLabel = (region: Region): string => {
    switch (region) {
      case 'india': return 'India (INR)';
      case 'high': return 'International (USD/EUR/GBP)';
      case 'low': return 'Regional (Local Currency)';
      default: return 'International';
    }
  };

  const isPlanForRegion = (planCurrency: string, userRegion: Region): boolean => {
    const planRegion = planCurrency === 'INR' ? 'india' : 
                       ['USD', 'EUR', 'GBP', 'CHF', 'AUD', 'CAD', 'SGD', 'AED'].includes(planCurrency) ? 'high' : 'low';
    return planRegion === userRegion;
  };

  return (
    <section className={`mt-8 rounded-xl border ${productSeparation} ${productPanelHover} p-6`}>
      {/* Country/Currency indicator */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className={`text-sm font-semibold ${productTextBody}`}>Choose your plan</h2>
        <div className="flex items-center gap-2">
          {countryLoading && <Loader2 className={`h-3.5 w-3.5 animate-spin ${productTextMuted}`} />}
          <div className={`flex items-center gap-1.5 text-xs ${productTextMuted}`}>
            <Globe className="h-3 w-3" />
            <span>
              {countryInfo.countryName} ({countryInfo.currency})
              {countryInfo.isDetected ? (
                <span className="ml-1.5 text-emerald-400" title="Auto-detected via IP">✓</span>
              ) : (
                <span className="ml-1.5 text-amber-400" title="Using fallback">~</span>
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void refreshCountry()}
              className="h-6 px-2 py-0 text-xs h-6"
              title="Re-detect location"
            >
              <Loader2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      <p className={`mt-1 max-w-xl text-xs ${productTextMuted}`}>
        Uploads are free and unlimited on every plan. A paid plan adds the right to
        earn — ads still run on every channel either way, and a channel with no
        active subscription earns nothing.
      </p>

      {/* Region notice */}
      <p className={`mt-3 text-xs ${grafanaPrimary} flex items-center gap-1`}>
        <Info className="h-3 w-3" />
        Showing plans for <strong>{getRegionLabel(countryInfo.region)}</strong> region. 
        Prices update automatically when your location changes.
      </p>

      {loadError && <p className="mt-4 text-xs text-amber-300">{loadError}</p>}

      {actionError && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200"
        >
          {actionError}
        </p>
      )}

      {justSubscribed && (
        <p
          role="status"
          className="mt-4 flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-200"
        >
          <Check className="h-2.5 w-2.5" />
          You are on {justSubscribed}. Earnings are active from now.
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {plans.map((p) => {
          const current = p.code === currentPlan;
          const monetised = p.monetization !== 0 && p.monetization !== undefined;
          const planRegion = p.currency === 'INR' ? 'india' : 
                            ['USD', 'EUR', 'GBP', 'CHF', 'AUD', 'CAD', 'SGD', 'AED'].includes(p.currency) ? 'high' : 'low';
          const isForUserRegion = planRegion === countryInfo.region;

          return (
            <article
              key={p.code}
              className={`flex flex-col justify-between rounded-lg border p-4 relative ${
                current
                  ? `${grafanaPrimary} ${grafanaPrimaryBg}/5`
                  : isForUserRegion
                  ? `${productSeparation} ${productPanel}`
                  : `${productSeparation} ${productPanelDeep} opacity-70`
              }`}
            >
              {!isForUserRegion && !current && (
                <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300">
                  {getRegionLabel(planRegion as Region)}
                </span>
              )}

              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`text-sm font-semibold ${productTextBody}`}>{p.name}</h3>
                  {current && (
                    <span className={`rounded-full border ${grafanaPrimary}/50 ${grafanaPrimaryBg}/10 px-2 py-0.5 text-[11px] font-medium ${grafanaPrimary}`}>
                      {isTrial ? 'on trial' : 'your plan'}
                    </span>
                  )}
                </div>

                <p className="mt-2 flex items-baseline gap-1">
                  <span className={`text-lg font-semibold ${productTextBody}`}>
                    {p.cycle === 'trial' || p.price_minor === 0
                      ? 'Free'
                      : formatPrice(p.price_minor, p.currency)}
                  </span>
                  {p.cycle !== 'trial' && p.price_minor > 0 && (
                    <span className={`text-xs ${productTextMuted}`}>/ month</span>
                  )}
                  {p.cycle === 'trial' && (
                    <span className={`text-xs ${productTextMuted}`}>
                      {p.trial_days ? `for ${p.trial_days} days` : ''}
                    </span>
                  )}
                </p>

                <dl className={`mt-3 space-y-1 text-xs ${productTextMuted}`}>
                  <div className="flex items-center gap-1.5">
                    <dt>Max channels</dt>
                    <dd className={`ml-auto font-mono ${productTextTertiary}`}>
                      {p.max_channels === 'unlimited'
                        ? 'Unlimited'
                        : (p.max_channels ?? 3)}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt>Can earn</dt>
                    <dd className={`ml-auto font-mono ${productTextTertiary}`}>
                      {monetised ? 'Yes' : 'No'}
                    </dd>
                  </div>
                </dl>
              </div>

              <Button
                type="button"
                size="sm"
                disabled={current || busy !== null || p.cycle === 'trial'}
                onClick={() => void subscribe(p.code)}
                className={`mt-4 w-full ${
                  current
                    ? `border ${productSeparation} bg-transparent ${productTextMuted}`
                    : `${grafanaPrimaryBg} text-white ${grafanaPrimaryBg}/85`
                } disabled:opacity-50`}
              >
                {busy === p.code ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : current ? (
                  'Current plan'
                ) : (
                  'Subscribe'
                )}
              </Button>
            </article>
          );
        })}
      </div>

      {plans.length === 0 && !loadError && (
        <p className={`mt-4 text-xs ${productTextMuted}`}>Loading plans…</p>
      )}

      {/* Minimum balance notice - only shown after subscription in T&C */}
      <div className={`mt-6 pt-4 border-t ${productSeparation}`}>
        <p className={`text-xs ${productTextMuted} flex items-center gap-1.5`}>
          <Info className="h-3 w-3" />
          <span>Minimum balance requirement applies after subscription. See Terms & Conditions for details.</span>
        </p>
      </div>
    </section>
  );
}
