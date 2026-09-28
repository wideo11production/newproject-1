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
    <header className="sticky top-0 z-40 border-b border-[#2c3235] bg-[#111217]/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
        {/* Brand - Wino + Rino lockup (manifest-locked vectors, inline SVG) */}
        <Link href="/" className="flex items-center gap-2.5">
          <BrandLockup size={32} />
          <span className="text-lg font-semibold tracking-tight text-[#d8d9da]">
            Wideo11
          </span>
        </Link>

        {/* Auth navigation - Register primary, Log in secondary */}
        <nav className="flex items-center gap-2">
          <Link href="/auth/login">
            <Button variant="ghost" className="h-9 text-[#9fa7b3] hover:text-[#d8d9da]">
              Log in
            </Button>
          </Link>
          <Link href="/auth/register">
            <Button className="h-9 bg-[#5794f2] text-white hover:bg-[#5794f2]/85">
              Register
            </Button>
          </Link>
        </nav>
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
        {/* Primary CTA */}
        <Link href="/auth/register" className="shrink-0">
          <Button className="w-full bg-[#5794f2] text-white hover:bg-[#5794f2]/85 sm:w-auto">
            Create your account
          </Button>
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MID-PAGE CONVERSION CTA
// ---------------------------------------------------------------------------
function MidPageCta() {
  return (
    <section className="w-full border-y border-[#2c3235] bg-[#181b1f] px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-4 text-center">
        <h2 className="text-xl font-bold tracking-tight text-[#d8d9da] sm:text-2xl">
          Ready to publish your first video?
        </h2>
        <p className="max-w-xl text-sm text-[#9fa7b3]">
          Create an account in under a minute. Free to start, no card required.
        </p>
        <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href="/auth/register" className="w-full sm:w-auto">
            <Button className="w-full bg-[#5794f2] text-white hover:bg-[#5794f2]/85 sm:w-auto">
              Register now
            </Button>
          </Link>
          <Link href="/auth/login" className="w-full sm:w-auto">
            <Button
              variant="outline"
              className="w-full border-[#2c3235] text-[#d8d9da] hover:bg-[#1f2227] sm:w-auto"
            >
              Log in
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FOOTER
// ---------------------------------------------------------------------------
function SiteFooter() {
  return (
    <footer className="w-full border-t border-[#2c3235] bg-[#111217] py-8">
      <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-4 px-4 text-sm text-[#9fa7b3] sm:flex-row sm:px-6 lg:px-8">
        <p>&copy; {new Date().getFullYear()} Wideo11. All rights reserved.</p>
        <div className="flex items-center gap-4">
          {/* Brand spec revision stamp - transparent about the locked vectors */}
          <p className="font-mono text-[10px] text-[#9fa7b3]/50">
            brand spec v{CHARACTER_SPEC_REVISION}
          </p>
          <nav className="flex items-center gap-4">
            <Link href="/auth/login" className="transition-colors hover:text-[#d8d9da]">
              Login
            </Link>
            <Link href="/auth/register" className="transition-colors hover:text-[#d8d9da]">
              Register
            </Link>
          </nav>
        </div>
      </div>
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
