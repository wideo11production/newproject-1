// ============================================================================
// LANDING PAGE - immersive entertainment shell (Prime Video style)
// ============================================================================
//
// ARCHITECTURE SPLIT (Server + Client boundary):
//   Ye file ek SERVER COMPONENT hai (koi "use client" nahi). Isliye:
//     - Zero client JS overhead for the static parts
//     - `mergePool()` server pe chalta hai (localStorage overlay nahi, seed
//       return karta hai - no hydration mismatch)
//     - Sirf carousel aur localStorage merge CLIENT component me jaata hai
//
// HYDRATION STRATEGY (no-mismatch guarantee):
//   - Server pe `SEED_POOL` render hota hai
//   - Client pe `LandingGrid` (client component) `useEffect` me overlay
//     merge karta hai - isliye pehla client render server ke IDENTICAL hota
//     hai, phir overlay apply hota hai. Isse koi flash/mismatch nahi.
//
// CONTENT SOURCE (hard rule):
//   `ad-pool.ts` se. Wo sirf localStorage + static seed padhta hai. Koi
//   third-party ad network, koi CDN nahi. Video MinIO se.
//
// THEME (Grafana exact hex, from design-system.ts):
//   Layout shell: #111217 (grafanaBgHex)
//   Panels: #181b1f, borders: #2c3235, text: #d8d9da / #9fa7b3
//   Ye `bg-[#111217]` Tailwind arbitrary value se directly use hote hain.
//
// Hinglish comments: har block ka arth

import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { BrandLockup } from '@wideo11/ui/brand/characters';
import { SessionUserMenu } from '@wideo11/ui/session-user-menu';
import { LandingCta, MidPageCta } from './components/landing/landing-cta';

import { CHARACTER_SPEC_REVISION } from '@wideo11/ui/brand/characters-manifest';
import { SEED_POOL } from '@/lib/landing/ad-pool';
import LandingShell from '@/components/landing/landing-shell';
import { OnboardingStepsRow } from '@/components/landing/onboarding-steps';
import { FaqPortal } from '@/components/landing/faq-portal';

// ---------------------------------------------------------------------------
// NAVIGATION HEADER - auth links + brand
// ---------------------------------------------------------------------------
function SiteHeader() {
  return (
    <header className="sticky top-0 z-40-[#2c3235] bg-[#111217]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
        {/* Brand - Wino + Rino lockup (manifest-locked vectors, inline SVG) */}
        <Link href="/" className="flex items-center gap-2.5">
          <BrandLockup size={32} />
          <span className="text-lg font-semibold tracking-tight text-[#d8d9da]">
            Wideo11
          </span>
        </Link>

        {/*
          THE SESSION, NOT TWO LINKS.

          This nav was hardcoded "Log in" / "Register" and never read the
          session cookie - so a signed-in user landed on the home page and was
          told they were signed out. The page looked correct to everyone who was
          not already signed in, which is why it survived.

          Now it renders `SessionUserMenu`, the same shared component the editor
          uses, reading this app's own `/api/session`. Signed in: avatar with a
          green ring, a dropdown, and a working Sign out. Signed out: Log in and
          Register.

          The editor link keeps its explicit `?next=/` so a signed-out visitor
          who signs in from here lands in the editor rather than on the home
          page again - the same reason the editor's own gate passes it.
        */}
        <SessionUserMenu
          loginUrl="/auth/login?next=/"
          registerUrl="/auth/register?next=/"
          dashboardUrl="/dashboard"
        />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// HERO PROMOTIONAL STRIP (above carousel)
// Prime Video style: "Featured today" label + small CTA row
// ---------------------------------------------------------------------------
function HeroStrip() {
  return (
    <section className="w-full bg-[#181b1f] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-[#d8d9da] sm:text-2xl">
            Now accepting creators
          </h1>
          <p className="mt-1 text-sm text-[#9fa7b3]">
            Publish to the edge, keep every rupee. No paid tools in the loop.
          </p>
        </div>
        {/*
          THE PRIMARY CTA, AND IT DEPENDS ON WHETHER YOU ARE SIGNED IN.

          This said "Create your account" to everyone, including people who already
          had one. Signing in and then being told to create an account is the kind
          of thing that makes a person conclude the site did not notice them.

          So: signed out, the signup CTA. Signed in, a WELCOME with the two
          things they can actually do next - open the editor, or the dashboard -
          which is the whole point of a service selector.

          `useSession` means no flash of "create your account" for a signed-in
          user: the component renders nothing until the answer is known.
        */}
        <LandingCta />
      </div>
    </section>
  );
}


// ---------------------------------------------------------------------------
// SITE FOOTER
// ---------------------------------------------------------------------------
function SiteFooter() {
  return (
    <footer className="w-full-[#2c3235] bg-[#0f1115] px-4 py-8 text-center sm:px-6 lg:px-8">
      <p className="text-xs text-[#6b7280]">
        Wideo11 - publish to the edge, keep every rupee.
      </p>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// PAGE ROOT
// ---------------------------------------------------------------------------
export default function HomePage() {
  return (
    // Full-bleed entertainment shell. `bg-[#111217]` = exact Grafana hex.
    // min-h-screen ensures it fills viewport even on short content.
    <div className="min-h-screen w-full bg-[#111217] text-[#d8d9da]">
      <SiteHeader />
      <HeroStrip />

      {/* ---- HERO CAROUSEL + CONTENT ROWS ----
          `LandingShell` is a CLIENT component that:
            - reads localStorage overlay on mount (appendable pool)
            - renders HeroCarousel (autoplay) + three ContentRows
          It receives the server-resolved SEED_POOL as initial content, so
          server render is deterministic (no mismatch). */}
      <LandingShell initialPool={SEED_POOL} />

      {/* ---- ONBOARDING WORKFLOW (3 steps) ---- */}
      <OnboardingStepsRow />

      {/* ---- MID-PAGE CTA (between workflow and FAQ) ---- */}
      <MidPageCta />

      {/* ---- FAQ PORTAL (accessible accordion) ---- */}
      <FaqPortal />

      <SiteFooter />
    </div>
  );
}