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
import { useAccessToken } from 'wideo11-auth';

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
  // Authorization header at all. The route correctly forwards the caller's
  // token to auth-service - and correctly received nothing, so it returned
  // 401 and the dashboard said "Sign in to view analytics" for a user who WAS
  // signed in.
  //
  // The symptom is nasty because it looks right: the sign-in banner is
  // accurate as a sentence, just not as a diagnosis.
  //
  // Note this is the USER's token, not a superadmin credential. The admin
  // token never enters the browser - the route relays whatever the caller
  // sends, and a non-superadmin still gets 403 from auth-service.
  const accessToken = useAccessToken();

  const load = useCallback(async () => {
    // No token yet means the store has not rehydrated from localStorage, NOT
    // that the user is signed out. Treating those two states the same is what
    // produced a dashboard that told a signed-in superadmin "Sign in to view
    // analytics" - a sentence that is grammatically true and diagnostically
    // false.
    if (!accessToken) {
      setState((s) => (s.loading ? s : { ...s, loading: true, error: null }));
      return;
    }
    try {
      const res = await fetch('/api/analytics', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
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
          error: (body as { message?: string }).message ?? `API returned ${res.status}`,
          forbidden: false,
          loading: false,
        });
        return;
      }
      setState({ data: (await res.json()) as AnalyticsData, error: null, forbidden: false, loading: false });
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
  }, [load, accessToken]);

  // Separate interval effect: re-arming the timer on every token change would
  // reset the 15s cadence each time.
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return state;
}
