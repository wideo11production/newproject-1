'use client';

// The trial countdown.
//
// =============================================================================
// WHAT THIS SHOWS, AND WHY IT ONLY APPEARS UNDER AN HOUR
// =============================================================================
//
// Two states, deliberately not one:
//
//   UNDER AN HOUR   a live ticking timer. Amber, prominent, the point of the
//                   component.
//   OVER AN HOUR    a quiet line: "your trial ends in 2 days". Present, because a
//                   user who does not know when it ends cannot plan, and absent
//                   urgency here is bought with a banner nobody reads.
//
// The threshold is the SERVER's decision (`trial_expiring_soon`), not this
// component's. If each client picked its own, the dashboard, an email and a future
// mobile app would start warning at three different moments.
//
// =============================================================================
// WHY THE SERVER SUPPLIES THE SECONDS AND THIS ONLY TICKS THEM
// =============================================================================
//
// The response carries `expires_in_seconds`, computed ONCE, server-side.
//
// Recomputing it here as `expiresAt - Date.now()` would be wrong twice over:
//
//   - the browser's clock disagrees with the server's by the network round trip and
//     by whatever the device thinks the time is, so the countdown visibly jumps on
//     every load
//   - a user whose clock is minutes fast sees a timer that starts in the past
//
// So the server decides WHEN, and this only counts down from that number. The
// ticking is a local decrement, which cannot disagree with anything.
//
// And it never reaches zero and stops: at zero it refreshes from the server, so
// the displayed figure stays truthful rather than counting into negatives.
//
// =============================================================================
// WHY THERE IS NO "REQUEST ANOTHER TRIAL" BUTTON
// =============================================================================
//
// Because the product's decision is one trial per account, and a button that can be
// pressed twice is not a rule — it is a suggestion. Every implementation of a
// self-service re-trial is a bypass with extra steps, because the policy then lives
// only in that code path and whoever reaches it differently gets another trial.
//
// An operator granting a trial is already built, audited, and attributed to a
// person: `POST /admin/entitlements`. That is where the decision belongs.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface MyPlan {
  plan: string;
  plan_name: string;
  has_plan: boolean;
  is_trial: boolean;
  /** ISO string, or null for a lifetime plan. Display only — not counted from. */
  expires_at: string | null;
  /** Server-computed seconds remaining. -1 means "never expires". */
  expires_in_seconds: number;
  trial_expiring_soon: boolean;
  limits: Record<string, number | 'unlimited'>;
  error?: string;
}

const ONE_HOUR = 3600;

/** `2d 4h`, `4h 12m`, `12m 05s` — coarse above an hour, precise below it. */
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

export function TrialCountdown() {
  const [plan, setPlan] = useState<MyPlan | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  // A ref, not state: the 1s tick must not re-render anything except the number,
  // and a state counter would re-render the whole dashboard once a second.
  // ReturnType<typeof setInterval> rather than a bare `number`: in a DOM build that
  // is a number, and under Node's typings it is a Timeout object. Naming the real
  // type is the difference between compiling in both and compiling in one.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/my-plan', { cache: 'no-store' });
      const body = (await res.json()) as MyPlan;
      setPlan(body);
      setRemaining(body.expires_in_seconds >= 0 ? body.expires_in_seconds : null);
    } catch {
      // Silent. A plan banner that throws an error into the console on every load
      // trains people to ignore the console, which is where real errors go.
      setPlan(null);
    }
  }, []);

  useEffect(() => {
    void load();

    // Re-read once a minute so the figure stays truthful over a long tab life.
    //
    // Once a MINUTE, not once a second: the visible countdown is driven by the local
    // tick below, and a server call every second would be one request per second per
    // open tab for no accuracy gain.
    const poll = setInterval(() => void load(), 60_000);

    return () => clearInterval(poll);
  }, [load]);

  // ---- The visible tick ----
  useEffect(() => {
    if (remaining === null) return;

    tickRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          // Reached zero: ask the SERVER rather than counting into negatives. It
          // will either confirm zero or report a renewed plan, and a local
          // decrement can do neither.
          void load();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [remaining === null, load]);

  // ---- Nothing to say ----
  //
  // Not a plan at all, or a plan with no expiry: a lifetime grant, or the request
  // failed. Either way there is no countdown, and a "0s remaining" banner for a
  // lifetime plan would be a lie.
  if (!plan || !plan.has_plan || remaining === null) return null;

  const urgent = plan.trial_expiring_soon || remaining <= ONE_HOUR;

  // ---- Under an hour: the live timer ----
  if (urgent) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-950/30 p-4"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
        </span>

        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200">
            {plan.is_trial ? 'Your trial is almost over' : 'Your plan expires soon'}
          </p>
          <p className="text-xs text-amber-300/80">
            {remaining <= 0
              ? 'Checking with the server…'
              : `${formatRemaining(remaining)} remaining on ${plan.plan_name}`}
          </p>
        </div>

        {/*
          No re-trial button, on purpose. See the header. An operator grants one via
          the admin surface, which is audited and attributed to a person.
        */}
        <a
          href="/dashboard/plans"
          className="ml-auto shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
        >
          View plans
        </a>
      </div>
    );
  }

  // ---- Over an hour: one quiet line ----
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-2.5 text-xs text-gray-400">
      <span className="font-medium text-gray-300">{plan.plan_name}</span>
      <span aria-hidden="true">·</span>
      <span>
        {plan.is_trial ? 'trial ends' : 'renews'} in{' '}
        <span className="font-mono text-gray-200">{formatRemaining(remaining)}</span>
      </span>
      {plan.limits.media_assets !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {plan.limits.media_assets === 'unlimited'
              ? 'unlimited uploads'
              : `${plan.limits.media_assets} uploads`}
          </span>
        </>
      )}
      <a href="/dashboard/plans" className="ml-auto text-gray-400 underline-offset-2 hover:text-gray-200 hover:underline">
        Manage
      </a>
    </div>
  );
}
