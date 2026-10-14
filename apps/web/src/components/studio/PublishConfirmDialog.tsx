'use client';

/**
 * PUBLISH CONFIRMATION DIALOG - the gate between "uploaded" and "live".
 *
 * =============================================================================
 * WHY THIS DIALOG EXISTS
 * =============================================================================
 *
 * Automated screening catches what it can measure. It cannot see everything, and
 * the platform's own position is that the channel owner carries the responsibility
 * for what they publish. This dialog is where that is said, in the owner's own
 * language, BEFORE anything goes live - rather than buried in a terms page they
 * accepted once at signup.
 *
 * It is not a formality. It is the record that the owner was told, at the moment of
 * publishing, exactly what they were certifying.
 *
 * =============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 *
 * It does not re-run any check, and it does not display a verdict. The verdict
 * belongs to the backend: putting it here would let a viewer reach this dialog
 * believing an upload was approved when it had not been screened at all. The
 * dialog's only input is an asset that the CALLER has already established is
 * eligible.
 *
 * It also does not ACCEPT liability on the platform's behalf. The wording is a
 * statement of fact about where responsibility already sits, and it is deliberately
 * not softened - a warning that hedges is a warning nobody reads.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ShieldAlert,
  X,
  CheckCircle2,
  Loader2,
  Ban,
  Film,
  Volume2,
  CheckCheck,
  Square,
} from 'lucide-react';

import {
  productAccent,
  productAccentBg,
  productAccentHoverBg,
  productAccentSoftBg,
  productCheckboxChecked,
  productCheckboxUnchecked,
  productDivider,
  productInfo,
  productPanel,
  productPanelHover,
  productPeerFocusRing,
  productSunken,
  productTextBody,
  productTextMuted,
} from '@wideo11/ui/design-system';

/** The statement an owner is certifying, item by item. */
export interface ComplianceItem {
  id: string;
  /** What is being certified. Written as a statement, not a question. */
  title: string;
  /** The detail, in plain language. */
  detail: string;
}

/**
 * The checklist.
 *
 * Each item names ONE prohibited category, and the wording says what the owner is
 * certifying is absent. The list is exhaustive on purpose: an item left out is a
 * category the owner was never told about, and the dialog's whole value is that it
 * told them.
 */
export const COMPLIANCE_ITEMS: ComplianceItem[] = [
  {
    id: 'adultery',
    title: 'Adultery & sexually explicit content',
    detail:
      'Isme koi bhi tarah ka adultery, nudity, pornography, explicit sexual act ya suggestive adult content nahi hai. Main confirm karta/karti hoon ki ye clip is tarah ke kisi content ko contain nahi karta.',
  },
  {
    id: 'child-safety',
    title: 'Child safety',
    detail:
      'Is clip mein child prone / minors ko target karne wala ya unhe harm pahunchane wala koi bhi content nahi hai. Main samajhta/samajhti hoon ki is category ka violation sabse serious maana jayega.',
  },
  {
    id: 'terrorism',
    title: 'Terrorist activities & extremism',
    detail:
      'Isme kisi bhi designated terrorist organisation ya violent extremist group ka symbol, recruitment material, propaganda, manifesto ya unki glorification nahi hai.',
  },
  {
    id: 'drugs',
    title: 'Drugs & illegal substances',
    detail:
      'Isme illegal drugs, narcotics, controlled substances ya prescription medication ka misuse - promotion, sale ya consumption - kisi bhi tarah se nahi dikhaya gaya hai.',
  },
  {
    id: 'violence',
    title: 'Riots & public violence',
    detail:
      'Isme civil unrest, riot, looting ya physical violence ko incite, promote ya glorify karne wala koi content nahi hai.',
  },
  {
    id: 'hate',
    title: 'Hate speech & harassment',
    detail:
      'Isme kisi bhi individual ya group ke against hate speech, harassment, dehumanisation ya targeted abuse nahi hai.',
  },
  {
    id: 'monetisation',
    title: 'Advertiser-friendly & monetisation rules',
    detail:
      'Main samajhta/samajhti hoon ki ye clip platform ki saari monetisation guidelines aur advertiser-friendly content rules ko follow karta hai, aur main iske monetisation restrictions ko maanta/manti hoon.',
  },
  {
    id: 'ownership',
    title: 'Ownership & rights',
    detail:
      'Main confirm karta/karti hoon ki mere paas is clip ke saare rights hain, ya mujhe ise publish karne ke liye valid licence mila hua hai. Isme koi third-party copyright ya trademark violation nahi hai.',
  },
];

interface PublishConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called once the owner has certified everything. */
  onConfirm: () => void | Promise<void>;
  /** The asset being published, for the header line. */
  assetTitle?: string;
  /** Already-published state, to stop a double publish. */
  confirming?: boolean;
  /** Server's refusal, if the publish was rejected after confirming. */
  error?: string | null;
}

export function PublishConfirmDialog({
  open,
  onClose,
  onConfirm,
  assetTitle,
  confirming = false,
  error,
}: PublishConfirmDialogProps) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const dialogRef = useRef<HTMLDivElement>(null);

  // Every item must be checked before the confirm button enables. That is the
  // entire point of the dialog: an owner who can confirm without reading is an
  // owner the dialog failed to inform.
  const allChecked = COMPLIANCE_ITEMS.every((i) => checks[i.id]);
  const checkedCount = COMPLIANCE_ITEMS.filter((i) => checks[i.id]).length;

  // Select-all / clear-all, as ONE button that says what it will do.
  //
  // A single toggle rather than two buttons, because two buttons put "Select all"
  // next to "Clear" and the only thing that changes between them is what state the
  // list is in - and a button that does nothing because the list is already in that
  // state is a button nobody understands.
  //
  // It is a convenience ONLY. Every box still works individually, and the confirm
  // button still refuses until all eight are ticked - so this shortens the clicking
  // and never the reading. That distinction is the whole design: a viewer who ticks
  // all eight with one press has saved seven clicks, and has not skipped anything
  // the dialog was going to make them do.
  const toggleAll = useCallback(() => {
    setChecks((prev) => {
      const next: Record<string, boolean> = {};
      for (const item of COMPLIANCE_ITEMS) {
        // Tick everything if anything was unticked; otherwise clear everything. The
        // third state - "some unticked" - resolves to SELECT, because the goal of
        // the button when it shows "Select all" is a complete list.
        next[item.id] = !allChecked;
      }
      return next;
    });
  }, [allChecked]);

  // Reset on open, so a cancelled attempt does not leave stale ticks behind and
  // let a later confirm sail through on the strength of boxes ticked before.
  useEffect(() => {
    if (open) {
      setChecks({});
    }
  }, [open]);

  // Escape closes, and focus moves into the dialog. Without that, a keyboard user
  // confirming a publish is still tabbing through the page behind the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const toggle = useCallback((id: string) => {
    setChecks((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const submit = useCallback(() => {
    if (allChecked && !confirming) void onConfirm();
  }, [allChecked, confirming, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={confirming ? undefined : onClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dialog-title"
        tabIndex={-1}
        className={`relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl ${productPanel} shadow-2xl shadow-black/60 focus:outline-none`}
      >
        {/* ---- header ---- */}
        <header className={`flex items-start gap-3 border-b ${productDivider} px-5 py-4`}>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${productAccentSoftBg}`}>
            <ShieldAlert className={`h-4 w-4 ${productAccent}`} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="publish-dialog-title"
              className="text-sm font-semibold text-white"
            >
              Publish confirmation — aapki khud ki zimmedari
            </h2>
            <p className={`mt-0.5 text-[11px] ${productTextMuted}`}>
              {assetTitle ? (
                <>
                  <span className={`${productTextBody}`}>{assetTitle}</span> — live karne se pehle har point
                  padhein aur tick karein.
                </>
              ) : (
                'Live karne se pehle har point padhein aur tick karein.'
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={confirming}
            className={`rounded-lg p-1.5 ${productTextMuted} transition-colors ${productPanelHover} hover:text-white disabled:opacity-40`}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* ---- the responsibility statement ----
            The core of the dialog. It is a statement, not a question, and every
            clause names the owner as the responsible party. */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarWidth: 'thin' }}>
          <div className={`mb-4 rounded-xl ${productSunken} p-3.5`}>
            <p className={`text-[12px] leading-relaxed ${productTextBody}`}>
              Main <span className="font-semibold text-white">khud</span> ne is clip ko ache se
              check kiya hai. Ismein kissi bhi tarah ka{' '}
              <span className={`font-semibold ${productAccent}`}>adultery, child prone content</span>,{' '}
              <span className={`font-semibold ${productAccent}`}>terrorist activities</span>{' '}
              ya koi bhi illegal activity —{' '}
              <span className={`font-semibold ${productAccent}`}>drugs</span>, riot ya public violence
              shamil hai — nahi hai.
            </p>
            <p className={`mt-2.5 text-[12px] leading-relaxed ${productTextBody}`}>
              Agar aisa kuch milta hai, to iski{' '}
              <span className="font-semibold text-white">jimmedari puri tarah se mere apne hosh mein
              hai</span>{' '}
              aur main ise apni personal responsibility ke roop mein maanta/manti hoon. Platform
              zimmedari nahi leti.
            </p>
            <p className={`mt-2.5 text-[12px] leading-relaxed ${productTextBody}`}>
              Kisi bhi tarah ki illegal activity ki surat mein{' '}
              <span className="font-semibold text-red-400">legal action</span> aa sakta hai, jiska
              irada <span className="font-semibold text-white">channel owner</span>{' '}
              <span className="font-semibold text-white">wholly responsible</span> hoga.
            </p>
          </div>

          {/* ---- the checklist ---- */}
          <fieldset className="space-y-1.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <legend className={`text-[10px] font-semibold uppercase tracking-wider ${productTextMuted}`}>
                Confirm karne ke liye har point tick karein ({checkedCount}/{COMPLIANCE_ITEMS.length})
              </legend>

              {/* The bulk toggle. It says what pressing it WILL do, so "Select all"
                  and "Clear all" are never ambiguous about the direction. */}
              <button
                type="button"
                onClick={toggleAll}
                aria-label={allChecked ? 'Clear all confirmations' : 'Select all confirmations'}
                className={`flex shrink-0 items-center gap-1 rounded-lg ${productSunken} px-2 py-1 text-[10px] font-medium ${productTextMuted} transition-colors ${productPanelHover} hover:text-white`}
              >
                {allChecked ? (
                  <>
                    <Square className="h-3 w-3" aria-hidden="true" />
                    Clear all
                  </>
                ) : (
                  <>
                    <CheckCheck className="h-3 w-3" aria-hidden="true" />
                    Select all
                  </>
                )}
              </button>
            </div>

            {COMPLIANCE_ITEMS.map((item) => {
              const on = Boolean(checks[item.id]);
              return (
                <label
                  key={item.id}
                  className={`flex cursor-pointer gap-2.5 rounded-xl p-2.5 transition-colors ${
                    on ? `${productAccentBg}/[0.07]` : `${productSunken} ${productPanelHover}`
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(item.id)}
                    className="peer sr-only"
                  />
                  {/* The box is drawn rather than native, so it can take the accent
                      colour consistently across browsers. */}
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${productPeerFocusRing} ${
                      on ? `${productCheckboxChecked} ${productAccentBg}` : `${productCheckboxUnchecked}`
                    }`}
                  >
                    {on ? <CheckCircle2 className="h-3 w-3 text-white" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-white">{item.title}</span>
                    <span className={`mt-0.5 block text-[11px] leading-relaxed ${productTextMuted}`}>
                      {item.detail}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {/* ---- automated screening, said honestly ----
              The owner should know what was checked and what was not, because a
              screening pass that is implied to be total is a lie the platform
              would be telling. */}
          <p className={`mt-4 flex items-start gap-2 rounded-xl ${productSunken} px-3 py-2.5 text-[11px] leading-relaxed ${productTextMuted}`}>
            <Film className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${productInfo}`} aria-hidden="true" />
            <span>
              Is upload par automated screening pehle hi chal chuki hai — frame-by-frame visual checks
              aur line-by-line text checks, bina kisi manual moderation ke. Screening har cheez pakad
              nahi sakti, aur yeh zimmedari aapki hai.
            </span>
          </p>

          {error ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-red-300">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>

        {/* ---- footer ---- */}
        <footer className={`flex items-center justify-end gap-2 border-t ${productDivider} px-5 py-3.5`}>
          <button
            onClick={onClose}
            disabled={confirming}
            className={`rounded-lg ${productSunken} px-4 py-2 text-xs font-medium ${productTextBody} transition-colors ${productPanelHover} disabled:opacity-40`}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!allChecked || confirming}
            title={allChecked ? undefined : 'Confirm karne ke liye saare points tick karein'}
            className={`flex items-center gap-1.5 rounded-lg ${productAccentBg} px-4 py-2 text-xs font-semibold text-white transition-colors ${productAccentHoverBg} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:${productAccentBg}`}
          >
            {confirming ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Publishing…
              </>
            ) : (
              <>
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                Publish — I take full responsibility
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
