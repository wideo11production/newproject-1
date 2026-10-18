'use client';

// ============================================================================
// /alerts - Alerting Box UI with live Alertmanager webhook integration
// BORDERLESS DESIGN SYSTEM - rounded-md compliance
// ============================================================================
//
// DESIGN TOKENS:
//   - Main Monitoring Backdrop Surface: #161616 (Deep Matte Charcoal)
//   - Active Alert Cards & Highlights Panel: #1e1e1e (Elegant Grayish-Black Slate)
//   - Active Alarm / Selected Button Accent: #ff6500 (Solid Orange-Red)
//   - All transitions: 150ms
//   - Zero borders, zero grid lines, zero dividers - background contrast only
//
// Hinglish: Is page mein live Alertmanager alerts dikhte hain. Webhook
// endpoint (/api/alerts/webhook) se alerts receive hoti hain aur yahan
// SuperAdmin Alerting Box UI mein append hoti hain. Sab borders hat gaye,
// sirf background contrast se panels alag hain.

import { useCallback, useEffect, useState } from 'react';
import { XCircle, CheckCircle2, AlertCircle, Bell, RefreshCw } from 'lucide-react';
import { useI18n } from 'wideo11-i18n';
import { useCountry } from 'wideo11-i18n-core';

const BG_MAIN = '#161616';
const BG_PANEL = '#1e1e1e';
const ACCENT_ALARM = '#ff6500';
const TRANSITION_MS = '150ms';

interface Alert {
  id: string;
  alertname: string;
  instance: string;
  job: string;
  severity: 'critical' | 'warning' | 'info';
  state: 'firing' | 'resolved';
  summary: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  generatorURL?: string;
  receivedAt: string;
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return ACCENT_ALARM;
    case 'warning': return '#f59e0b';
    case 'info': return '#3b82f6';
    default: return '#9ca3af';
  }
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const { t } = useI18n();
  const countryCtx = useCountry();

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts/webhook', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Alerts API returned ${res.status}`);
      const data = await res.json();
      setAlerts(data.alerts ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 5000); // Poll every 5s for live alerts
    setPollInterval(id);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  const acknowledge = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/alerts/webhook?id=${id}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      if (res.ok) {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      }
    } catch {
      // Silent - retry on next poll
    }
  }, []);

  const firing = alerts.filter((a) => a.state === 'firing');
  const critical = firing.filter((a) => a.severity === 'critical');

  return (
    <div className="min-h-screen p-4" style={{ backgroundColor: BG_MAIN, color: '#e5e7eb' }}>
      {/* ---- Header ----
           Borderless: background contrast, rounded-md not needed here (full width). ---- */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 px-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bell className="h-5 w-5 text-gray-400" />
            <h1 className="text-lg font-semibold text-white">Alerting Box</h1>
          </div>
          <p className="text-xs text-gray-500">
            Live alerts from Alertmanager (localhost:9093) via webhook
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5" style={{ backgroundColor: BG_PANEL, borderRadius: '6px' }}>
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Country</span>
            <span className="text-xs font-mono text-gray-300">{countryCtx.country}</span>
          </div>
          <button
            onClick={() => { setLoading(true); void fetchAlerts(); }}
            disabled={loading}
            className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors duration-150 hover:text-white"
            style={{
              backgroundColor: BG_PANEL,
              color: loading ? '#6b7280' : undefined,
              border: 'none',
              outline: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* ---- Alert summary banner ----
           Borderless panel: #1e1e1e background, rounded-md. ---- */}
      <div
        className="mb-4 px-4 py-3"
        style={{
          backgroundColor: critical.length > 0 ? ACCENT_ALARM : BG_PANEL,
          borderRadius: '6px',
          transition: `background-color ${TRANSITION_MS} ease`,
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5" style={{ color: critical.length > 0 ? '#ffffff' : '#3b82f6' }} />
            <div>
              <p className={`text-sm font-semibold ${critical.length > 0 ? 'text-white' : 'text-gray-300'}`}>
                {firing.length} ACTIVE {firing.length === 1 ? 'ALERT' : 'ALERTS'}
              </p>
              {critical.length > 0 && (
                <p className="text-xs text-white/90">
                  {critical.length} CRITICAL - requires immediate attention
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>Source: Alertmanager webhook</span>
            <span className="w-px h-3 bg-gray-600" />
            <span>Poll: 5s</span>
          </div>
        </div>
      </div>

      {/* ---- Alert list ----
           Borderless panels: #1e1e1e background, rounded-md, no borders. ---- */}
      <div className="px-4">
        {error ? (
          <div className="rounded-md p-4 text-sm" style={{ backgroundColor: '#7f1d1d', color: '#fca5a5' }}>
            {error}
          </div>
        ) : loading ? (
          <div className="rounded-md p-4 text-sm text-gray-400" style={{ backgroundColor: BG_PANEL }}>
            Loading alerts…
          </div>
        ) : firing.length === 0 ? (
          <div className="rounded-md p-6 text-center text-gray-500" style={{ backgroundColor: BG_PANEL }}>
            <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-green-500" />
            <p className="text-sm">No active alerts</p>
            <p className="text-xs text-gray-600 mt-1">All systems nominal per Alertmanager</p>
          </div>
        ) : (
          <div className="space-y-2">
            {firing.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-3 p-3"
                style={{
                  backgroundColor: alert.severity === 'critical' ? '#7f1d1d' : BG_PANEL,
                  borderRadius: '6px',
                  border: alert.severity === 'critical' ? `1px solid ${ACCENT_ALARM}` : undefined,
                }}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {alert.severity === 'critical' ? (
                    <XCircle className="h-3 w-3 text-red-400" />
                  ) : alert.severity === 'warning' ? (
                    <AlertCircle className="h-3 w-3 text-amber-400" />
                  ) : (
                    <AlertCircle className="h-3 w-3 text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="font-medium text-white truncate">{alert.alertname}</span>
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded`}
                      style={{
                        backgroundColor: severityColor(alert.severity),
                        color: '#ffffff',
                      }}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  {alert.summary && (
                    <p className="text-sm text-gray-300 truncate">{alert.summary}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="font-mono">{alert.instance}</span>
                    <span className="w-px h-3 bg-gray-600" />
                    <span className="font-mono">{alert.job}</span>
                    <span className="w-px h-3 bg-gray-600" />
                    <span>{new Date(alert.startsAt).toLocaleString()}</span>
                    <span className="ml-auto">
                      <button
                        onClick={() => void acknowledge(alert.id)}
                        className="text-[10px] font-medium text-gray-400 hover:text-white transition-colors duration-150"
                        style={{ background: 'none', border: 'none', outline: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        Acknowledge
                      </button>
                    </span>
                  </div>
                  {alert.description && (
                    <p className="text-[10px] text-gray-600 mt-1">{alert.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Resolved alerts (collapsible) ----
           Borderless panel. ---- */}
      {alerts.filter((a) => a.state === 'resolved').length > 0 && (
        <div className="mt-6 px-4">
          <div className="rounded-md p-3" style={{ backgroundColor: BG_PANEL }}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Resolved ({alerts.filter((a) => a.state === 'resolved').length})
            </h3>
            <div className="space-y-1">
              {alerts.filter((a) => a.state === 'resolved').map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center gap-2 px-2 py-1"
                  style={{ backgroundColor: '#161616', borderRadius: '4px' }}
                >
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  <span className="text-xs text-gray-400 truncate">{alert.alertname}</span>
                  <span className="ml-auto text-[10px] text-gray-600 font-mono">
                    {new Date(alert.startsAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}