// SubscriptionHubView — 💰 Subscription purchasing panel within unified dashboard.
//
// Hinglish: Ye component user ke subscription plans dekhati hai aur
// purchase flow simulate karti hai. Standard tiers 60 FPS ceiling tak
// clamp karte hain, jabki AURA standalone lifetime license 120 FPS /
// 240Hz unlock karta hai. Zero discount configurations allowed.
//
// Architecture:
//   1. Client state management via useState (local React state for status)
//   2. Plan definitions with FPS ceilings and resolution caps
//   3. Mock checkout — simulates payment provider response
//   4. On success, tier_state_token dynamically updated in local context
//   5. Active selection highlights use orange-red (#ff6500) signature theme

import { useState } from 'react';
import { Check, Zap, Monitor } from 'lucide-react';

// ---------------------------------------------------------------------------
// Plan definitions — monetization tier structures
// ---------------------------------------------------------------------------

type SubscriptionTier = {
  id: string;
  name: string;
  description: string;
  price: string;
  cycle: string;
  maxFps: number;
  maxResolution: string;
  features: string[];
  isStandalone: boolean;
  accent: string;
};

const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  {
    id: 'standard-monthly',
    name: 'Creator Basic',
    description: 'For everyday video editing. Clamps to 60 FPS output.',
    price: '$9.99',
    cycle: 'per month',
    maxFps: 60,
    maxResolution: '1920x1080',
    features: ['60 FPS ceiling', '1080p export', '5 projects', 'Standard filters'],
    isStandalone: false,
    accent: 'border-[#ff6500]/30',
  },
  {
    id: 'standard-group',
    name: 'Creator Pro',
    description: 'For teams and commercial work. 60 FPS ceiling on all exports.',
    price: '$29.99',
    cycle: 'per month',
    maxFps: 60,
    maxResolution: '3840x2160',
    features: ['60 FPS ceiling', '4K export', 'Unlimited projects', 'Premium filters'],
    isStandalone: false,
    accent: 'border-[#ff6500]/50',
  },
  {
    id: 'aura-standalone',
    name: 'AURA Premium Lifetime',
    description: 'Single-user lifetime license. Unlocks 120 FPS / 240Hz support.',
    price: '$199.99',
    cycle: 'one-time',
    maxFps: 240,
    maxResolution: '3840x2160',
    features: [
      '120 FPS / 240Hz output',
      'Lifetime license (no recurring)',
      '4K export',
      'Exclusive AURA framerate modes',
      'Priority support',
    ],
    isStandalone: true,
    accent: 'border-[#ff6500]',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SubscriptionHubViewProps {
  currentTier?: string;
  onPurchase?: (tierId: string) => void;
}

export function SubscriptionHubView({ currentTier = 'standard-monthly', onPurchase }: SubscriptionHubViewProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Mock checkout — simulates real-time payment provider response
  const handlePurchase = async (tierId: string) => {
    setLoading(tierId);
    setPurchased(null);
    setSuccess(false);

    // Simulate API latency
    await new Promise((resolve) => setTimeout(resolve, 1200));

    setLoading(null);
    setPurchased(tierId);
    setSuccess(true);

    // Notify parent to update context state
    onPurchase?.(tierId);

    // Reset success indicator after 3 seconds
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#d8d9da]">Subscription Hub</h1>
        <div className="text-xs text-[#9fa7b3]">
          Active tier: <span className="text-[#ff6500] font-medium">{currentTier}</span>
        </div>
      </div>

      {/* Plan grid — hyper-flat with sharp container outlines, orange-red highlights */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SUBSCRIPTION_TIERS.map((tier) => {
          const isActive = currentTier === tier.id;
          const justPurchased = purchased === tier.id;

          return (
            <div
              key={tier.id}
              className={`
                relative rounded-md bg-[#181b1f] p-5 transition-all duration-150
                ${tier.accent}
                ${isActive ? 'ring-2 ring-[#ff6500]' : ''}
              `}
            >
              {/* Active / purchased badge */}
              {isActive && (
                <div className="absolute -top-2 right-4 rounded-full bg-[#ff6500] px-2 py-0.5 text-[7px] font-bold text-white">
                  ACTIVE
                </div>
              )}

              {/* Standalone lifetime indicator */}
              {tier.isStandalone && (
                <div className="absolute -top-2 left-4 rounded-full bg-[#ff6500] px-2 py-0.5 text-[7px] font-bold text-white">
                  LIFETIME
                </div>
              )}

              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-[#d8d9da]">{tier.price}</span>
                <span className="text-xs text-[#9fa7b3]">{tier.cycle}</span>
              </div>

              <h2 className="mb-1 text-xl font-semibold text-[#d8d9da]">{tier.name}</h2>
              <p className="mb-4 text-sm text-[#9fa7b3]">{tier.description}</p>

              <ul className="mb-4 space-y-1 text-xs text-[#9fa7b3]">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-2.5 w-2.5 text-[#ff6500]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mb-2 flex items-center gap-4 text-xs text-[#9fa7b3]">
                <span className="flex items-center gap-1">
                  <Monitor className="h-2.5 w-2.5 text-[#ff6500]" />
                  Max {tier.maxFps} FPS
                </span>
                <span>Resolution: {tier.maxResolution}</span>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => handlePurchase(tier.id)}
                  disabled={loading === tier.id || isActive}
                  className={`
                    rounded px-4 py-2 text-xs font-medium text-white
                    transition-colors duration-150
                    ${isActive
                      ? 'cursor-default bg-[#3a3f45]'
                      : 'bg-[#ff6500] hover:bg-[#ff7a00] active:bg-[#e05a00] focus:outline-none focus:ring-2 focus:ring-[#ff6500]'}
                    disabled:opacity-50
                  `}
                >
                  {loading === tier.id ? (
                    <span className="flex items-center gap-1">
                      <Zap className="h-2.5 w-2.5 animate-pulse" />
                      Processing...
                    </span>
                  ) : isActive ? (
                    'Current Plan'
                  ) : (
                    'Select & Pay'
                  )}
                </button>

                {justPurchased && (
                  <span className="text-xs text-[#ff6500]">Purchased!</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Status change indicator */}
      {success && (
        <div className="mt-4 rounded-md/30 bg-[#ff6500]/10 p-3 text-xs text-[#ff6500]">
          Purchase successful. FPS ceiling and resolution limits have been updated in your profile.
        </div>
      )}
    </div>
  );
}

