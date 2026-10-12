'use client';

/**
 * MODERATION BADGE - what the automated screener decided about one upload.
 *
 * =============================================================================
 * THE PROBLEM THIS SOLVES
 * =============================================================================
 *
 * The backend withholds a video whose `moderation_status` is not `approved`. It
// withholds it correctly - the channel page's query filters it out, the browse
 * view excludes it from the card thumbnail, and no public surface shows it.
 *
 * The result was a creator whose upload panel showed a green "Uploaded" while the
 * video was nowhere on their channel. Nothing in the product explained the gap, so
 * the creator concluded the upload failed - and for a 4 GB 4K file that means
 * re-uploading everything, or support, or giving up.
 *
// =============================================================================
// WHAT THE BADGE SAYS
 * =============================================================================
//
// Three states, each naming what happens NEXT rather than what went wrong:
//
//	pending_review - being screened. Appears on its own once approved.
//	flagged        - a person is looking, because the screener was not certain.
//	rejected       - will not appear, with the reason from the server.
//
// The wording is about the outcome, not the violation. "This upload is being
 * screened" answers the creator's actual question ("where is my video"), and it
 * does it without accusing them.
 *
// =============================================================================
// WHY `approved` AND `not_required` RENDER NOTHING
 * =============================================================================
//
// They are the normal case. A badge for a state that means "everything is fine" is
 * noise on every successful upload, and a badge nobody looks at is a badge that
 * gets ignored - including the one that matters.
 */

import { AlertTriangle, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import type { MediaAsset } from '@/lib/media-upload';

/** The three states a creator needs explaining, in the badge's own words. */
const STATES: Record<
  string,
  { icon: typeof Clock; className: string; title: string }
> = {
  pending_review: {
    icon: Clock,
    className: 'bg-yellow-950/50 text-yellow-300 border-yellow-800/60',
    title: 'Being screened',
  },
  flagged: {
    icon: ShieldAlert,
    className: 'bg-amber-950/50 text-amber-300 border-amber-800/60',
    title: 'Waiting for a human review',
  },
  rejected: {
    icon: AlertTriangle,
    className: 'bg-red-950/50 text-red-300 border-red-800/60',
    title: 'Not approved',
  },
};

export function ModerationBadge({ asset }: { asset: MediaAsset }) {
  const state = asset.moderation_status;
  // `approved` and `not_required` are the normal case and render nothing.
  // `not_required` is for technical assets that were never screened.
  if (!state || state === 'approved' || state === 'not_required') return null;

  const def = STATES[state];
  // An unknown state is a new backend value this UI has not caught up with.
  // Rendering nothing hides it, which is worse than showing a neutral "in review"
  // - so the safest unknown falls through to the pending wording.
  const fallback = STATES.pending_review;
  const { icon: Icon, className, title } = def ?? fallback;

  return (
    <div
      role="status"
      className={`mx-auto flex max-w-md items-start gap-2 rounded-md border px-3 py-2 text-left text-xs ${className}`}
    >
      <Icon className="mt-0.5 h-2.5 w-2.5 shrink-0" />
      <div>
        <p className="font-medium">{title}</p>
        {/* The reason from the server, verbatim when present. A generic sentence is
            worse than a specific one here: "awaiting moderation" tells the creator
            nothing they can act on, and the backend already wrote the specific
            reason for exactly this display. */}
        {asset.moderation_reason ? (
          <p className="mt-0.5 opacity-90">{asset.moderation_reason}</p>
        ) : (
          <p className="mt-0.5 opacity-90">
            {state === 'rejected'
              ? 'This upload will not appear on your channel page.'
              : 'It will appear on your channel page once the check completes. ' +
                'Your storage and duration are unaffected.'}
          </p>
        )}
        {state === 'rejected' && (
          <p className="mt-1 opacity-75">
            All uploads are screened automatically before publishing. If you
            believe this was a mistake, contact support and quote this upload.
          </p>
        )}
      </div>
    </div>
  );
}

