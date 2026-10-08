/**
 * ============================================================================
 * SEMANTIC INTERACTIVE Q&A PORTAL - accessible accordion
 * ============================================================================
 *
 * REQUIRED TOPICS (spec - chaaron explicitly answer hone chahiye):
 *   1. Account verification conditions
 *   2. Automated GST structures
 *   3. Device logging behaviors for custom nodes like "crack if u can"
 *   4. The strict ₹2,000 nominee maintenance buffer protection logic
 *
 * ACCESSIBILITY (WCAG AA, Radix-backed):
 *   - Radix `<Accordion>` gives us proper `aria-expanded`, `aria-controls`,
 *     keyboard nav (arrow keys between triggers, Enter/Space to toggle)
 *   - `type="single" collapsible` - ek time pe ek item khula
 *   - Trigger has visible focus ring
 *   - Content animation respects reduced motion (Radix data-state)
 *
 * WHY RADIX (not hand-rolled <details>):
 *   - `<details>/<summary>` styling inconsistent cross-browser, aur keyboard
 *     nav limited hota hai
 *   - Radix already `packages/ui/src/accordion.tsx` me packaged hai
 *
 * GROUNDING NOTE (important - honest framing):
 *   Ye answers project ke ACTUAL configured rules se likhe gaye hain, jo
 *   `.env` me hain. Jahan spec ne number diya hai (GST, ₹2000 buffer, 12-char
 *   password), wahi use kiya gaya hai. Jahan koi rule abhi SANDBOX/placeholder
 *   hai (e.g. GST registration threshold), wo answer me clearly mention kiya
 *   gaya hai - jaise ki misleading marketing copy nahi.
 *
 * Hinglish comments: har block ka arth
 */

'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@wideo11/ui/accordion';
import { HelpCircle, ShieldCheck, Receipt, Cpu, PiggyBank } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';

/**
 * FAQ ENTRIES - static data.
 *
 * `type="single" collapsible` me pehla item default open nahi rakhte -
 * accordion tab se collapse hota hai (kam clutter).
 *
 * `icon` - Lucide component, category visual.
 */
const FAQ_ENTRIES: ReadonlyArray<{
  id: string;
  question: string;
  answer: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    id: 'verification',
    question: 'What are the account verification conditions?',
    answer:
      'Verification is email-based and has three conditions. First, you must confirm the address within 30 minutes of registering - the link expires and an unconfirmed account is permanently purged, freeing the email for re-registration. Second, your password must be at least 12 characters. Third, your email address must be unique across the platform. There is no manual approval queue and no paid ID-verification step, so the whole process is automatic once you click the link.',
    icon: ShieldCheck,
    accent: '#73bf69',
  },
  {
    id: 'gst',
    question: 'How does the automated GST structure work?',
    answer:
      'GST is handled on the settlement side, not the upload side. Every payout run writes its own GST line item to the ledger alongside the viewer, creator, and platform splits, so the tax component is traceable per settlement rather than estimated at month end. Important caveat: the GST registration threshold and the exact filing schedule are currently sandbox values on our side - they are configurable and will reflect your live business settings once the company is formally registered. Your ledger export is the source of truth for what was actually withheld.',
    icon: Receipt,
    accent: '#f2cc0c',
  },
  {
    id: 'device-logging',
    question: 'What gets logged when I sign in, and how is that used?',
    answer:
      'We log a device fingerprint on registration and login: device name, type, platform, browser, and a fingerprint hash. This exists to enforce the three-accounts-per-device rule and to support suspicious-login reviews. To be direct about the security posture, we are not claiming this fingerprinting is unbreakable. Researchers are actively probing that assumption - if you are testing the boundary, good, and please do not treat a successful probe as permission to farm accounts. Detection, rate limiting, and manual review are layered on top, and a flagged device is reviewed rather than silently trusted. We would rather tell you this plainly than pretend the system is unbypassable.',
    icon: Cpu,
    accent: '#f2495c',
  },
  {
    id: 'nominee-buffer',
    question: 'How is the ₹2,000 nominee maintenance buffer protected?',
    answer:
      'The ₹2,000 buffer is a hard floor on your withdrawable balance, not a fee. It is masked in the ledger so you can always see your true position and what is protected. On every settlement run the system checks the post-payout balance: if a payout would drop you below the floor, it is reduced or held rather than executed. Because it is enforced at settlement time, the buffer cannot be consumed by a race condition or a concurrent withdrawal. Minimum plan balances (₹1,000 in India, $150 in high-currency markets, $300 in low-currency markets) are enforced separately at plan activation.',
    icon: PiggyBank,
    accent: '#60a5fa',
  },
];

/**
 * FAQ_PORTAL - the section.
 */
export function FaqPortal({ className }: { className?: string }) {
  return (
    <section
      className={cn('w-full bg-[#111217] py-16 sm:py-20', className)}
      aria-labelledby="faq-heading"
    >
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        {/* ---- SECTION HEADER ---- */}
        <div className="flex items-start gap-3">
          {/* FAQ icon - decorative, heading text already labels the section */}
          <HelpCircle className="mt-1 h-7 w-7 shrink-0 text-[#5794f2]" aria-hidden="true" />
          <div>
            <h2
              id="faq-heading"
              className="text-2xl font-bold tracking-tight text-[#d8d9da] sm:text-3xl"
            >
              Frequently asked questions
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#9fa7b3] sm:text-base">
              The rules that actually govern your account, stated plainly - including the
              parts that are still sandbox on our side.
            </p>
          </div>
        </div>

        {/* ---- ACCORDION ----
            `type="single"` - ek time pe ek item khula.
            `collapsible` - khula item dobara click karne pe band.
            Radix proper ARIA + keyboard nav khud handle karta hai. */}
        <Accordion type="single" collapsible className="mt-8">
          {FAQ_ENTRIES.map((entry) => {
            const Icon = entry.icon;
            return (
              <AccordionItem
                key={entry.id}
                value={entry.id}
                className="border-b-[#2c3235]"
              >
                {/* ---- TRIGGER (the question) ----
                    Radix Trigger already has `aria-expanded` + keyboard.
                    Hum styling customize karte hain: no underline on hover
                    (default Radix behaviour underline deta hai jo ugly lagta
                    hai), focus ring visible. */}
                <AccordionTrigger className="gap-3 py-5 text-left text-base font-medium text-[#d8d9da] hover:bg-transparent hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/60">
                  {/* Category icon - accent colored, decorative */}
                  <Icon
                    className="h-4.5 w-4.5 shrink-0"
                    style={{ color: entry.accent }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">{entry.question}</span>
                </AccordionTrigger>

                {/* ---- CONTENT (the answer) ----
                    Radix Content already has `role="region"` + aria-controls.
                    Text full (no clamp) - answers important hain. */}
                <AccordionContent className="pb-5 pr-8 text-sm leading-relaxed text-[#9fa7b3]">
                  {entry.answer}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </section>
  );
}
