// Ad placements demo - IN-HOUSE network demo
//
// YE PAGE sirf DEMONSTRATION hai - in-house ad engine kaise dikhta aur measure
// hota hai, ye dikhata hai. Koi third-party ad network nahi, koi cost nahi.
//
// MEASUREMENT: MRC industry standards follow hote hain:
//   - minimum 2 second view time
//   - 50% pixels visible
//   - tab background me jaate hi count RUK jata hai
//
// Hinglish: sab ads in-house hain, zero cost, MRC compliant measurement
'use client';

import InHouseAd from '@/components/ads/in-house-ad';
import { DEMO_CREATIVES, type AdSlot, type AdViewRecord } from '@/lib/ads/types';
import { MascotEmptyState } from '@/components/brand/mascots';

const SLOTS: AdSlot[] = ['feed', 'video-detail', 'dashboard', 'sidebar'];

export default function AdPlacementsPage() {
  return (
    <div className="min-h-screen bg-grafana-bg p-6 text-grafana-text">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">In-House Advertising</h1>
          <p className="mt-1 text-sm text-grafana-textMuted">
            100% self-hosted · zero third-party cost · MRC-compliant viewability
          </p>
        </header>

        {/* Cost/law explanation */}
        <div className="grid gap-3 rounded-lg border border-grafana-border bg-grafana-panel/60 p-4 sm:grid-cols-3">
          {[
            { label: 'Viewer / creator share', value: '60%' },
            { label: 'Platform share', value: '20%' },
            { label: 'Sister ledger share', value: '5%' },
          ].map((s) => (
            <div key={s.label} className="rounded-md bg-grafana-bg p-3 text-center">
              <p className="font-mono text-2xl font-bold text-grafana-primary">
                {s.value}
              </p>
              <p className="mt-0.5 text-[11px] text-grafana-textMuted">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Ad slots */}
        <div className="grid gap-4 lg:grid-cols-2">
          {SLOTS.map((slot) => (
            <div key={slot} className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-grafana-textMuted">
                {slot} placement
              </p>
              <InHouseAd
                slotId={slot}
                creative={DEMO_CREATIVES[slot]}
                onViewed={(r: AdViewRecord) => {
                  // In production ye billing-service ko jaata hai
                  // (server-side calculation - client pe paisa decide nahi hota)
                  console.log(
                    `[AD] counted view slot=${r.slotId} ad=${r.adId} dur=${r.duration}s vis=${r.pixelVisibility}%`
                  );
                }}
              />
            </div>
          ))}
        </div>

        {/* Mascot identity */}
        <section className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-grafana-textMuted">
            Brand mascots
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['Wino', 'Mino', 'Rino'] as const).map((m) => (
              <MascotEmptyState
                key={m}
                name={m}
                title={m}
                description={
                  m === 'Wino'
                    ? 'The boy - build buddy'
                    : m === 'Mino'
                    ? 'The girl - creative partner'
                    : 'Tech companion - automation sidekick'
                }
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
