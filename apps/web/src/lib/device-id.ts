// A stable, per-browser device id.
//
// =============================================================================
// WHY THIS IS A RANDOM STORED ID AND NOT A "FINGERPRINT"
// =============================================================================
//
// The name `X-Fingerprint` comes from auth-service and means "some stable per-device
// identifier". The obvious implementation of that is to hash the things a browser
// exposes — canvas output, screen geometry, font list, hardware concurrency — and
// that would be the wrong thing to build here, for three reasons:
//
//  1. IT IS A TRACKING SURFACE. A real fingerprint identifies a browser across
//     sites and survives cookie clearing. Deploying one is a privacy and consent
//     decision, not an implementation detail, and it is not a decision to make
//     quietly inside a signup route.
//
//  2. IT IS FRAGILE FOR NO GAIN. Screen size changes, a font loads, a GPU driver
//     updates — and the id changes, so a legitimate user "becomes a new device" and
//     the cap refuses them for something they did not do.
//
//  3. THE QUESTION DOES NOT NEED IT. "Has this browser already taken a free trial"
//     is answered by a value this browser keeps. It never asks whether two
//     different browsers are the same person — which is the question an actual
//     fingerprint answers and this one cannot.
//
// So: a random UUID in `localStorage`. It identifies THIS browser's install. It
// derives nothing from the machine, correlates with nothing else, and clearing it
// costs a user nothing but one extra trial — which is the honest limit of the
// control, stated in `internal/service/trial_device.go` rather than papered over.
//
// =============================================================================
// WHY THIS IS IN ITS OWN MODULE
// =============================================================================
//
// It is needed by at least two callers — registration and the presence tracker —
// and the second one already grew its own private copy inside
// `presence-tracker.tsx`. A second copy is a second place to forget the
// `try/catch`, and this function's whole failure mode is "storage throws and the
// caller forgets to handle it", which produces a broken signup rather than a
// missing feature.

const DEVICE_ID_KEY = 'wideo11.device-id';

/**
 * Returns this browser's id, minting one on first use. `null` when storage is
 * unavailable.
 *
 * `null` is a real answer and callers must handle it: `localStorage` throws in
 * some private-browsing modes and under some corporate policies, and a signup must
 * not fail because a browser setting blocked a cookie jar. Every caller here
 * degrades to "no fingerprint", which auth-service treats as "allow".
 */
export function deviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const minted =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : // Contexts without `randomUUID` — insecure origins, some webviews.
          // `getRandomValues` is universally available, so this branch is
          // belt-and-braces rather than a supported alternative, and it is noted
          // as such so nobody "tidies" it back to the narrowed binding.
          Array.from(
            (globalThis.crypto as { getRandomValues(a: Uint8Array): Uint8Array })
              .getRandomValues(new Uint8Array(16))
          )
            .map((b: number) => b.toString(16).padStart(2, '0'))
            .join('');

    window.localStorage.setItem(DEVICE_ID_KEY, minted);
    return minted;
  } catch {
    // Blocked storage. Returning null is the documented behaviour, not a shrug:
    // the caller sends no header and auth-service allows the trial.
    return null;
  }
}
