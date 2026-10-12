'use client';

/**
 * TERMS & CONDITIONS DIALOG  -  channel creation ke liye MANDATORY gate.
 *
 * =============================================================================
 * YE DIALOG KYUN ZAROORI HAI
 * =============================================================================
 *
 * Har channel (free ya paid) bante waqt creator ko ye samajhna zaroori hai:
 *
 *   1. Ads sab channel par dikhenge - free ho ya paid.
 *   2. Earning SIRF active paid subscription wale channel par hogi.
 *   3. Subscription khatam + payment na hui toh us dauran ki koi earning nahi.
 *   4. Ek samay par max 3 channels, aur har channel ki apni subscription.
 *
 * Ye CHECKBOX sirf UX nahi hai - backend par `tc_accepted` field store hoti hai
 * (`migrations/029_channel_tc_acceptance.sql`). Iske bina channel create hi
 * nahi hoga: `CreateChannel` service `ErrTCNotAccepted` return karta hai.
 *
 * =============================================================================
 * BLOCKING, DISMISSIBLE
 * =============================================================================
 *
 * Backdrop click se band NAHI hota, sirf:
 *   - "Accept & Continue" (checkbox checked hone par)
 *   - "Cancel"
 *
 * Ye deliberate hai. Ek accidental backdrop click se T&C accept ho jana
 * (ya form gayab ho jana) dono galat hain.
 *
 * Hinglish comments: har block ka arth
 */

import { useEffect, useState } from 'react';
import { FileText, ShieldCheck, X } from 'lucide-react';
import { Button } from '@wideo11/ui/button';

/**
 * Current T&C version. Jab bhi T&C ka text badle, ye bump karo.
 *
 * Backend isko `tc_accepted_version` column me store karta hai, taaki
 * "kis text par creator ne agree kiya" hamesha answerable rahe.
 *
 * ---- WHY THE VERSION BUMPS WITH THE CONTENT POLICY ----
 *
 * A T&C version is the answer to "what text did this creator agree to". When the
 * content-policy clauses below were added, anyone who had NOT accepted them had
 * accepted a document that predated their obligations - and a zero-tolerance
 * policy a user never agreed to is not enforceable against them.
 *
 * So this goes to v2, and `tc_accepted_version` now records which of the two a
 * channel was created under. Existing channels show the old version and, if the
 * product requires the new one, can be routed to re-accept.
 */
export const TC_VERSION = '2026-10-v2';

/** Detailed T&C page ka URL. Abhi placeholder - baad me full page banega. */
const DETAILED_TC_URL = '/terms';

type Props = {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
};

export function ChannelTermsDialog({ open, onAccept, onCancel }: Props) {
  const [accepted, setAccepted] = useState(false);

  // Reset jab dialog dobara khule. Ek stale "accepted" checkbox ka matlab
  // hai ki ek channel create karne ke baad doosre par checkbox already
  // checked dikhega - jo ek naya consent nahi hai.
  useEffect(() => {
    if (open) setAccepted(false);
  }, [open]);

  // Escape = cancel. Backdrop click NAHI (dekho file header).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tc-dialog-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-[#2c3235] bg-[#16181d] shadow-xl">
        {/* ---- Header ---- */}
        <div className="flex items-start justify-between border-b border-[#2c3235] p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-2.5 w-2.5 text-[#5794f2]" />
            <h2 id="tc-dialog-title" className="text-sm font-semibold text-[#e6e6e6]">
              Channel Terms &amp; Conditions
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="rounded p-1 text-[#8b949e] transition-colors hover:bg-[#1f2227] hover:text-[#e6e6e6]"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>

        {/* ---- Body ---- */}
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
          <p className="text-xs text-[#9fa7b3]">
            Channel banane se pehle in baaton par sehet len a zaroori hai. Ye
            same rules free aur paid dono channel par lagu hote hain.
          </p>

          {/* 1. Ads + Earning policy */}
          <section className="rounded-md bg-[#0d0f11] p-3">
            <h3 className="mb-1 text-xs font-semibold text-[#e6e6e6]">
              1. Ads &amp; Earning Policy
            </h3>
            <p className="text-xs leading-relaxed text-[#c9d1d9]">
              Mere chahe Free channel hon ya Paid channel, sabhi par ads
              dikhaye jayenge. Earning sirf unhi channels par hogi jinki active
              paid subscription li gayi hai.
            </p>
          </section>

          {/* 2. Expired subscription */}
          <section className="rounded-md bg-[#0d0f11] p-3">
            <h3 className="mb-1 text-xs font-semibold text-[#e6e6e6]">
              2. Expired Subscription
            </h3>
            <p className="text-xs leading-relaxed text-[#c9d1d9]">
              Agar subscription khatam ho jati hai aur payment nahi hoti, toh
              us dauran hone wali views/activity ki koi earning ya claim mujhe
              nahi milega. Earning sirf payment ke baad se hi dobara active
              hogi.
            </p>
          </section>

          {/* 3. Channel limit */}
          <section className="rounded-md bg-[#0d0f11] p-3">
            <h3 className="mb-1 text-xs font-semibold text-[#e6e6e6]">
              3. Channel Limit
            </h3>
            <p className="text-xs leading-relaxed text-[#c9d1d9]">
              Main ek samay par maximum 3 channels tak manage kar sakta hoon
              aur har channel ke liye alag subscription/minimum balance ka
              niyam lagu hoga.
            </p>
          </section>

          {/* ==================================================================
              4-7. CONTENT POLICY — the legal clauses.

              These four are not product copy, they are the platform's exposure.
              A "zero tolerance" promise with no text behind it is unenforceable,
              and a user who never agreed to screening cannot be screened.

              They are placed in the SAME acceptance gate as the earning rules
              deliberately: consent to the content policy and consent to the
              earning model are one act, so a channel cannot exist under one
              without the other.
              ================================================================== */}

          {/* 4. Zero tolerance */}
          <section className="rounded-md bg-[#0d0f11] p-3">
            <h3 className="mb-1 text-xs font-semibold text-[#e6e6e6]">
              4. Zero-Tolerance Content Policy
            </h3>
            <p className="text-xs leading-relaxed text-[#c9d1d9]">
              Is platform par adult/NSFW content, illegal drugs ya controlled
              substances, aur terrorist/extremist activity ko promote karne ke
              liye <strong className="text-[#e6e6e6]">zero-tolerance</strong>{' '}
              policy hai. Aisa koi bhi content upload, share ya promote karna
              sakht mana hai.
            </p>
          </section>

          {/* 5. Right to screen */}
          <section className="rounded-md bg-[#0d0f11] p-3">
            <h3 className="mb-1 text-xs font-semibold text-[#e6e6e6]">
              5. Right to Screen &amp; Remove
            </h3>
            <p className="text-xs leading-relaxed text-[#c9d1d9]">
              Meri upload ki gayi kisi bhi content ko platform apni marzi se
              monitor, scan, screen, modify karne, approval rokne ya permanently
              delete karne ka adhikar rakhta hai — bina koi prior notice diye.
              Automated screening ka use kiya ja sakta hai, aur uska result
              final nahi hota; kuch cases human moderator review karta hai.
            </p>
          </section>

          {/* 6. Account suspension */}
          <section className="rounded-md bg-[#0d0f11] p-3">
            <h3 className="mb-1 text-xs font-semibold text-[#e6e6e6]">
              6. Account Suspension &amp; Legal Action
            </h3>
            <p className="text-xs leading-relaxed text-[#c9d1d9]">
              Content guidelines ki karokram tootne par mera account immedietly
              permanently band kiya ja sakta hai, acche ki earning forfeit ho
              sakti hai, aur meri credentials/device details ko relevant law
              enforcement agencies ko diya ja sakta hai.
            </p>
          </section>

          {/* 7. Liability */}
          <section className="rounded-md bg-[#0d0f11] p-3">
            <h3 className="mb-1 text-xs font-semibold text-[#e6e6e6]">
              7. User Liability &amp; Indemnification
            </h3>
            <p className="text-xs leading-relaxed text-[#c9d1d9]">
              Jo content main upload karta hoon uski poori zimmedari meri hai.
              Platform user-generated content ki kisi bhi legal consequence ke
              liye zimmedaar nahi hai, aur main platform ko is seam me bachane
              ke liye zimmedaar hoon.
            </p>
          </section>

          {/* ---- Detailed T&C link ---- */}
          <a
            href={DETAILED_TC_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-[#5794f2] underline hover:no-underline"
          >
            <FileText className="h-2.5 w-2.5" />
            Detailed Terms &amp; Conditions padhein
          </a>
        </div>

        {/* ---- Footer: checkbox + actions ---- */}
        <div className="space-y-3 border-t border-[#2c3235] p-4">
          <label className="flex cursor-pointer items-start gap-2 text-xs text-[#c9d1d9]">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#5794f2]"
              data-testid="tc-checkbox"
            />
            <span>
              Main upar ki saari conditions padh chuka hoon — earning policy,
              content zero-tolerance policy, screening rights, aur legal
              liability — aur in sab ko accept karta hoon.
            </span>
          </label>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="border-[#2c3235] text-[#c9d1d9] hover:bg-[#1f2227]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!accepted}
              onClick={onAccept}
              className="bg-[#5794f2] text-white hover:bg-[#5794f2]/85 disabled:opacity-40"
              data-testid="tc-accept"
            >
              Accept &amp; Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
