// Superadmin Dashboard - master control panel
//
// Ye app DEDICATED hai (alag entity) - user app se completely separate.
// Isme hai:
//   1. Click history (persistent, restart-safe, 30-day auto-purge)
//   2. Security events (lockouts, PIN failures, device breaches)
//   3. User activity (sessions, online time, devices)
//   4. Test account cleanup (production cutover)
//
// Hinglish comments: har block ka arth
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  MousePointerClick,
  ShieldAlert,
  Users,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Lock,
  Fingerprint,
  LogIn,
  Clock,
  Database,
} from 'lucide-react';

interface ClickEvent {
  id: string;
  user_email: string;
  page: string;
  target: string;
  label: string;
  x: number;
  y: number;
  ip_address: string;
  timestamp: string;
}

interface ClickStats {
  total_clicks: number;
  clicks_today: number;
  clicks_24h: number;
  unique_users: number;
  top_pages: { page: string; clicks: number }[];
  oldest_event: string | null;
  newest_event: string | null;
  retention_days: number;
  estimated_rows_pending_purge: number;
}

interface SecurityEvent {
  event: {
    id: string;
    email: string;
    event_type: string;
    detail: string;
    ip_address: string;
    timestamp: string;
  };
  critical: boolean;
  indicator: string;
}

interface UserActivity {
  email: string;
  total_sessions: number;
  total_seconds_online: number;
  is_online: boolean;
  distinct_devices: number;
  first_seen: string | null;
  last_seen: string | null;
}

export default function SuperadminDashboard() {
  const [token, setToken] = useState('');
  const [stats, setStats] = useState<ClickStats | null>(null);
  const [clicks, setClicks] = useState<ClickEvent[]>([]);
  const [clickTotal, setClickTotal] = useState(0);
  const [security, setSecurity] = useState<SecurityEvent[]>([]);
  const [activity, setActivity] = useState<UserActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [purging, setPurging] = useState(false);

  // ---- Data load (token chahiye) ----
  const loadAll = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setAuthError('');
    const h = { Authorization: `Bearer ${token}` };

    try {
      // Parallel fetch - sab ek saath
      const [statsRes, clicksRes, secRes, actRes] = await Promise.all([
        fetch('/api/stats', { headers: h, cache: 'no-store' }),
        fetch('/api/clicks?limit=100', { headers: h, cache: 'no-store' }),
        fetch('/api/security', { headers: h, cache: 'no-store' }),
        fetch('/api/activity', { headers: h, cache: 'no-store' }),
      ]);

      if (statsRes.status === 401 || statsRes.status === 403) {
        setAuthError('Invalid or non-superadmin token');
        return;
      }

      if (statsRes.ok) setStats(await statsRes.json());

      if (clicksRes.ok) {
        const d = await clicksRes.json();
        setClicks(d.events ?? []);
        setClickTotal(d.total ?? 0);
      }

      if (secRes.ok) {
        const d = await secRes.json();
        setSecurity(d.events ?? []);
      }

      if (actRes.ok) {
        const d = await actRes.json();
        setActivity(d.activities ?? []);
      }
    } catch {
      setAuthError('Network error');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) loadAll();
  }, [token, loadAll]);

  // ---- Manual purge (30-day retention) ----
  async function handlePurge() {
    setPurging(true);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const res = await fetch('/api/purge-clicks', { method: 'POST', headers: h });
      if (res.ok) {
        const d = await res.json();
        alert(`Purged ${d.deleted} clicks older than ${d.retention_days} days`);
        loadAll();
      }
    } finally {
      setPurging(false);
    }
  }

  // ---- Token screen ----
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900/70 p-8 shadow-2xl">
          <div className="mb-6 flex items-center gap-3">
            <ShieldAlert className="h-7 w-7 text-red-500" />
            <div>
              <h1 className="text-xl font-bold text-white">Wideo11 Superadmin</h1>
              <p className="text-xs text-gray-500">Master control panel</p>
            </div>
          </div>

          <label className="mb-2 block text-sm text-gray-300" htmlFor="token">
            Superadmin access token
          </label>
          <input
            id="token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="eyJhbGciOi..."
            className="h-11 w-full rounded-lg border border-gray-700 bg-gray-950 px-3.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            Get this from the auth-service login endpoint. Only superadmin or recovery
            accounts are accepted.
          </p>
        </div>
      </div>
    );
  }

  const criticalCount = security.filter((e) => e.critical).length;

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-gray-100">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ---- Header ---- */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-7 w-7 text-red-500" />
            <div>
              <h1 className="text-2xl font-bold text-white">Superadmin Dashboard</h1>
              <p className="text-sm text-gray-400">
                Security, click history and user intelligence
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadAll}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
            <button
              onClick={() => setToken('')}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              Sign out
            </button>
          </div>
        </div>

        {authError ? (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 p-4 text-sm text-red-300">
            {authError}
          </div>
        ) : null}

        {/* ---- CRITICAL ALERT ---- */}
        {criticalCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border-2 border-red-600/60 bg-red-950/40 p-4 animate-pulse">
            <ShieldAlert className="h-6 w-6 shrink-0 text-red-600" />
            <div>
              <p className="animate-pulse text-lg font-bold text-red-600">
                {criticalCount} CRITICAL EVENT{criticalCount > 1 ? 'S' : ''}
              </p>
              <p className="text-sm text-red-300">Review the security events below</p>
            </div>
          </div>
        )}

        {/* ---- Stat cards ---- */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard
            label="Total Clicks"
            value={stats?.total_clicks ?? 0}
            icon={<MousePointerClick className="h-5 w-5" />}
            color="text-blue-400"
          />
          <StatCard
            label="Clicks (24h)"
            value={stats?.clicks_24h ?? 0}
            icon={<Activity className="h-5 w-5" />}
            color="text-green-400"
          />
          <StatCard
            label="Unique Users"
            value={stats?.unique_users ?? 0}
            icon={<Users className="h-5 w-5" />}
            color="text-purple-400"
          />
          <StatCard
            label="Security Events"
            value={security.length}
            icon={<ShieldAlert className="h-5 w-5" />}
            color={criticalCount > 0 ? 'text-red-400' : 'text-gray-400'}
          />
          <StatCard
            label="Online Now"
            value={activity.filter((a) => a.is_online).length}
            icon={<Activity className="h-5 w-5" />}
            color="text-emerald-400"
          />
        </div>

        {/* ---- Retention banner ---- */}
        {stats && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-300">
                  Click history auto-purges after {stats.retention_days} days
                </p>
                <p className="text-xs text-gray-500">
                  {stats.estimated_rows_pending_purge} row(s) pending purge • last
                  click{' '}
                  {stats.newest_event ? new Date(stats.newest_event).toLocaleString() : '—'}
                </p>
              </div>
            </div>
            <button
              onClick={handlePurge}
              disabled={purging}
              className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {purging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Purge now
            </button>
          </div>
        )}

        {/* ---- Click history ---- */}
        <Panel
          title="Click History"
          subtitle={`${clickTotal} total events (restart-safe, Postgres-backed)`}
          icon={<MousePointerClick className="h-5 w-5" />}
        >
          {clicks.length === 0 ? (
            <Empty
              icon={<MousePointerClick className="h-8 w-8" />}
              text="No clicks recorded yet"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Page</th>
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {clicks.map((c) => (
                    <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-400">
                        {new Date(c.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-300">
                        {c.user_email || 'anon'}
                      </td>
                      <td className="px-3 py-2 text-xs text-blue-400">{c.page}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs text-gray-400">
                        {c.target}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
                        {c.x},{c.y}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ---- Top pages ---- */}
        {stats && stats.top_pages.length > 0 && (
          <Panel title="Top Pages (7 days)" icon={<Activity className="h-5 w-5" />}>
            <div className="space-y-2">
              {stats.top_pages.map((p) => {
                const max = stats.top_pages[0]?.clicks || 1;
                const pct = (p.clicks / max) * 100;
                return (
                  <div key={p.page} className="flex items-center gap-3">
                    <span className="w-40 truncate font-mono text-xs text-gray-400">
                      {p.page}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs text-gray-300">
                      {p.clicks}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* ---- Security events ---- */}
        <Panel
          title="Security Events"
          subtitle={`${security.length} events`}
          icon={<ShieldAlert className="h-5 w-5" />}
        >
          {security.length === 0 ? (
            <Empty icon={<CheckCircle2 className="h-8 w-8 text-green-600" />} text="No security events" />
          ) : (
            <div className="space-y-2">
              {security.slice(0, 25).map((e) => (
                <div
                  key={e.event.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    e.critical
                      ? 'border-red-800/50 bg-red-950/20'
                      : 'border-gray-800 bg-gray-950/40'
                  }`}
                >
                  <div className={e.critical ? 'text-red-500' : 'text-gray-500'}>
                    {eventIcon(e.event.event_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${e.critical ? 'text-red-300' : 'text-gray-300'}`}>
                      {e.indicator}
                    </p>
                    <p className="text-xs text-gray-500">{e.event.detail}</p>
                    <p className="mt-1 font-mono text-[10px] text-gray-600">
                      {e.event.email} • {new Date(e.event.timestamp).toLocaleString()} • IP{' '}
                      {e.event.ip_address || '—'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ---- User activity ---- */}
        <Panel
          title="User Activity"
          subtitle="Sessions and online time"
          icon={<Users className="h-5 w-5" />}
        >
          {activity.length === 0 ? (
            <Empty icon={<Users className="h-8 w-8" />} text="No activity recorded" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Sessions</th>
                    <th className="px-3 py-2">Online</th>
                    <th className="px-3 py-2">Devices</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((a) => (
                    <tr key={a.email} className="border-b border-gray-800/50">
                      <td className="px-3 py-2 font-mono text-xs text-gray-300">
                        {a.email}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">
                        {a.total_sessions}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">
                        {Math.round(a.total_seconds_online / 60)}m
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">
                        {a.distinct_devices}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            a.is_online
                              ? 'bg-green-900/50 text-green-400'
                              : 'bg-gray-800 text-gray-500'
                          }`}
                        >
                          {a.is_online ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ---- Small presentational components ----

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <div className={`mb-2 flex items-center gap-2 ${color}`}>{icon}</div>
      <p className="font-mono text-2xl font-bold text-white">
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/50">
      <div className="flex items-center gap-2 border-b border-gray-800 px-5 py-3">
        <span className="text-blue-400">{icon}</span>
        <h2 className="font-semibold text-white">{title}</h2>
        {subtitle ? <span className="text-xs text-gray-500">{subtitle}</span> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-gray-500">
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  );
}

function eventIcon(type: string) {
  switch (type) {
    case 'LOCKOUT_TRIGGERED':
      return <Lock className="h-4 w-4" />;
    case 'PIN_FAILED':
      return <Fingerprint className="h-4 w-4" />;
    case 'DEVICE_LIMIT_EXCEEDED':
      return <Users className="h-4 w-4" />;
    case 'CONFIG_TAMPER':
      return <ShieldAlert className="h-4 w-4" />;
    case 'LOGIN_FAILED':
      return <LogIn className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
}
