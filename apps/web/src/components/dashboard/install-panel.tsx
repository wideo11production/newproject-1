'use client';

/**
 * ============================================================================
 * INSTALL PANEL  -  PWA install + QR code for phone handoff
 * ============================================================================
 *
 * Ye 3-dot menu se khulta hai. Do cheezein karta hai:
 *
 *  1. INSTALL ON THIS DEVICE
 *     Browser ke captured `beforeinstallprompt` ko trigger karta hai.
 *
 *  2. SCAN AND OPEN ON YOUR PHONE (QR code)
 *     Laptop par app installed hai, phone nahi. QR se user phone ka camera
 *     use karke seedha wahi URL khol leta hai.
 *
 * ---- QR CODE GENERATED LOCALLY ----
 *  - Koi external QR API (api.qrserver.com etc.) NAHI use hota.
 *    Reasons: privacy (har scan ka URL unke server jaata), offline support,
 *    aur project ka apna rule (koi CDN / third-party network nahi).
 *  - Generator `lib/qr.ts` me hai - pure TypeScript, zero dependency.
 *
 * ---- IMPORTANT URL HONESTY ----
 *  QR me jo URL daala jata hai wo CURRENT origin hai. Development me ye
 *  `http://localhost:3000` hota hai - jo PHONE par NAHI chalega (phone ka
 *  apna localhost hota hai). Ye chhupaya nahi jata: agar current origin
 *  localhost hai to UI me saaf warning dikhti hai, taaki user ko pata ho
 *  ki pehle LAN IP ya real domain set karna hoga.
 *
 * Hinglish comments: har block ka arth
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, Smartphone, Copy, Check, ExternalLink, AlertTriangle } from 'lucide-react';
import { qrToSvg } from '@/lib/qr';
import { usePwaInstall } from '@/lib/use-pwa-install';
import { Button } from '@wideo11/ui/button';

export function InstallPanel({ onClose }: { onClose: () => void }) {
  const { state, install } = usePwaInstall();
  const [copied, setCopied] = useState(false);

  // ---- QR generate karo current app URL ka ----
  //
  // NOTE: `window.location.origin` + `/dashboard` - user jahaan hai wahi
  // jata hai, taaki QR se seedha useful page khule.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const targetUrl = useMemo(
    () => (origin ? `${origin}/dashboard` : ''),
    [origin]
  );

  // ---- QR SVG (memoized - har render pe regenerate nahi hona chahiye) ----
  const qrSvg = useMemo(() => {
    if (!targetUrl) return null;
    return qrToSvg(targetUrl, { size: 220, quiet: 3 });
  }, [targetUrl]);

  /**
   * Development me QR kaam nahi karega - phone `localhost` ko apna maan
   * leta hai. Ye honest warning dikhate hain instead of silently failing.
   */
  const isLocalhost = /localhost|127\.0\.0\.1/.test(origin);
  const isIOS = state.isIOS;

  async function copyLink() {
    if (!targetUrl) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission deny ho sakti hai (insecure context, ya user
      // ne block kiya). Silent fail theek hai - link to dikh raha hai.
    }
  }

  return (
    <div className="space-y-5">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#d8d9da]">Install Wideo11</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#9fa7b3]">
            Run it like a native app - no app store needed.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da]"
        >
          Close
        </button>
      </div>

      {/* ---- 1. Install on this device ---- */}
      <div className="rounded-lg border border-[#2c3235] bg-[#0d0f11] p-4">
        <div className="flex items-start gap-3">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-[#5794f2]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#d8d9da]">Install on this device</p>

            {state.installed || state.isInstalled ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Already installed
              </p>
            ) : state.hasPrompt ? (
              <>
                <p className="mt-1 text-xs leading-relaxed text-[#9fa7b3]">
                  Add Wideo11 to your home screen or app list.
                </p>
                <Button
                  onClick={() => void install()}
                  className="mt-3 h-9 w-full bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
                >
                  Install app
                </Button>
              </>
            ) : isIOS ? (
              /* iOS me `beforeinstallprompt` nahi hota - alag tarika hai */
              <p className="mt-1 text-xs leading-relaxed text-[#9fa7b3]">
                On iPhone: tap <span className="font-medium text-[#d8d9da]">Share</span>{' '}
                (the square-with-arrow icon), then{' '}
                <span className="font-medium text-[#d8d9da]">Add to Home Screen</span>.
              </p>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-[#9fa7b3]">
                This browser has not offered install yet. You can still use the
                QR code below, or install later from your browser menu.
              </p>
            )}

            {state.error ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-400">
                {state.error}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---- 2. QR for phone ---- */}
      <div className="rounded-lg border border-[#2c3235] bg-[#0d0f11] p-4">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-[#73bf69]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#d8d9da]">Open on your phone</p>
            <p className="mt-1 text-xs leading-relaxed text-[#9fa7b3]">
              Scan with your phone camera to open the same page there.
            </p>
          </div>
        </div>

        {qrSvg ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            {/* White background zaroori hai - QR scanners dark background
                par low-contrast modules miss kar dete hain. */}
            <div
              className="rounded-lg bg-white p-3"
              // QR SVG apna aap safe hai (humne generate kiya, user input
              // nahi hai) - `dangerouslySetInnerHTML` yahan sahi hai.
              dangerouslySetInnerHTML={{ __html: qrSvg.svg }}
            />

            {/* Link + copy (QR scan ke bina bhi kaam chal jaye) */}
            <div className="flex w-full items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-[#2c3235] bg-[#181b1f] px-2.5 py-1.5 text-[11px] text-[#9fa7b3]">
                {targetUrl}
              </code>
              <Button
                onClick={copyLink}
                variant="outline"
                size="sm"
                className="h-8 shrink-0 border-[#2c3235] px-2.5 text-[#d8d9da] hover:bg-[#1f2227]"
                aria-label="Copy link"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </Button>
            </div>

            {/* ---- LOCALHOST WARNING (honest, not hidden) ----
                Development me QR localhost point karta hai, jo phone par
                KAAM NAHI KAREGA (phone ka apna localhost hota hai). Ye
                warning isliye zaroori hai taki user confuse na ho ki QR
                "kharab" hai. */}
            {isLocalhost ? (
              <div className="w-full rounded-md border border-amber-700/50 bg-amber-950/20 p-2.5">
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    This QR points at <span className="font-mono">localhost</span>,
                    which only works on this computer. To scan from your phone,
                    set a reachable address first - either your LAN IP (for
                    local testing) or your real domain (for production).
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-[#9fa7b3]">Preparing QR code...</p>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[#9fa7b3]">
        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          Installed apps keep working offline and launch like any other app on
          your device.
        </span>
      </p>
    </div>
  );
}
