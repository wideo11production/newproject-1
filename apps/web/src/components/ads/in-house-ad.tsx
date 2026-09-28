// In-House Advertising Engine - Wideo11
//
// ============================================================================
// COST POSITION (ye user ka hard rule hai)
// ============================================================================
// Ye POORA ad network IN-HOUSE hai:
//   - Koi AdSense nahi, koi Taboola nahi, koi DAP nahi
//   - Koi impression ke paise nahi, koi revenue-share nahi
//   - Ad serving, targeting aur measurement sab self-hosted
//   - Sista ka 5% bhi internally ledger me jaata hai, kisi aur ko nahi
//
// Iska matlab: platform scale hone par bhi per-impression cost ZERO rehta hai.
// Sirf infra (GKE) ka cost hai, jo 76% ceiling ke andar controlled hai.
//
// ============================================================================
// REVENUE SPLIT (product spec - test-covered, business_laws_test.go)
// ============================================================================
//   Viewer (ad dekhne wala) : 60%
//   Content uploader (subscribed) : 20%
//   Platform                   : 20%
//   Content uploader (free)     : 10%  -> platform 30%
//
// Exact arithmetic lives in billing-service (ad-economics.go) and is locked by
// tests. Ye file SIRF delivery/orchestration karta hai - calculation server-side
// billing-service me hota hai, client pe koi amount decide nahi karta.
//
// Hinglish: yaad rakho - paisa CLIENT pe kahin calculate nahi hota, hamesha
// billing-service (server) me hota hai. Ye component sirf dikhata + guard karta hai
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdViewGuard } from '@/lib/ads/ad-view-guard';
import { AD_LAWS, type AdCreative, type AdSlot, type AdViewRecord } from '@/lib/ads/types';

export interface InHouseAdProps {
  /** Ad slot ka unique identifier (analytics ke liye) */
  slotId: AdSlot;
  /** Ye ad creative dikhao */
  creative: AdCreative;
  /** View complete hone par callback (measurement ke liye) */
  onViewed?: (record: AdViewRecord) => void;
}

export default function InHouseAd({ slotId, creative, onViewed }: InHouseAdProps) {
  // MRC viewability guard - tab hidden ya pixels < 50% par count NAHI hota
  const { state, confirmPresence, reset } = useAdViewGuard({
    adId: creative.id,
    minSeconds: AD_LAWS.minDurationSeconds,
    maxSeconds: AD_LAWS.maxDurationSeconds,
  });

  // View hone par parent ko batao
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (state.completed && !notifiedRef.current) {
      notifiedRef.current = true;
      onViewed?.({
        adId: creative.id,
        slotId,
        duration: state.assignedDuration,
        pixelVisibility: state.pixelVisibility,
        counted: true,
      });
    }
  }, [state.completed, state.pixelVisibility, state.assignedDuration, creative.id, slotId, onViewed]);

  const handleReset = useCallback(() => {
    notifiedRef.current = false;
    reset();
  }, [reset]);

  return (
    <div
      data-ad-id={creative.id}
      data-ad-slot={slotId}
      // NOTE: ye div IntersectionObserver ke through track hota hai (guard me)
      className="relative overflow-hidden rounded-lg border border-grafana-border bg-grafana-panel"
    >
      {/* ---- Creative ---- */}
      <div className="p-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-grafana-textMuted">
          Sponsored
        </p>
        <h4 className="mt-1 text-sm font-semibold text-grafana-text">{creative.title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-grafana-textMuted">
          {creative.body}
        </p>
        {creative.ctaLabel ? (
          <button
            type="button"
            className="mt-3 h-9 rounded-md bg-grafana-primary px-3.5 text-xs font-medium text-ink transition-colors hover:bg-grafana-primary/85"
            onClick={() => {
              // CTA click bhi ek interaction hai
              confirmPresence();
            }}
          >
            {creative.ctaLabel}
          </button>
        ) : null}
      </div>

      {/* ---- Paused overlay (tab background me) ---- */}
      {!state.isVisible && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-grafana-bg/95 backdrop-blur">
          <p className="text-xs font-medium text-grafana-text">Ad paused</p>
          <p className="text-[11px] text-grafana-textMuted">
            Return to this tab to continue viewing
          </p>
        </div>
      )}

      {/* ---- Resume -> click required ---- */}
      {state.isVisible && !state.completed && !state.isCounting && state.pauseReason && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-grafana-bg/95 backdrop-blur">
          <p className="text-xs font-medium text-grafana-text">Confirm you are viewing</p>
          <p className="text-[11px] text-grafana-textMuted">{state.pauseReason}</p>
          <button
            type="button"
            onClick={confirmPresence}
            className="rounded-md bg-grafana-primary px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-grafana-primary/85"
          >
            I am watching
          </button>
        </div>
      )}

      {/* ---- Initial: start viewing ---- */}
      {state.isVisible && !state.presenceConfirmed && !state.completed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-grafana-bg/95 backdrop-blur">
          <p className="text-xs font-medium text-grafana-text">Ad verification</p>
          <p className="text-[11px] text-grafana-textMuted">
            Click below to view for the full duration
          </p>
          <button
            type="button"
            onClick={confirmPresence}
            className="rounded-md bg-grafana-primary px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-grafana-primary/85"
          >
            Start viewing
          </button>
        </div>
      )}

      {/* ---- Timer bar ---- */}
      {state.isCounting && !state.completed && (
        <div className="absolute bottom-0 left-0 right-0 bg-grafana-bg/90 px-3 py-1.5">
          <div className="mb-1 flex items-center justify-between text-[10px] text-grafana-textMuted">
            <span>View in progress</span>
            <span className="font-mono">{state.secondsLeft}s</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-grafana-border">
            <div
              className="h-full rounded-full bg-grafana-primary transition-all duration-1000"
              style={{
                width: `${100 - (state.secondsLeft / state.assignedDuration) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* ---- Completed ---- */}
      {state.completed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-grafana-bg/95 backdrop-blur">
          <p className="text-xs font-medium text-grafana-success">View recorded</p>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-grafana-border px-3.5 py-1.5 text-xs text-grafana-textMuted transition-colors hover:bg-grafana-panelHover"
          >
            View again
          </button>
        </div>
      )}
    </div>
  );
}
