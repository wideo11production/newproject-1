'use client';

// ============================================================================
// Plan capability — what this account's plan unlocks in the editor
// ============================================================================
//
// WHY THIS IS A SEPARATE FILE
// ---------------------------
// The editor has exactly one plan-gated decision, and it is worth stating in
// one place because it is the only place a price and a feature meet:
//
//   **120fps, 240fps, and the micro-step playback speeds are AURA features.**
//
// Every other plan — the free trial, all three monthly durations, and the
// non-AURA lifetime tiers (1 / 5 / 10 people) — edits at up to 60fps with the
// ordinary nine playback speeds. The editor opens at 30fps and 1x on every
// plan, including AURA: a ceiling is not a default.
//
// ----------------------------------------------------------------------------
// WHY THE NUMBER COMES FROM THE SERVER
// ----------------------------------------------------------------------------
//
// The ceiling is a plan CAPABILITY (`max_fps` in auth-service), not a build
// flag and not a client-side list of plan codes. Three reasons, in order of how
// much they cost to get wrong:
//
//   1. A client-side list is a second catalogue. Add a plan to the server and
//      forget the editor, and the editor silently sells nothing on it.
//   2. A build flag is a deploy. Changing who gets 120fps would mean shipping
//      the editor again, and a flag that grants a paid feature to everyone who
//      loads the bundle is not a gate.
//   3. The server already knows. `/api/session` reads the httpOnly cookie and
//      asks auth-service, which is the same answer the web dashboard shows.
//
// So the editor asks, and treats an unreadable answer as 60. Failing to the
// LOWER ceiling is the safe direction: a user who cannot see 240fps loses a
// feature they paid for and can be told; a user who can see 240fps without
// paying cannot be un-told.
//
// ----------------------------------------------------------------------------
// WHAT THIS FILE DOES NOT DO
// ----------------------------------------------------------------------------
//
// It does not enforce anything. The rate list a dropdown shows is a courtesy —
// the project's own saved rate is coerced on the way in (see
// `coerceFpsTo`/`coerceSpeedTo` in `frames.ts`), and a user who edits their
// localStorage to 240fps renders a 240fps project on a plan that does not sell
// 240fps and gets a 240fps export. The server is where that gets refused, and
// the export path is where it should be refused.

/** The ceiling a plan with no readable answer is treated as. */
export const DEFAULT_MAX_FPS = 60;

/** The AURA ceiling, and the lowest rate that is AURA-only. */
export const AURA_MAX_FPS = 240;
export const AURA_ONLY_MIN_FPS = 120;

/** The rate the editor opens at, on every plan. */
export const DEFAULT_PROJECT_FPS = 30;

/** Real time, and the speed a restored micro-step becomes without AURA. */
export const DEFAULT_PLAYBACK_RATE = 1;

/** The AURA plan code, as auth-service spells it. */
export const AURA_PLAN_CODE = 'lifetime_aura';

/**
 * Is this the AURA plan?
 *
 * The plan code is carried for the LABEL and for the audit trail — "you are on
 * Lifetime AURA" — and never for the decision. The decision reads the ceiling,
 * so an operator who raises a different plan's `max_fps` gets the feature
 * without editing this file, and an operator who lowers AURA's to 60 takes it
 * away the same way.
 */
export function isAuraPlan(planCode: string): boolean {
  return planCode.trim().toLowerCase() === AURA_PLAN_CODE;
}

/**
 * Normalise a ceiling read off the wire.
 *
 * The value arrives as JSON from a service that may omit the key, return null,
 * or return a string because a plan grant was configured oddly. Anything that
 * is not a positive number becomes 60 — the conservative default — because a
 * ceiling of 0 would offer NO frame rates at all and a ceiling of NaN would
 * offer none either once it is compared.
 */
export function normalizeMaxFps(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : (raw as number);
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return DEFAULT_MAX_FPS;
  return Math.floor(n);
}
