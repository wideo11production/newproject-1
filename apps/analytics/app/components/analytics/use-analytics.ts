'use client';

// ============================================================================
// Shared analytics data hook
// ============================================================================
//
// One fetch, one shape, one error path for all six panels. The previous design
// had each panel carrying its own hardcoded array, so there was nothing to
// share - and no single place where "the data failed" could be reported.
//
// The caller's OWN session token is sent. It is never an admin credential, and
// the analytics API route forwards it server-side. A non-superadmin gets 403
// and every panel renders that as an explicit message, not as zeroes.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';

export interface AnalyticsData {
  overview: {
    totalUsers: number;
    totalVerified: number;
    totalUnverified: number;
    totalRegistrations: number;
    signupsByDay: Array<Record<string, unknown>>;
    byDevice: Record<string, number>;
    byBrowser: Record<string, number>;
    byOs: Record<string, number>;
    byCountry: Record<string, number>;
    byContinent: Record<string, number>;
    countriesMissing: number;
  };
  registrations: Array<Record<string, unknown>>;
  clicks: Array<Record<string, unknown>>;
  fetchedAt: string;
}

export interface AnalyticsState {
  data: AnalyticsData | null;
  error: string | null;
  forbidden: boolean;
  loading: boolean;
}

// Matches the Prometheus scrape interval the rest of the dashboards use, so the
// whole platform refreshes on one rhythm.
const REFRESH_MS = 15000;

export function useAnalytics(): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>({
    data: null,
    error: null,
    forbidden: false,
    loading: true,
  });

  // ---- The caller's own session token ----
  //
  // BUG THIS FIXES: the hook originally fetched `/api/analytics` with no
  // -----------------------------------------------------------------------------
  // PEHLE `useAccessToken()` THA - `packages/auth` SE, JO LOCALSTORAGE ME TOKEN
  // RAKHTA THA
  // -----------------------------------------------------------------------------
  //
  // Wo store `accessToken` AUR `refreshToken` dono ko `localStorage` me persist
  // karta tha (`w11-auth` key). Matlab is app par koi bhi XSS, koi bhi compromised
  // extension, ya koi bhi ad script - poora live session uthata tha, refresh token
  // ke saath. httpOnly cookie wahi protection deti hai jo isko bypass karta hai.
  //
  // `auth-service` sirf `Authorization: Bearer` accept karta hai; cookie nahi. To
  // browser ko header banane ke liye token chahiye tha - ye theek hai - lekin token
  // ko STORAGE me rakhna theek nahi tha.
  //
  // Doosra reason bhi tha: har doosra app cookie server-side padhta hai
  // (`apps/video-editor/src/app/api/session/route.ts` wahi karta hai). Ye ek appahi
  // tha jisne token browser storage me rakha, aur usi wajah se `packages/auth`
  // exist karta tha.
  //
  // Ab koi token client side nahi hai. `/api/analytics` server par httpOnly cookie
  // padhta hai aur khud header banata hai. Isliye:
  //   - "token abhi load hua hai" ka state khatam - wahi confusable state jo
  //     signed-in superadmin ko "Sign in to view analytics" dikhata tha
  //   - localStorage me credentials khatam
  //   - `packages/auth` genuinely unused ho gaya, to use DELETE kar diya gaya hai
  //
  // Neeche `forbidden` alag state hai 401 se: "tum superadmin nahi ho" aur "tum
  // signed in nahi ho" do alag problems hain, aur dono ko "sign in" bolna ek ko
  // galat batata hai.

  const load = useCallback(async () => {
    setState((s) => (s.loading ? s : { ...s, loading: true, error: null }));
    try {
      // No Authorization header. The cookie rides along automatically and is
      // read server-side.
      const res = await fetch('/api/analytics', { cache: 'no-store' });
      if (res.status === 403) {
        setState({ data: null, error: null, forbidden: true, loading: false });
        return;
      }
      if (res.status === 401) {
        setState({
          data: null,
          error: 'Sign in to view analytics.',
          forbidden: false,
          loading: false,
        });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({
          data: null,
          error:
            (body as { message?: string }).message ?? `API returned ${res.status}`,
          forbidden: false,
          loading: false,
        });
        return;
      }
      setState({
        data: (await res.json()) as AnalyticsData,
        error: null,
        forbidden: false,
        loading: false,
      });
    } catch (e) {
      setState({
        data: null,
        error: e instanceof Error ? e.message : 'network error',
        forbidden: false,
        loading: false,
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Separate interval effect: re-arming the timer on every dependency change
  // would reset the 15s cadence each time.
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return state;
}
