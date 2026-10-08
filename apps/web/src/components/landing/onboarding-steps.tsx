/**
 * ============================================================================
 * ONBOARDING WORKFLOW ENGINE - 3-step visual row
 * ============================================================================
 *
 * REQUIRED CONTENT (spec - teenon explicitly cover hone chahiye):
 *   1. "What wideo11.com is"
 *   2. "How our local container microservice infrastructure operates"
 *   3. "The absolute user pathway to securely hit the daily ₹500 payout
 *       thresholds"
 *
 * DESIGN DECISIONS:
 *   - Server Component (koi state nahi, koi hook nahi) - zero client JS
 *   - Steps DATA-DRIVEN - array se render, taaki content change karna na ho
 *     to JSX chhudna pade
 *   - Numbers bade + brand color me - visual hierarchy
 *   - Connector line desktop pe, stacked mobile pe (Prime Video onboarding
 *     style vertical)
 *
 * RESPONSIVE:
 *   - Mobile: `grid-cols-1` (stacked, vertical)
 *   - Tablet+: `sm:grid-cols-3` (horizontal row with connectors)
 *   - Connector: absolute positioned line, sirf sm+ pe visible
 *
 * Hinglish comments: har block ka arth
 */

import { Globe, Cpu, Wallet, type LucideIcon } from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';

/**
 * ONBOARDING STEPS - static data.
 *
 * NOTE: Ye `const` (not state) - content static hai, user action se change
 * nahi hota. Isliye Server Component me reh sakta hai.
 *
 * `icon` field Lucide component hold karta hai - rendering me `<Icon/>`
 * ban jata hai. Ye type-safe hai (`LucideIcon`).
 */
const ONBOARDING_STEPS: ReadonlyArray<{
  id: string;
  step: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    id: 'what-is',
    step: '01',
    title: 'What wideo11.com is',
    description:
      'A video platform for creators who want edge delivery and honest payouts. Upload once, we transcode to adaptive HLS, stream from the edge, and settle every rupee through a ledger you can audit.',
    icon: Globe,
    accent: '#60a5fa',
  },
  {
    id: 'infra',
    step: '02',
    title: 'How the local microservices run',
    description:
      'Our whole stack runs in local containers: Postgres for data, Redis for caching, NATS for events, and a self-hosted Postfix for mail. MinIO stores video, so nothing depends on a third-party provider.',
    icon: Cpu,
    accent: '#a78bfa',
  },
  {
    id: 'payout',
    step: '03',
    title: 'Your path to the daily ₹500',
    description:
      'Register, verify your email, pass a 12-character password, and keep a ₹2,000 nominee buffer protected. Once your balance clears the threshold, the daily settlement run pays out automatically.',
    icon: Wallet,
    accent: '#73bf69',
  },
];

/**
 * ONBOARDING_STEPS_ROW - the section.
 */
export function OnboardingStepsRow({ className }: { className?: string }) {
  return (
    <section
      className={cn('w-full bg-[#181b1f] py-16 sm:py-20', className)}
      aria-labelledby="onboarding-heading"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* ---- SECTION HEADER ---- */}
        <div className="max-w-2xl">
          <h2
            id="onboarding-heading"
            className="text-2xl font-bold tracking-tight text-[#d8d9da] sm:text-3xl"
          >
            How it actually works
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[#9fa7b3] sm:text-base">
            Three steps from signup to your first settled payout. No paid tools,
            no third-party network - just containers we run ourselves.
          </p>
        </div>

        {/* ---- STEPS GRID ----
            `sm:grid-cols-3` - teeno steps side by side desktop pe.
            Mobile pe stacked. Har step ek card. */}
        <div className="relative mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-4">
          {/* ---- CONNECTOR LINE (desktop only) ----
              Absolute positioned, do cards ke beech. `hidden sm:block` -
              mobile pe vertical stack me line ki zaroorat nahi.
              `top-[52px]` - icon circle ke center tak align. */}
          <div
            aria-hidden="true"
            className="absolute left-[16%] right-[16%] top-[52px] hidden h-px bg-gradient-to-r from-transparent via-[#2c3235] to-transparent sm:block"
          />

          {ONBOARDING_STEPS.map((step) => {
            // Icon component destructure - render karna hai
            const Icon = step.icon;
            return (
              <div key={step.id} className="relative flex flex-col items-center text-center sm:items-start sm:text-left">
                {/* ---- ICON CIRCLE ----
                    Number + icon. Circle me step number (bada), icon upar.
                    Actually: icon circle me, number neeche as text. Let me do:
                    - Circle with Icon inside
                    - Step number as small label above/beside */}
                <div className="relative flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#111217]"
                  style={{ borderColor: step.accent }}>
                  {/* Icon - accent color me */}
                  <Icon className="h-6 w-6" style={{ color: step.accent }} aria-hidden="true" />
                </div>

                {/* ---- STEP NUMBER ----
                    Bada, mono, accent color. Visual weight deta hai. */}
                <p
                  className="mt-4 font-mono text-sm font-bold"
                  style={{ color: step.accent }}
                >
                  STEP {step.step}
                </p>

                {/* ---- STEP TITLE ---- */}
                <h3 className="mt-1 text-lg font-semibold text-[#d8d9da]">
                  {step.title}
                </h3>

                {/* ---- STEP DESCRIPTION ----
                    Line-clamp-none - full text (important content, truncate
                    nahi karna). Text-sm readable. */}
                <p className="mt-2 text-sm leading-relaxed text-[#9fa7b3]">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
