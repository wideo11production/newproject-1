// Wino, Mino and Rino - Wideo11 platform mascots
//
// BRAND IDENTITY RULES (director mandate):
//   - Wino = the BOY
//   - Mino = the GIRL
//   - Rino = the robot/companion (neutral, tech-facing - in-house automation mascot)
//
// COST: ye PURE SVG hain - koi image file, koi CDN, koi paid asset nahi.
// Isliye 100% in-house hai aur kabhi koi per-request cost nahi aata.
//
// Inhe kaha use karte hain:
//   - Empty states (jab koi data na ho)
//   - Onboarding / first-run
//   - Help + empty triggers across apps
//   - Ad creative mein (templates panel reference)
//
// Hinglish comments: har block ka arth
'use client';

export type MascotName = 'Wino' | 'Mino' | 'Rino';

interface MascotProps {
  name: MascotName;
  /** Size in px */
  size?: number;
  className?: string;
}

/** Mascot accent colours - brand palette se tied */
const MASCOT_COLOR: Record<MascotName, string> = {
  Wino: '#4f9cf9', // blue - the boy
  Mino: '#e05fa8', // pink - the girl
  Rino: '#7b5cf6', // violet - the tech companion
};

/** Mascot ki ek-line personality (tooltips/onboarding me dikhta hai) */
export const MASCOT_TAGLINE: Record<MascotName, string> = {
  Wino: 'Your build buddy',
  Mino: 'Your creative partner',
  Rino: 'Your automation sidekick',
};

/**
 * Mascot - Wino / Mino / Rino ka SVG avatar
 *
 * DESIGN: simple, friendly, high-contrast shapes jo 16px par bhi readable hain.
 * Koi external asset nahi - pure inline SVG.
 */
export function Mascot({ name, size = 48, className = '' }: MascotProps) {
  const color = MASCOT_COLOR[name];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`${name} - ${MASCOT_TAGLINE[name]}`}
      className={className}
    >
      {/* Background rounded square - brand identity ke liye consistent */}
      <rect width="64" height="64" rx="14" fill={color} opacity="0.15" />

      {/* Head - circle */}
      <circle cx="32" cy="28" r="15" fill={color} />

      {/* Eyes - friendly, consistent across all three */}
      <circle cx="26" cy="27" r="2.6" fill="#fff" />
      <circle cx="38" cy="27" r="2.6" fill="#fff" />

      {/* Smile - sabka same, brand consistency */}
      <path
        d="M26 35 Q32 40 38 35"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />

      {/* Character-specific detail so they read as distinct personalities */}
      {name === 'Wino' && (
        // Wino (boy): short hair tuft
        <path
          d="M22 18 Q32 8 42 18"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
        />
      )}
      {name === 'Mino' && (
        // Mino (girl): longer hair with side sweep
        <path
          d="M18 34 Q18 14 32 13 Q46 14 46 34"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
        />
      )}
      {name === 'Rino' && (
        // Rino: antenna (tech/robot identity)
        <>
          <line x1="32" y1="4" x2="32" y2="9" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="32" cy="4" r="2.6" fill={color} />
        </>
      )}
    </svg>
  );
}

/**
 * MascotEmptyState - empty state with mascot
 *
 * USE: jahan bhi data na ho (empty table, no results, no channels etc.)
 * Ye "dead" screen ko friendly banata hai aur brand identity enforce karta hai.
 */
export function MascotEmptyState({
  name = 'Rino',
  title,
  description,
  action,
}: {
  name?: MascotName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-grafana-border bg-grafana-panel/30 px-6 py-10 text-center">
      <Mascot name={name} size={56} />
      <div>
        <p className="text-sm font-medium text-grafana-text">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-grafana-textMuted">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
