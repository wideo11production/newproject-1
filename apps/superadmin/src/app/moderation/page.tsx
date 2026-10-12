'use client';

/**
 * MODERATION REVIEW QUEUE - the human step in the content pipeline.
 *
 * =============================================================================
 * WHY THIS PAGE EXISTS
 * =============================================================================
 *
 * The automated screener (see the `moderation.go` header in the transcoding
 * service) is a heuristic engine that declares its own limits: it catches skin
 * mass, saturated red, motion, loudness and black frames, and it CANNOT catch a
 * clothed suggestive pose, anything semantic, or any spoken word - there is no
 * speech-to-text model in the build.
 *
 * It also deliberately defines a borderline band rather than a binary. A score too
 * high to release and not high enough to refuse is FLAGGED, and flagged means "a
 * person must look".
 *
 * Before this page, that person had nowhere to stand. The service methods existed;
 * no route and no UI did. Every flagged upload sat at `flagged` forever - hidden
 * from the public AND from its own creator, with no reason given anywhere. That is
// a worse failure than refusing it: a refusal tells the creator something, and a
// silent hold tells them nothing at all.
 *
 * =============================================================================
 * THE TWO ACTIONS, AND WHY THERE ARE ONLY TWO
 * =============================================================================
 *
 *	Approve - the video publishes. Recorded with this reviewer's id and their note.
 *	Refuse  - the video stays hidden. Also recorded, also with a note.
 *
 * A human may NOT release a `rejected` asset, and may NOT refuse an `approved`
 * one. That asymmetry is a product decision, not an oversight: releasing a refusal
 * would make the zero-tolerance policy advisory, and un-approving is REMOVAL,
 * which is a different permission. auth-service enforces both and answers 409.
 *
 * =============================================================================
 * WHY A NOTE IS REQUIRED BEFORE THE BUTTONS ENABLE
 * =============================================================================
 *
 * Because the audit row is the answer to "why was this published", and an empty
 * note makes that row indistinguishable from a careless one. The buttons stay
 * disabled until there is something to record - the same
 * `disabled:opacity-50 disabled:pointer-events-none` the rest of the product uses,
 * and the same reasoning: a control that can be pressed once more before the first
 * press lands is a control that can double-fire.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';

type QueueItem = {
  id: string;
  filename: string;
  kind: string;
  status: string;
  moderation_status: string;
  moderation_reason: string;
  moderation_score: number;
  moderation_checks: Record<string, unknown> | null;
  moderated_by: string;
  user_id: string;
  channel_id: string | null;
  duration_seconds: number;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
};

type AuditEntry = {
  id: string;
  provider: string;
  verdict: string;
  confidence: number;
  checks: Record<string, unknown> | null;
  ip_address: string;
  device_fingerprint: string;
  user_agent: string;
  reviewer_note: string;
  created_at: string;
};

/** The state colours, taken from the badges the creators see. */
const STATE_STYLE: Record<string, { ring: string; label: string }> = {
  flagged: {
    ring: 'bg-amber-950/40 text-amber-300',
    label: 'Needs review',
  },
  pending_review: {
    ring: 'bg-yellow-950/40 text-yellow-300',
    label: 'Awaiting screening',
  },
};

export default function ModerationPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [audits, setAudits] = useState<Record<string, AuditEntry[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ---- Load the queue ----
  //
  // One effect keyed on `refreshKey`, so a manual refresh and a post-decision
  // refresh take the same path. No second dependency to keep in sync, and no
  // dependency chain inside the effect that can re-fire it.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/moderation/queue?limit=25`, {
          cache: 'no-store',
        });
        const body = (await res.json().catch(() => ({}))) as {
          items?: QueueItem[];
          total?: number;
          message?: string;
        };
        if (!alive) return;
        if (!res.ok) {
          setError(body.message ?? 'Could not read the review queue.');
          return;
        }
        setItems(body.items ?? []);
        setTotal(body.total ?? 0);
      } catch {
        if (alive) setError('Could not reach the review queue.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  // ---- The audit history, loaded lazily when a row is expanded ----
  //
  // Not fetched with the queue: the history is only read when someone is actually
  // looking at one item, and loading 25 audit trails to render 25 headlines is
  // work that is thrown away for every row nobody opens.
  const loadAudits = useCallback(async (assetId: string) => {
    if (audits[assetId]) {
      setExpanded(expanded === assetId ? null : assetId);
      return;
    }
    try {
      const res = await fetch(`/api/moderation/${assetId}/audits`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { audits?: AuditEntry[] };
      setAudits((prev) => ({ ...prev, [assetId]: body.audits ?? [] }));
      setExpanded(assetId);
    } catch {
      setError('Could not read this asset\'s decision history.');
    }
  }, [audits, expanded]);

  // ---- Decide ----
  const resolve = useCallback(async (assetId: string, approve: boolean) => {
    const text = (note[assetId] ?? '').trim();
    // The same rule the API enforces, checked here so the reviewer is told before
    // they are refused. A client-side copy of a server rule is normally a drift
    // risk; it is worth it here because the alternative is a 409 with no
    // explanation of how to satisfy it.
    if (!text) return;

    setBusy(assetId);
    setError(null);
    try {
      const res = await fetch(`/api/moderation/${assetId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve, note: text }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(body.message ?? 'Could not record that decision.');
        return;
      }
      // Clear the note and refresh: the resolved item is no longer in the queue,
      // which is the visible confirmation that the decision landed.
      setNote((prev) => {
        const next = { ...prev };
        delete next[assetId];
        return next;
      });
      setAudits((prev) => {
        const next = { ...prev };
        delete next[assetId];
        return next;
      });
      setRefreshKey((k) => k + 1);
    } catch {
      setError('Could not reach the service.');
    } finally {
      setBusy(null);
    }
  }, [note]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[#e6e6e6]">
            <ShieldAlert className="h-10 w-10 text-amber-400" />
            Content review
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[#8b949e]">
            These uploads passed the automated screener&apos;s borderline band, so a
            person must decide. Everything here is currently hidden from the
            channel page and from browse. Approving publishes it; refusing keeps it
            hidden. Both are recorded with your name and your note.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-md bg-[#1f2227] px-2.5 py-1 text-xs text-[#8b949e]">
            {total} waiting
          </span>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex items-center gap-1.5 rounded-md bg-[#1f2227] px-2.5 py-1 text-xs text-[#c9d1d9] hover:bg-[#2c3235]"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Refresh
          </button>
        </div>
      </header>

      {/* ---- The empty queue is the good case, so it is not an error ---- */}
      {!loading && items.length === 0 && !error && (
        <div
          role="status"
          className="mt-8 flex flex-col items-center justify-center rounded-lg bg-[#1f2227] py-16 text-center"
        >
          <BadgeCheck className="h-10 w-10 text-emerald-400" />
          <p className="mt-3 text-sm text-[#c9d1d9]">The queue is empty.</p>
          <p className="mt-1 max-w-md text-xs text-[#8b949e]">
            Nothing is waiting for a human decision. Uploads the screener is
            confident about publish on their own; anything outside that band
            appears here.
          </p>
        </div>
      )}

      {loading && (
        <p className="mt-8 flex items-center gap-2 text-xs text-[#8b949e]">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Reading the queue…
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200"
        >
          {error}
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {items.map((item) => {
          const state = STATE_STYLE[item.moderation_status] ?? STATE_STYLE.flagged;
          const isBusy = busy === item.id;
          const noteText = note[item.id] ?? '';

          return (
            <li key={item.id} className="rounded-lg bg-[#1f2227] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${state.ring}`}>
                      {state.label}
                    </span>
                    <span className="truncate text-sm font-medium text-[#e6e6e6]">
                      {item.filename}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#8b949e]">
                    {item.width}&times;{item.height} &middot;{' '}
                    {item.duration_seconds}s &middot; {' '}
                    {Math.round(item.bytes / 1024)} KB &middot; uploaded{' '}
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                  {item.moderation_reason && (
                    <p className="mt-2 max-w-2xl text-xs text-amber-200/80">
                      <AlertTriangle className="mr-1 inline h-2.5 w-2.5" />
                      {item.moderation_reason}
                    </p>
                  )}
                  {item.moderation_score > 0 && (
                    <p className="mt-1 text-xs text-[#8b949e]">
                      Highest confidence {item.moderation_score.toFixed(3)}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void loadAudits(item.id)}
                  className="shrink-0 rounded-md bg-[#16181d] px-2.5 py-1 text-xs text-[#8b949e] hover:text-[#c9d1d9]"
                >
                  {expanded === item.id ? 'Hide history' : 'History'}
                </button>
              </div>

              {/* ---- The decision history ---- */}
              {expanded === item.id && (
                <div className="mt-3 rounded-md bg-[#16181d] p-3">
                  {(audits[item.id] ?? []).length === 0 ? (
                    <p className="text-xs text-[#8b949e]">
                      No decisions recorded yet.
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {(audits[item.id] ?? []).map((a) => (
                        <li key={a.id} className="text-xs text-[#8b949e]">
                          <span className="text-[#c9d1d9]">{a.verdict}</span> by{' '}
                          <span className="font-mono">{a.provider}</span> &middot;{' '}
                          confidence {a.confidence.toFixed(3)} &middot;{' '}
                          {new Date(a.created_at).toLocaleString()}
                          {a.reviewer_note && (
                            <span className="block text-[#c9d1d9]">
                              &ldquo;{a.reviewer_note}&rdquo;
                            </span>
                          )}
                          {/* The uploader's footprint - the part the T&C's
                              law-enforcement clause depends on. IP and device are
                              deliberately NOT editable and NOT copied into any UI
                              a creator sees. */}
                          <span className="block font-mono text-[11px] text-[#6e7681]">
                            ip {a.ip_address || 'n/a'} &middot; device{' '}
                            {a.device_fingerprint || 'n/a'}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* ---- The decision ----
                  The note is required and the buttons are disabled until it is
                  written, so a decision cannot be recorded without a reason. */}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex-1">
                  <span className="sr-only">Reason for your decision</span>
                  <textarea
                    value={noteText}
                    onChange={(e) =>
                      setNote((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    rows={2}
                    placeholder="Why? This is recorded in the audit trail with your name."
                    className="w-full resize-none rounded-md bg-[#16181d] p-2 text-xs text-[#c9d1d9] placeholder:text-[#6e7681] focus:outline-none focus:ring-2 focus:ring-[#5794f2]/40"
                  />
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!noteText.trim() || isBusy}
                    onClick={() => void resolve(item.id, true)}
                    className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {isBusy ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Check className="h-2.5 w-2.5" />
                    )}
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={!noteText.trim() || isBusy}
                    onClick={() => void resolve(item.id, false)}
                    className="flex items-center gap-1.5 rounded-md bg-[#2c3235] px-3 py-2 text-xs font-medium text-[#c9d1d9] disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {isBusy ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <X className="h-2.5 w-2.5" />
                    )}
                    Refuse
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

