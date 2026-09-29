'use client';

/**
 * ============================================================================
 * PWA INSTALLER - service worker registration + install prompt capture
 * ============================================================================
 *
 * DO KAAM KARTA HAI:
 *
 *  1. SERVICE WORKER REGISTER
 *     Chrome "Install app" tabhi suggest karta hai jab registered service
 *     worker ho jisme FETCH HANDLER ho. Bina iske manifest kitna bhi perfect
 *     ho, install prompt nahi aata.
 *
 *  2. INSTALL PROMPT KO PAKADNA
 *     Chrome `beforeinstallprompt` event FIRE karta hai, par uska default
 *     behaviour (apna mini-infobar dikhana) SUPPRESS karna padta hai - warna
 *     hamara apna custom UI (3-dot menu -> "Install on phone") dikhane ke
 *     saath-saath Chrome ka apna bar bhi aa jayega, do prompt ek saath.
 *
 *     Isliye ye event capture karke `preventDefault()` karta hai, aur uska
 *     deferred prompt component ko deta hai - jahan user actually "Install"
 *     press kar sakta hai.
 *
 * ---- KYUN CUSTOM UI (Chrome ka apna prompt na use karke) ----
 *  - Consistency: hamara 3-dot menu already app ka design language carry
 *    karta hai; Chrome ka default infobar alag dikhta hai.
 *  - Control: prompt ko tab dikhate hain jab user khud "Install" khojta hai,
 *    na ki unrequested.
 *  - Education: QR code dikhane ka mauka (phone handoff) - jo Chrome ka
 *    apna prompt kabhi nahi karta.
 *
 * ---- IMPORTANT CONSTRAINTS ----
 *  - `beforeinstallprompt` CHROME-ONLY hai (Edge bhi support karta hai).
 *    Firefox/Safari me ye event aata hi nahi - isliye `isInstallable` false
 *    rahegi aur hum UI me honest fallback message dikhate hain ("is browser
 *    me install option nahi hai") - kuch galat promise nahi karte.
 *  - iOS me `beforeinstallprompt` nahi hota. Uske liye alag instructions
 *    chahiye (Share -> Add to Home Screen). Ye component wo bhi handle karta
 *    hai - `isIOS` detect karke sahi copy dikhata hai.
 *
 * Hinglish comments: har block ka arth
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * `BeforeInstallPromptEvent` ka minimal shape.
 *
 * NOTE: ye TypeScript ke built-in type me nahi hai (Chromium-specific API),
 * isliye hum yahan define karte hain. `prompt()` browser ka custom method hai
 * jo user ke click par actual install prompt dikhata hai.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type PwaInstallState = {
  /** Browser ne install prompt offer kiya hai? */
  isInstallable: boolean;
  /** Prompt capture ho chuka hai (install button kaam karega)? */
  hasPrompt: boolean;
  /** iOS hai? (iOS me alag instructions chahiye) */
  isIOS: boolean;
  /** Kya app already installed hai (standalone mode)? */
  isInstalled: boolean;
  /** Install ke baad ye true ho jata hai */
  installed: boolean;
  /** Koi error aaya? */
  error: string | null;
};

/**
 * PwaInstallProvider / hook.
 *
 * NOTE: Ye ek plain hook hai (context nahi) kyunki use sirf ek jagah
 * (dashboard ka 3-dot menu) karna hai. Agar future me aur jagah chahiye
 * to isko context me wrap kiya ja sakta hai bina iske API ke badle kiye.
 */
export function usePwaInstall(): {
  state: PwaInstallState;
  install: () => Promise<void>;
} {
  // ---- Captured prompt ----
  // Event object ko component state me rakhna padta hai - ye ek-shot
  // event hai, `prompt()` sirf ek hi call ho sakti hai.
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const [state, setState] = useState<PwaInstallState>({
    isInstallable: false,
    hasPrompt: false,
    isIOS: false,
    isInstalled: false,
    installed: false,
    error: null,
  });

  /**
   * App already installed hai ya nahi - ye `display-mode` se pata chalta hai.
   * Standalone (installed app) me `display: standalone` match hota hai.
   */
  const detectInstalled = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari standalone mode ka alag check
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  }, []);

  // ---- SW registration + prompt capture ----
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const alreadyInstalled = detectInstalled();

    setState((s) => ({ ...s, isIOS, isInstalled: alreadyInstalled }));

    // ---- 1. Service worker register ----
    //
    // NOTE: `/sw.js` PUBLIC folder me hai, static serve hota hai. Registration
    // se pehle unregister karna ZAROORI nahi, but development me stale SW
    // se "purana bundle" ka classic symptom aata hai, isliye hum dev me
    // pehle clean karte hain.
    if ('serviceWorker' in navigator) {
      const registerSW = async () => {
        try {
          // ---- SECURITY NOTE ----
          // Service worker SAME-ORIGIN se hi register hota hai (browser
          // enforce karta hai). Hum yahan bhi guard karte hain taaki
          // koi CDN/absolute URL galti se na chale jaaye - ek hijacked
          // SW poori app ka network control kar sakta hai.
          const swUrl = new URL('/sw.js', window.location.origin);
          if (swUrl.origin !== window.location.origin) {
            setState((s) => ({ ...s, error: 'Refusing to register a cross-origin service worker.' }));
            return;
          }
          await navigator.serviceWorker.register(swUrl.pathname, { scope: '/' });
        } catch (err) {
          // SW registration fail hone se app CHALTI hai - bas offline
          // support nahi milega. Isliye ye non-fatal hai.
          console.warn('[PWA] Service worker registration failed:', err);
        }
      };

      if (process.env.NODE_ENV === 'production') {
        void registerSW();
      } else {
        // Dev: purana SW hatao taaki HMR ke baad stale cache na rahe
        void navigator.serviceWorker
          .getRegistrations()
          .then((regs) => Promise.all(regs.map((r) => r.unregister())))
          .then(() => registerSW())
          .catch(() => registerSW());
      }
    }

    // ---- 2. `beforeinstallprompt` capture ----
    const onBeforeInstallPrompt = (event: Event) => {
      // Chrome ka apna mini-infobar SUPPRESS karo - warna humara custom
      // "Install" button aur Chrome ka dono ek saath aa jayenge.
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);
      setState((s) => ({ ...s, isInstallable: true, hasPrompt: true }));
    };

    // ---- 3. `appinstalled` - install ho gaya ----
    const onAppInstalled = () => {
      // Prompt ab use nahi ho sakta (one-shot) - use clear kar do
      setDeferredPrompt(null);
      setState((s) => ({
        ...s,
        isInstalled: true,
        installed: true,
        hasPrompt: false,
        isInstallable: false,
      }));
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, [detectInstalled]);

  /**
   * Install trigger - user ke click par.
   *
   * NOTE: `prompt()` MUST user gesture ke andar call hona chahiye, warna
   * Chrome use reject kar deta hai. Isliye ye onClick se bind hai, kisi
   * `useEffect` se nahi.
   */
  const install = useCallback(async () => {
    if (!deferredPrompt) {
      setState((s) => ({
        ...s,
        error:
          'Install prompt is not ready yet. If this persists, use your browser menu -> "Install app" or "Add to Home Screen".',
      }));
      return;
    }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setState((s) => ({ ...s, installed: true, isInstalled: true, hasPrompt: false, isInstallable: false }));
      }
      // Prompt one-shot hai - clear karna zaroori
      setDeferredPrompt(null);
      setState((s) => ({ ...s, hasPrompt: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error:
          'The browser refused the install request. Try again, or use your browser menu to install.',
      }));
    }
  }, [deferredPrompt]);

  return { state, install };
}
