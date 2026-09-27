// Superadmin Awareness Reports - detailed security/intelligence view
//
// CLICK KARNE PAR YE PAGE KHULEGA - jaisa aapne SPEC kiya tha.
// Master dashboard par sirf ek RED flashing alert dikhta hai, click karne
// par ye detailed page khulta hai.
//
// AVAILABLE DATA (abhi real hai, DB se aata hai):
//   - security_events: login failures, lockouts, PIN failures, device breaches
//   - device_accounts: ek device pe kitne accounts
//   - device_ad_revenue: kitna kamaya, cap/review status
//   - users: kab register kiya
//
// NOT AVAILABLE ABHI (BLOCKER Q4.2 me user ne clarify nahi kiya):
//   - "kitne time se app use kar raha" - watch/session time track nahi hota
//   - "staff hai ya nahi" - User model me role field nahi hai
//
// Hinglish comments: har block ka arth
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert,
  ArrowLeft,
  LogIn,
  Lock,
  Fingerprint,
  Users,
  Wallet,
  RefreshCw,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

interface SecurityEvent {
  event: {
    id: string;
    email: string;
    event_type: string;
    detail: string;
    ip_address: string;
    user_agent: string;
    timestamp: string;
  };
  critical: boolean;
  indicator: string;
}

const EVENT_ICONS: Record<string, React.ReactNode> = {
  LOCKOUT_TRIGGERED: <Lock className="h-4 w-4" />,
  PIN_FAILED: <Fingerprint className="h-4 w-4" />,
  DEVICE_LIMIT_EXCEEDED: <Users className="h-4 w-4" />,
  CONFIG_TAMPER: <ShieldAlert className="h-4 w-4" />,
  LOGIN_FAILED: <LogIn className="h-4 w-4" />,
};

export default function AwarenessReportsPage() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'critical'>('all');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin/awareness', { cache: 'no-store' });
      const data = await res.json();

      if (res.ok) {
        setEvents(data.security_events ?? []);
        setError('');
      } else if (res.status === 401 || res.status === 403) {
        // Auth failure ko "no events" me mix mat karo - user ko login bole
        setError(
          data.message ??
            'Superadmin access required. Sign in with a superadmin account to view these reports.'
        );
        setEvents([]);
      } else {
        setError(data.message ?? 'Failed to load security data');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Filtered events
  const visible = useMemo(
    () => (filter === 'critical' ? events.filter((e) => e.critical) : events),
    [events, filter]
  );

  const criticalCount = events.filter((e) => e.critical).length;

  // Group by email - ek user ki saari activities ek jagah
  const byUser = useMemo(() => {
    const map = new Map<string, SecurityEvent[]>();
    for (const e of visible) {
      const key = e.event.email || 'unknown';
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [visible]);

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-gray-100">
      <div className="mx-auto max-w-6xl">
        {/* ---- Header ---- */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-700 text-gray-400 transition-colors hover:bg-gray-800"
            >
              <ArrowLeft className="h-4 w-4" />
            </a>
            <div>
              <h1 className="text-2xl font-bold text-white">Awareness Reports</h1>
              <p className="text-sm text-gray-400">
                Security intelligence across all accounts and devices
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {/* ---- CRITICAL ALERT (pulsing red - SPEC requirement) ---- */}
        {criticalCount > 0 && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border-2 border-red-600/60 bg-red-950/40 p-4 animate-pulse">
            <ShieldAlert className="h-6 w-6 shrink-0 text-red-600" />
            <div>
              <p className="animate-pulse text-lg font-bold text-red-600">
                {criticalCount} CRITICAL SECURITY EVENT{criticalCount > 1 ? 'S' : ''} DETECTED
              </p>
              <p className="text-sm text-red-300">
                Review the activity below - lockouts, PIN failures and device
                limit breaches
              </p>
            </div>
          </div>
        )}

        {/* ---- Filters ---- */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'border border-gray-700 text-gray-400 hover:bg-gray-800'
            }`}
          >
            All ({events.length})
          </button>
          <button
            onClick={() => setFilter('critical')}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              filter === 'critical'
                ? 'bg-red-600 text-white'
                : 'border border-gray-700 text-gray-400 hover:bg-gray-800'
            }`}
          >
            Critical ({criticalCount})
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          </div>
        ) : byUser.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-gray-500">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
            <p>No security events recorded</p>
          </div>
        ) : (
          /* ---- Per-user breakdown ---- */
          <div className="space-y-4">
            {byUser.map(([email, userEvents]) => (
              <div
                key={email}
                className="rounded-xl border border-gray-800 bg-gray-900/50 p-5"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold text-white">{email}</p>
                    <p className="text-xs text-gray-500">
                      {userEvents.length} event{userEvents.length > 1 ? 's' : ''}
                    </p>
                  </div>
                  {userEvents.some((e) => e.critical) && (
                    <span className="animate-pulse rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      FLAGGED
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {userEvents.map((e) => (
                    <div
                      key={e.event.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 ${
                        e.critical
                          ? 'border-red-800/50 bg-red-950/20'
                          : 'border-gray-800 bg-gray-950/40'
                      }`}
                    >
                      <div
                        className={`mt-0.5 shrink-0 ${
                          e.critical ? 'text-red-500' : 'text-gray-500'
                        }`}
                      >
                        {EVENT_ICONS[e.event.event_type] ?? <ShieldAlert className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-semibold ${
                            e.critical ? 'text-red-300' : 'text-gray-300'
                          }`}
                        >
                          {e.indicator}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">{e.event.detail}</p>
                        <p className="mt-1 font-mono text-[10px] text-gray-600">
                          {new Date(e.event.timestamp).toLocaleString()} • IP{' '}
                          {e.event.ip_address || 'unknown'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---- Data not yet available (honest notice) ---- */}
        <div className="mt-6 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-300">
            <Wallet className="h-4 w-4" />
            Not yet tracked
          </p>
          <ul className="space-y-1 text-xs text-gray-500">
            <li>• Per-user earnings (currently device-level cap only)</li>
            <li>• Time spent on app (no session/watch-time tracking yet)</li>
            <li>• Staff vs regular user (no role field on user model yet)</li>
          </ul>
          <p className="mt-2 text-[10px] text-gray-600">
            Awaiting answers to CLARIFICATIONS.md (Q3, Q4) before building these.
          </p>
        </div>
      </div>
    </div>
  );
}
