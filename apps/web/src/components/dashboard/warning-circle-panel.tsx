"use client";

import { AlertCircle, Bell, Check, ExternalLink, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebSocketClient } from '@/lib/websocket-client';
import { Badge } from '@wideo11/ui/badge';
import {
  grafanaPanel,
  grafanaText,
  grafanaTextMuted,
  grafanaWarning,
  grafanaDanger,
  grafanaWarningBg,
  grafanaDangerBg,
} from '@wideo11/ui/design-system';

export interface SystemAlert {
  id: string;
  name: string;
  severity: 'critical' | 'warning' | 'info';
  state: 'firing' | 'resolved';
  fingerprint: string;
  startsAt: string;
  generatorURL: string;
  labels: Record<string, string> | null;
  annotations: Record<string, string> | null;
}

export type AlertSystem = 'all' | 'restricted';

export interface WarningCirclePanelProps {
  wsUrl?: string;
  showSystem?: AlertSystem;
  maxAlerts?: number;
}

const SEVERITY_ICON: Record<string, React.ElementType> = {
  critical: ShieldAlert,
  warning: AlertCircle,
  info: Bell,
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: grafanaDanger,
  warning: grafanaWarning,
  info: grafanaTextMuted,
};

const SEVERITY_BG: Record<string, string> = {
  critical: grafanaDangerBg,
  warning: grafanaWarningBg,
  info: 'bg-blue-500/10',
};

// Systems considered "restricted" — alerts from these require elevated
// privileges to resolve, so they must be surfaced prominently even to
// non-privileged users who can see the alert exists.
const RESTRICTED_SYSTEMS = new Set<string>([
  'auth-service',
  'billing-service',
  'identity-service',
  'payment-provider',
  'secrets-vault',
]);

function classifyAlert(data: any): SystemAlert | null {
  if (!data || typeof data !== 'object') return null;
  const alert = data as SystemAlert;
  if (!alert.id || !alert.name) return null;
  return alert;
}

function isRestricted(alert: SystemAlert): boolean {
  if (alert.labels && alert.labels['system']) {
    return RESTRICTED_SYSTEMS.has(alert.labels['system']);
  }
  return false;
}

function severityRank(sev: string): number {
  switch (sev) {
    case 'critical': return 0;
    case 'warning': return 1;
    case 'info': return 2;
    default: return 3;
  }
}

/** Dedupe by id and sort severity-desc then newest-first. */
function dedupeSort(alerts: SystemAlert[]): SystemAlert[] {
  return Array.from(new Map(alerts.map((a) => [a.id, a])).values()).sort((a, b) => {
    const s = severityRank(a.severity) - severityRank(b.severity);
    if (s !== 0) return s;
    return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
  });
}

export default function WarningCirclePanel({
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/api/v1/ws',
  showSystem = 'restricted',
  maxAlerts = 15,
}: WarningCirclePanelProps) {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [open, setOpen] = useState(false);
  const [resolvedAck, setResolvedAck] = useState<Record<string, boolean>>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const ws = useMemo(() => WebSocketClient.getInstance(), []);

  // ---- LIVE SOCKET: connect once on mount, tear down on unmount ----
  //
  // Previously this component only SUBSCRIBED to `alert_update`; nothing ever
  // called `ws.connect()`, so the WebSocketClient stayed closed and the bell
  // was permanently empty even though the backend broadcast path existed.
  useEffect(() => {
    ws.connect(wsUrl);
    return () => ws.disconnect();
  }, [ws, wsUrl]);

  // ---- Initial REST seed ----
  //
  // The WS fan-out only carries LIVE events after this tab connects. A user who
  // opens the bell a minute after three alerts fired would otherwise see an
  // empty panel until the next live event. Seed from the same /api/alerts relic
  // (proxied to webhook-receiver) so the panel is truthful on first open, then
  // stay live via `alert_update`.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/alerts?state=firing&limit=50', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((data: { alerts?: any[] }) => {
        if (cancelled) return;
        const seeded = (data.alerts ?? [])
          .map((a) => classifyAlert(a))
          .filter((a): a is SystemAlert => a !== null);
        setAlerts((prev) => {
          const byId = new Map(prev.map((a) => [a.id, a]));
          for (const a of seeded) {
            if (!byId.has(a.id)) byId.set(a.id, a);
          }
          return dedupeSort(Array.from(byId.values()));
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ---- LIVE UPDATES over the WebSocket bus ----
  useEffect(() => {
    return ws.on('alert_update', (data: any) => {
      const alert = classifyAlert(data);
      if (!alert) return;

      setAlerts((prev) => {
        const idx = prev.findIndex((a) => a.id === alert.id);
        let next: SystemAlert[];
        if (idx >= 0) {
          if (prev[idx].state === alert.state && prev[idx].severity === alert.severity) return prev;
          next = [...prev];
          next[idx] = alert;
        } else {
          next = [alert, ...prev];
        }
        next = next.filter((a) => a.state === 'firing').slice(0, maxAlerts);
        return dedupeSort(next);
      });
    });
  }, [ws, maxAlerts]);

  // ---- Focus management ----
  const openPanel = useCallback(() => {
    setOpen(true);
    setTimeout(() => {
      if (panelRef.current) {
        const firstDismissBtn = panelRef.current.querySelector('button[aria-label*="Dismiss"]');
        if (firstDismissBtn) {
          (firstDismissBtn as HTMLElement).focus();
        } else {
          panelRef.current.focus();
        }
      }
    }, 0);
  }, []);

  const closePanel = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  // ---- Escape key handling ----
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closePanel]);

  const visibleAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (showSystem === 'all') return true;
      return isRestricted(a);
    });
  }, [alerts, showSystem]);

  const firingCount = visibleAlerts.length;
  const hasCritical = visibleAlerts.some((a) => a.severity === 'critical');

  const dismiss = (id: string) => {
    setResolvedAck((prev) => ({ ...prev, [id]: true }));
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="relative inline-block">
       <button
         ref={buttonRef}
         type="button"
         onClick={openPanel}
         className={`
           relative flex items-center justify-center rounded-full p-2 ${hasCritical ? 'bg-red-500/20' : 'bg-yellow-400/10'} border border-gray-700/50 text-${hasCritical ? 'red' : 'yellow'}-400 hover:bg-yellow-400/20 transition-colors
         `}
         aria-label="System alerts"
         aria-expanded={open}
         aria-haspopup="true"
       >
        <Bell className="h-5 w-5" />
        {firingCount > 0 && (
           <span
             className={`
               absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full text-[10px] font-bold ${hasCritical ? 'bg-red-500' : 'bg-yellow-400'} text-black
             `}
           >
             {firingCount}
           </span>
        )}
      </button>

      {open && (
        <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.preventDefault();
                closePanel();
              }}
              aria-hidden="true"
            />
            <div
               ref={panelRef}
               tabIndex={-1}
              className={`
                absolute z-50 mt-2 w-80 max-w-[90vw] ${grafanaPanel} border border-gray-700 shadow-xl backdrop-blur-sm
              `}
            >
            <div className="border-b border-gray-700 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className={`h-4 w-4 ${hasCritical ? 'text-red-400' : 'text-yellow-400'}`} />
                  <span className={`text-sm font-medium ${grafanaText}`}>
                    {showSystem === 'all' ? 'System Alerts' : 'Restricted System Alerts'}
                  </span>
                </div>
                {firingCount > 0 && (
                   <span
                     className={`
                       h-2 w-2 rounded-full ${hasCritical ? 'animate-pulse bg-red-500' : 'animate-pulse bg-yellow-400'}
                     `}
                   />
                )}
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto custom-scrollbar">
              {firingCount === 0 ? (
                <div className="p-3 text-center">
                  <Bell className={`mx-auto h-6 w-6 ${grafanaTextMuted} mb-1`} />
                  <p className={`text-xs ${grafanaTextMuted}`}>No active alerts</p>
                </div>
              ) : (
                <div className="border-0">
                  {visibleAlerts.map((alert) => {
                    const Icon = SEVERITY_ICON[alert.severity] || Bell;
                    const colorClass = SEVERITY_COLOR[alert.severity] || grafanaTextMuted;
                    const bgClass = SEVERITY_BG[alert.severity] || 'bg-gray-500/10';

                    if (resolvedAck[alert.id]) return null;

                    return (
                      <div key={alert.id} className="p-3">
                        <div className="flex items-start gap-2">
                          <div className={`flex-shrink-0 ${bgClass} rounded p-1`}>
                            <Icon className={`h-4 w-4 ${colorClass}`} />
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <span className={`text-sm font-medium ${grafanaText}`}>
                                {alert.name}
                              </span>
                              <Badge
                                variant={
                                  alert.severity === 'critical'
                                    ? 'destructive'
                                    : alert.severity === 'warning'
                                    ? 'default'
                                    : 'secondary'
                                }
                                className="text-[10px]"
                              >
                                {alert.severity}
                              </Badge>
                            </div>
                            {alert.labels && Object.keys(alert.labels).length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(alert.labels).map(([k, v]) => (
                                  <span
                                    key={k}
                                    className={`text-[10px] ${grafanaTextMuted} bg-gray-800/50 rounded px-1.5 py-0.5`}
                                  >
                                    {k}: {v}
                                  </span>
                                ))}
                              </div>
                            )}
                            {alert.annotations && alert.annotations['description'] && (
                              <p className={`text-xs ${grafanaTextMuted} line-clamp-2`}>
                                {alert.annotations['description']}
                              </p>
                            )}
                            <div className="flex items-center justify-between">
                              <span className={`text-[10px] ${grafanaTextMuted}`}>
                                {new Date(alert.startsAt).toLocaleString()}
                              </span>
                              {alert.generatorURL && (
                                <a
                                  href={alert.generatorURL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`text-[10px] ${grafanaWarning} hover:text-yellow-300 flex items-center gap-0.5`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Source
                                </a>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => dismiss(alert.id)}
                            className={`flex-shrink-0 rounded p-0.5 ${grafanaTextMuted} hover:text-ink hover:bg-gray-700`}
                            aria-label={`Dismiss ${alert.name}`}
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
