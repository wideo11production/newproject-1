'use client';

// ============================================================================
// BrandCharacterAnimation — Self-hosted brand character loop for empty states.
// ============================================================================
//
// Hinglish: ye component Wino, Rino, Tino aur Clip ke images ko empty
// states mein loop animation ke saath dikhata hai. Images public folder
// mein stored hain (wino.png, rino.png, tino.png, clip.png) — koi paid
// third-party animation library nahi.
//
// Hardware-accelerated: `will-change: transform, opacity` ensures 60 FPS.
// `prefers-reduced-motion` respected via `motion-safe:` prefix.
//
// BORDERLESS DESIGN: Character avatar uses bg-gradient-to-br for visual
// separation instead of ring/border. Status dot uses bg-[#73bf69] with
// box-shadow for depth. All interactive elements use rounded-md geometry
// and 150ms color transitions. Orange-red (#ff6500) accent preserved for
// Clip character and action buttons.

import { useEffect, useState } from 'react';
import { cn } from '@wideo11/ui/lib/utils';

interface CharacterConfig {
  name: string;
  role: string;
  image: string;
  tint: string;
  ring: string;
  loop: string;
  speaks: string[];
}

const CHARACTERS: Record<string, CharacterConfig> = {
  wino: {
    name: 'Wino',
    role: 'Keeps the cut tidy',
    image: '/wino.png',
    tint: 'from-amber-400 to-amber-600',
    ring: 'ring-amber-400/40',
    loop: 'tidy',
    speaks: ['handles', 'snapping', 'undo'],
  },
  rino: {
    name: 'Rino',
    role: 'Explains the why',
    image: '/rino.png',
    tint: 'from-sky-400 to-sky-600',
    ring: 'ring-sky-400/40',
    loop: 'why',
    speaks: ['what', 'costs', 'undo'],
  },
  tino: {
    name: 'Tino',
    role: 'Keeps it fast',
    image: '/tino.png',
    tint: 'from-emerald-400 to-emerald-600',
    ring: 'ring-emerald-400/40',
    loop: 'fast',
    speaks: ['large', 'waveforms', 'export'],
  },
  clip: {
    name: 'Clip',
    role: 'The cut',
    image: '/clip.png',
    tint: 'from-[#ff6500] to-[#ff6500]/70',
    ring: 'ring-[#ff6500]/40',
    loop: 'cut',
    speaks: ['cut', 'trim', 'split'],
  },
};

const ANIMATION_CLASSES: Record<string, string> = {
  tidy: 'motion-safe:animate-bounce-in',
  why: 'motion-safe:animate-spin-slow',
  fast: 'motion-safe:animate-slide-in',
  cut: 'motion-safe:animate-pop-in',
};

export function BrandCharacterAnimation({
  character = 'wino',
  size = 'md',
  message,
  action,
  onAction,
}: {
  character?: string;
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  action?: string;
  onAction?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const char = CHARACTERS[character] ?? CHARACTERS.wino;

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="h-16 w-16 animate-pulse rounded-full bg-[#1f2227]" />
        <div className="h-3 w-40 animate-pulse rounded bg-[#1f2227]" />
      </div>
    );
  }

  const sizeClasses = {
    sm: 'h-10 w-10 text-[8px]',
    md: 'h-16 w-16 text-[10px]',
    lg: 'h-24 w-24 text-[12px]',
  };

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="relative">
        <div
          className={cn(
            'relative flex items-center justify-center overflow-visible rounded-full bg-gradient-to-br font-semibold text-white shadow-sm ring-2',
            char.tint,
            char.ring,
            sizeClasses[size],
            ANIMATION_CLASSES[char.loop],
          )}
          style={{ willChange: 'transform, opacity' }}
        >
          <img
            src={char.image}
            alt={char.name}
            className="h-full w-full rounded-full object-cover"
            onError={(e) => {
              // Fallback to initials if image fails to load.
              e.currentTarget.style.display = 'none';
              const span = e.currentTarget.parentElement?.querySelector('span');
              if (span) span.style.display = 'block';
            }}
          />
          <span className="hidden" aria-hidden="true">
            {char.name[0]}
          </span>
        </div>
        <span
          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full-surface-raised bg-[#73bf69] motion-safe:animate-pulse"
          aria-hidden="true"
        />
      </div>

      <div className="max-w-xs">
        <p className="text-sm font-medium text-[#d8d9da]">
          {char.name} <span className="text-[#9fa7b3]">· {char.role}</span>
        </p>
        {message && (
          <p className="mt-1 text-xs text-[#9fa7b3]">{message}</p>
        )}
        {action && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-2 rounded-md bg-[#ff6500] px-3 py-1 text-[10px] font-medium text-white transition-colors duration-150 hover:bg-[#ff6500]/85"
          >
            {action}
          </button>
        )}
      </div>
    </div>
  );
}

export { CHARACTERS };