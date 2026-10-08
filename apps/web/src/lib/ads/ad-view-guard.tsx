// Ad View Guard - anti-fraud verification for ad viewing
//
// YE KYA SOLVE KARTA HAI:
// Ad fraud ka sabse common pattern ye hota hai ki user (ya bot) ad page kholta
// hai aur background me chhodh deta hai - jaise multiple tabs ya ek script jo
// khud click karta rehta hai. Isse advertiser ko fake impressions mil jate hain.
//
// 3 DEFENSES (SPEC ke mutabiq):
//   1. TAB VISIBILITY: doosre tab pe jaate hi ad PAUSE ho jata hai.
//      `document.hidden` detect karke timer rok dete hain.
//   2. PRESENCE CLICK: ad dekhne ke liye user ko ek baar CLICK karna hota hai.
//      Bina click ke view count nahi hota.
//   3. RANDOMIZED TIMER: har view ka duration RANDOM hota hai (min..max range).
//      Taki ek script fixed timing guess na kar sake, aur user ko bhi pata na
//      chale ki timer kitna tha - isse "auto-clicker" scripts fail hote hain.
//
// SECURITY NOTES (jo maine consciously choose kiye):
//   - Timer value CLIENT side hai, isliye perfect protection NAHI hai.
//     A determined attacker devtools se bypass kar sakta hai.
//     ISLIYE isko SIRF first line of defense samjho.
//     Server-side verification (ad provider ke saath) zaroori hai
//     production fraud ke liye.
//   - Ye component honest UX + basic bot deterrence deta hai,
//     full ad-fraud protection nahi.
//
// Hinglish comments: har block ka arth
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AdViewState {
  /** Ad visible hai ya nahi (tab active) */
  isVisible: boolean;
  /** Timer chal raha hai ya nahi */
  isCounting: boolean;
  /** Remaining seconds */
  secondsLeft: number;
  /** User ne presence click kiya ya nahi */
  presenceConfirmed: boolean;
  /** Timer complete (ad counted) */
  completed: boolean;
  /** Kyu pause hua - debugging ke liye */
  pauseReason: string | null;
  /** Random duration jo is view ke liye chuna gaya (server report ke liye) */
  assignedDuration: number;
	/** MRC: kitne % pixels visible (50% minimum required) */
	pixelVisibility: number;
}

interface AdViewGuardProps {
  /** Ad ID - analytics report ke liye */
  adId: string;
  /** Minimum view duration (seconds) - randomized range ka lower bound */
  minSeconds?: number;
  /** Maximum view duration (seconds) - randomized range ka upper bound */
  maxSeconds?: number;
  /** Jab view complete ho, ye call hota hai (analytics) */
  onViewComplete?: (payload: {
    adId: string;
    duration: number;
    presenceConfirmed: boolean;
    pixelVisibility?: number;
  }) => void;
  /** Ad ka content render karne wala children */
  children: React.ReactNode;
}

/**
 * useAdViewGuard - ad view verification ka core hook
 *
 * MRC (Media Rating Council) STANDARD - industry ka official viewability rule:
 *   1. 2 SECOND minimum view time
 *   2. 50% of pixels VISIBLE on screen
 *   Ye do conditions dono satisfy hone par hi impression count hota hai.
 *
 * PLUS 3 extra defenses (fraud deterrence):
 *   - Tab background me gaya -> pause
 *   - Presence click required
 *   - Randomized duration (bot fixed-timing guess na kar sake)
 *
 * RULES:
 *   - Tab hidden ya pixels < 50% -> pause (count reset nahi, ruk jata hai)
 *   - Presence click nahi kiya -> resume hone pe user se click maangega
 *   - Timer random duration ka hai
 */
export function useAdViewGuard({
  adId,
  minSeconds = 15,
  maxSeconds = 45,
  onViewComplete,
}: Omit<AdViewGuardProps, 'children'>) {
  // Random duration - har view pe naya
  // Math.random() yahan PRNG hai, cryptographic nahi - ye UI deterrence ke
  // liye hai, security boundary nahi.
  const [assignedDuration] = useState<number>(
    () => Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds
  );

  const [state, setState] = useState<AdViewState>({
    isVisible: typeof document !== 'undefined' ? !document.hidden : true,
    isCounting: false,
    secondsLeft: 0,
    presenceConfirmed: false,
    completed: false,
    pauseReason: null,
    assignedDuration,
    // MRC: pixels abhi measure nahi hua - assume karte hain 100 (element visible hai)
    pixelVisibility: 100,
  });

  const completedRef = useRef(false);
  const startRef = useRef<number | null>(null);
  // 2 second minimum - MRC standard
  const elapsedRef = useRef<number>(0);
  // Element reference - pixel visibility measure karne ke liye
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ---- MRC: Pixel visibility tracking (IntersectionObserver) ----
  // Ye check karta hai ki ad screen par KITNE % visible hai.
  // 50% se kam -> impression count NAHI hoga (MRC standard).
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        const visiblePct = Math.round(entry.intersectionRatio * 100);

        setState((s) => {
          // Tab hidden bhi hai ya pixels < 50% -> pause
          const belowMrcThreshold = visiblePct < 50;

          if (document.hidden || belowMrcThreshold) {
            return {
              ...s,
              isVisible: false,
              isCounting: false,
              pixelVisibility: visiblePct,
              pauseReason: document.hidden
                ? 'Tab is in background'
                : `Only ${visiblePct}% of ad visible (need 50%)`,
            };
          }

          // Visible enough
          return {
            ...s,
            isVisible: true,
            pixelVisibility: visiblePct,
            isCounting: s.isCounting || (s.presenceConfirmed && !s.completed),
            pauseReason: null,
          };
        });
      },
      {
        // threshold array se hum 50% cross hone par notify hote hain
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ---- Timer tick (per second) ----
  useEffect(() => {
    if (!state.isCounting) return;

    const timer = setTimeout(() => {
      // MRC: sirf tab count karo jab BOTH conditions true ho:
      //   - 2 second minimum elapsed
      //   - pixels >= 50%
      const mrcOk = state.pixelVisibility >= 50;

      if (elapsedRef.current < 2) {
        elapsedRef.current += 1;
        setState((s) => ({ ...s, secondsLeft: Math.max(0, s.assignedDuration - 1) }));
        return;
      }

      if (state.secondsLeft <= 1) {
        // Timer complete - impression count
        if (!completedRef.current && mrcOk) {
          completedRef.current = true;
          setState((s) => ({ ...s, isCounting: false, completed: true }));
          onViewComplete?.({
            adId,
            duration: assignedDuration,
            presenceConfirmed: true,
            pixelVisibility: state.pixelVisibility,
          });
        }
        return;
      }

      setState((s) => ({ ...s, secondsLeft: s.secondsLeft - 1 }));
    }, 1000);

    return () => clearTimeout(timer);
  }, [state.isCounting, state.secondsLeft, state.pixelVisibility, adId, assignedDuration, onViewComplete]);

  // ---- Tab visibility (secondary to pixel check, but explicit) ----
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        setState((s) => ({
          ...s,
          isVisible: false,
          isCounting: false,
          pauseReason: 'Tab is in background',
        }));
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // ---- Presence click ----
  const confirmPresence = useCallback(() => {
    setState((s) => {
      if (s.completed) return s;

      elapsedRef.current = 0; // MRC 2-second counter reset
      startRef.current = Date.now();

      return {
        ...s,
        presenceConfirmed: true,
        isCounting: true,
        secondsLeft: s.assignedDuration,
        pauseReason: null,
      };
    });
  }, []);

  const reset = useCallback(() => {
    completedRef.current = false;
    startRef.current = null;
    elapsedRef.current = 0;
    setState((s) => ({
      ...s,
      isCounting: false,
      secondsLeft: 0,
      presenceConfirmed: false,
      completed: false,
      pauseReason: null,
    }));
  }, []);

  return { state, confirmPresence, reset, containerRef };
}

/**
 * AdViewGuard - UI wrapper component
 *
 * Renders children (the ad) + verification UI (click prompt / timer).
 */
export default function AdViewGuard({
  adId,
  minSeconds,
  maxSeconds,
  onViewComplete,
  children,
}: AdViewGuardProps) {
  const { state, confirmPresence, reset, containerRef } = useAdViewGuard({
    adId,
    minSeconds,
    maxSeconds,
    onViewComplete,
  });

  return (
    <div
		ref={containerRef}
		data-ad-id={adId}
      className="relative overflow-hidden rounded-md border-800 bg-gray-900/60"
    >
      {/* Ad content */}
      <div className="p-4">{children}</div>

      {/* ---- Paused overlay (tab background me) ---- */}
      {!state.isVisible && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-950/95 backdrop-blur">
          <p className="text-sm font-medium text-gray-300">Ad paused</p>
          <p className="text-xs text-gray-500">
            Come back to this tab to continue viewing
          </p>
        </div>
      )}

      {/* ---- Resumed but needs click ---- */}
      {state.isVisible && !state.completed && !state.isCounting && state.pauseReason && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/95 backdrop-blur">
          <p className="text-sm font-medium text-gray-300">Confirm you are viewing</p>
          <p className="text-xs text-gray-500">{state.pauseReason}</p>
          <button
            onClick={confirmPresence}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            I am watching
          </button>
        </div>
      )}

      {/* ---- Initial state: click to start ---- */}
      {state.isVisible && !state.presenceConfirmed && !state.completed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/95 backdrop-blur">
          <p className="text-sm font-medium text-gray-300">Ad verification</p>
          <p className="text-xs text-gray-500">
            Click below to view this ad for the full duration
          </p>
          <button
            onClick={confirmPresence}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Start viewing
          </button>
        </div>
      )}

      {/* ---- Timer bar (counting) ---- */}
      {state.isCounting && !state.completed && (
        <div className="absolute bottom-0 left-0 right-0 bg-gray-950/90 px-4 py-2">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
            <span>Viewing in progress</span>
            <span className="font-mono">{state.secondsLeft}s</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-700">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-1000"
              style={{
                width: `${100 - (state.secondsLeft / state.assignedDuration) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* ---- Completed ---- */}
      {state.completed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-green-950/90 backdrop-blur">
          <p className="text-sm font-medium text-green-300">View recorded</p>
          <button
            onClick={reset}
            className="rounded-md border-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            View again
          </button>
        </div>
      )}
    </div>
  );
}
