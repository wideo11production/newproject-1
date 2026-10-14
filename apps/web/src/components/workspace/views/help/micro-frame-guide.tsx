'use client';

/**
 * ============================================================================
 * MICRO-FRAME GUIDE — AURA Micro-Frame Studio walkthrough help sub-view
 * ============================================================================
 *
 * Hinglish: Ye comprehensive walkthrough page AURA Micro-Frame Studio ke
 * saare features, shortcuts, aur professional verification mechanics ko
 * document karta hai. Ismein multi-device audio-video extraction mechanics
 * ke saath advocate-specific workflows bhi shamil hain.
 *
 * Content sections:
 * 1. User profile menus
 * 2. FAQs
 * 3. Key shortcuts configuration grid
 * 4. "How to Isolate Critical Micro-Movements with 3-Frame Studio Precision"
 * 5. Logo and Sponsor Placement tools (trial bounds vs premium export)
 */

import { HelpCircle, Clock, Play, Pause, Scissors, Layers, Type, Settings, MousePointer, SkipBack, SkipForward, Gauge, Volume2, Zap, ExternalLink, FileImage, FileVideo, User } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { cn } from '@wideo11/ui/lib/utils';
import { AuraMicroFrameStudio } from '@/components/workspace/dialogs/aura-micro-frame-studio';
import { useSessionIdentity } from '@/lib/identity-context';
import { useState } from 'react';

import {
  grafanaBg,
  grafanaPanel,
  grafanaPrimary,
  grafanaSuccess,
  grafanaText,
  grafanaTextMuted,
  productAccent,
  productAccentBg,
  productFocusRing,
  productPanelHover,
  productSeparation,
  productSunken,
} from '@wideo11/ui/design-system';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTION_BG = `${grafanaPanel}`;
const SECTION_BORDER = `${productSeparation}`;
const TEXT_PRIMARY = `${grafanaText}`;
const TEXT_SECONDARY = `${grafanaTextMuted}`;
const ORANGE_RED = `${productAccent}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShortcutCategory = {
  name: string;
  icon: React.ReactNode;
  shortcuts: Array<{ key: string; action: string; description: string }>;
};

// ---------------------------------------------------------------------------
// Shortcut data
// ---------------------------------------------------------------------------

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: 'Navigation',
    icon: <MousePointer className={`h-2.5 w-2.5 ${grafanaPrimary}`} />,
    shortcuts: [
      { key: 'Space', action: 'Play / Pause', description: 'Toggle playback in the micro-frame scrubber' },
      { key: '← / →', action: 'Frame step', description: 'Move one frame backward/forward within the 3-frame buffer ring' },
      { key: 'Home', action: 'Go to start', description: 'Jump to the first frame of the buffer ring' },
      { key: 'End', action: 'Go to end', description: 'Jump to the last frame of the buffer ring' },
    ],
  },
  {
    name: 'Editing',
    icon: <Scissors className={`h-2.5 w-2.5 ${grafanaPrimary}`} />,
    shortcuts: [
      { key: 'S', action: 'Blade / Split', description: 'Cut the clip at the playhead position' },
      { key: 'Ctrl+Z', action: 'Undo', description: 'Undo the last edit operation' },
      { key: 'Ctrl+Shift+Z', action: 'Redo', description: 'Redo the last undone operation' },
      { key: 'Ctrl+D', action: 'Duplicate', description: 'Duplicate the selected clip within the 3-frame window' },
    ],
  },
  {
    name: 'Micro-Frame Studio',
    icon: <Layers className={`h-2.5 w-2.5 ${grafanaPrimary}`} />,
    shortcuts: [
      { key: 'Ctrl+M', action: 'Open Micro-Frame Studio', description: 'Launches the AURA Micro-Frame Studio dialog overlay' },
      { key: 'M', action: 'Add marker', description: 'Drop a marker at the playhead for micro-movement isolation' },
      { key: 'Shift+M', action: 'Cycle buffer ring', description: 'Move the 3-frame window forward by one frame' },
      { key: ',', action: 'Previous marker', description: 'Jump to the previous marker within the buffer' },
      { key: '.', action: 'Next marker', description: 'Jump to the next marker within the buffer' },
    ],
  },
  {
    name: 'Playback Speed',
    icon: <Gauge className={`h-2.5 w-2.5 ${grafanaPrimary}`} />,
    shortcuts: [
      { key: 'Alt+←', action: 'Decrease speed', description: 'Reduce playback speed in 0.01x increments' },
      { key: 'Alt+→', action: 'Increase speed', description: 'Increase playback speed in 0.01x increments' },
      { key: 'Alt+0', action: 'Reset speed', description: 'Reset playback speed to 1.00x' },
    ],
  },
];

// ---------------------------------------------------------------------------
// FAQ data
// ---------------------------------------------------------------------------

const FAQ_ENTRIES = [
  {
    question: 'What is the 3-Frame Strict Buffer Ring?',
    answer:
      'The 3-Frame Buffer Ring loads exactly 3 discrete frames around the active playhead: the previous frame (Frame-1), the current frame (Frame-0), and the next frame (Frame+1). You cannot scroll, drag, or scrub outside these three frames — the viewport is hard-clamped to maintain precision.',
  },
  {
    question: 'How does millisecond-precision scrubbing work?',
    answer:
      'Timestamps are rendered in HH:MM:MMM format (e.g., 00:01:001 to 00:01:033). The continuous rendering player loop updates at 150ms intervals for smooth preview. Playback speed can be adjusted in 0.01x increments for frame-by-frame analysis.',
  },
  {
    question: 'Is the AURA Micro-Frame Studio available on all plans?',
    answer:
      'No. This is a premium feature strictly gated to standalone full-price single-user AURA plan license holders. The feature flag `AURA_MICRO_FRAME_STUDIO_ENABLED` must read `true` in the environment configuration. If `false`, the dialog overlay is completely clamped and falls back to standard WideoCut Pro restrictions.',
  },
  {
    question: 'Do my edits sync back to WideoCut Pro?',
    answer:
      'Yes. Any clip slicing, overlay adjustments, mask configurations, or text expressions modified inside the Micro-Frame Studio directly utilize and save into the existing core hooks, storage panels, and variables database of WideoCut Pro. There is zero duplication — the same data structures are used everywhere.',
  },
  {
    question: 'How does Logo and Sponsor Placement work?',
    answer:
      'Logo and Sponsor Placement tools allow you to anchor brand assets at exact frame positions. In trial mode, exports are watermarked. Full premium export operations remove watermarks and unlock high-resolution rendering. The trial bounds are enforced at the compositing stage — the watermark is baked in before the frame leaves the browser.',
  },
  {
    question: 'What is the difference between Advocate and Student verification?',
    answer:
      'Advocates use Bar Council domains and must provide a Bar Association ID for Gate B verification. Students use academic domains (.edu, .ac.in) for instant Gate A auto-approval. Both roles get the AURA Micro-Frame Studio, but Advocate workflows include legal metadata tagging for court-admissible micro-movement isolation.',
  },
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MicroFrameGuide() {
  const [showDialog, setShowDialog] = useState(false);
  // Hinglish: Superadmin gate ke liye session identity — dialog andar hi
  // env flag + email + superadmin token check karta hai; yahan hum sirf
  // current session ka email aur superadmin state paas karte hain.
  const identity = useSessionIdentity();

  return (
    <div className={`h-full min-h-screen ${SECTION_BG} ${TEXT_PRIMARY} p-6`}>
      {/* ---- Header ---- */}
      <div className="mb-8 flex items-center gap-3">
        <HelpCircle className={`h-2.5 w-2.5 ${productAccent}`} aria-hidden="true" />
        <h1 className="text-2xl font-bold">AURA Micro-Frame Studio Walkthrough</h1>
      </div>

      {/* ---- Section 1: User Profile Menus ---- */}
      <section className={`mb-8 rounded-md ${SECTION_BORDER} ${productSunken} p-6`}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <User className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
          User Profile Menus
        </h2>
        <p className={`mb-3 text-sm ${TEXT_SECONDARY}`}>
          The AURA Micro-Frame Studio respects your profile settings. Your role (Student, Tutor, or Advocate)
          determines which verification gate applies, and your AURA license tier controls feature access.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`rounded-md ${grafanaPanel} p-3`}>
            <p className={`text-xs font-medium ${grafanaText}`}>Student Role</p>
            <p className={`mt-1 text-xs ${TEXT_SECONDARY}`}>
              Academic email domains (.edu, .ac.in) → Gate A auto-approval in 1 click.
            </p>
          </div>
          <div className={`rounded-md ${grafanaPanel} p-3`}>
            <p className={`text-xs font-medium ${grafanaText}`}>Advocate Role</p>
            <p className={`mt-1 text-xs ${TEXT_SECONDARY}`}>
              Bar Council domains + Bar Association ID → Gate B manual review with 365-day token.
            </p>
          </div>
        </div>
      </section>

      {/* ---- Section 2: Key Shortcuts Configuration Grid ---- */}
      <section className={`mb-8 rounded-md ${SECTION_BORDER} ${productSunken} p-6`}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Settings className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
          Key Shortcuts Configuration
        </h2>
        <p className={`mb-4 text-sm ${TEXT_SECONDARY}`}>
          All keyboard shortcuts are configurable. Printed shortcuts are discoverable from the menu bar in the video editor.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SHORTCUT_CATEGORIES.map((cat) => (
            <div key={cat.name} className={`rounded-md ${grafanaPanel} p-3`}>
              <div className={`mb-2 flex items-center gap-2 text-xs font-semibold ${grafanaText}`}>
                {cat.icon}
                <span>{cat.name}</span>
              </div>
              <div className="space-y-1.5">
                {cat.shortcuts.map((sc) => (
                  <div key={sc.key} className="text-[10px]">
                    <kbd className={`inline-block w-10 ${productSeparation} ${grafanaBg} px-1 py-0.5 font-mono ${productAccent}`}>
                      {sc.key}
                    </kbd>
                    <span className={`ml-1 block ${grafanaText}`}>{sc.action}</span>
                    <span className={`text-[9px] ${TEXT_SECONDARY}`}>{sc.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Section 3: How to Isolate Critical Micro-Movements ---- */}
      <section className={`mb-8 rounded-md ${SECTION_BORDER} ${productSunken} p-6`}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Play className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
          How to Isolate Critical Micro-Movements with 3-Frame Studio Precision
        </h2>
        <ol className="space-y-3 text-sm">
          <li className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full ${productPanelHover} text-xs font-bold ${ORANGE_RED}`}>1</span>
            <span>
              <strong className={`font-medium ${grafanaText}`}>Position the playhead.</strong>
              <span className={` ${TEXT_SECONDARY}`}> Use Left/Right arrow keys or drag the scrubber to the frame where the micro-movement begins. The playhead activates the 3-frame buffer ring: Frame-1, Frame-0 (active), and Frame+1.</span>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full ${productPanelHover} text-xs font-bold ${ORANGE_RED}`}>2</span>
            <span>
              <strong className={`font-medium ${grafanaText}`}>Reduce playback speed.</strong>
              <span className={` ${TEXT_SECONDARY}`}> Press <kbd className={`${productSeparation} ${grafanaPanel} px-1 py-0.5 font-mono text-xs ${productAccent}`}>Alt+←</kbd> to decrease speed in 0.01x increments. At 0.01x, one full second of timeline equals 100 seconds of playback, giving you frame-level visibility.</span>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full ${productPanelHover} text-xs font-bold ${ORANGE_RED}`}>3</span>
            <span>
              <strong className={`font-medium ${grafanaText}`}>Add markers.</strong>
              <span className={` ${TEXT_SECONDARY}`}> Press <kbd className={`${productSeparation} ${grafanaPanel} px-1 py-0.5 font-mono text-xs ${productAccent}`}>M</kbd> at each boundary of the micro-movement. Markers snap the 3-frame buffer to exact start/end points.</span>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full ${productPanelHover} text-xs font-bold ${ORANGE_RED}`}>4</span>
            <span>
              <strong className={`font-medium ${grafanaText}`}>Use the Blade tool.</strong>
              <span className={` ${TEXT_SECONDARY}`}> Press <kbd className={`${productSeparation} ${grafanaPanel} px-1 py-0.5 font-mono text-xs ${productAccent}`}>S</kbd> to split precisely at the playhead. The 3-frame boundary lock ensures splits only occur within the buffered range, preventing accidental edits outside the region of interest.</span>
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full ${productPanelHover} text-xs font-bold ${ORANGE_RED}`}>5</span>
            <span>
              <strong className={`font-medium ${grafanaText}`}>Review the millisecond timestamps.</strong>
              <span className={` ${TEXT_SECONDARY}`}> The scrubber displays absolute HH:MM:MMM timestamps. Verify the micro-movement duration matches your expectations before exporting.</span>
            </span>
          </li>
        </ol>
      </section>

      {/* ---- Section 4: Logo & Sponsor Placement Tools ---- */}
      <section className={`mb-8 rounded-md ${SECTION_BORDER} ${productSunken} p-6`}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <FileImage className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
          Logo and Sponsor Placement Tools
        </h2>
        <div className="space-y-4 text-sm">
          <p className={TEXT_SECONDARY}>
            Logo and Sponsor Placement tools let you anchor brand assets at exact positions within the micro-frame studio.
            Trial mode applies a visible watermark; premium export removes it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`rounded-md ${grafanaPanel} p-3`}>
              <div className={`flex items-center gap-2 text-xs font-medium ${grafanaText}`}>
                <FileImage className={`h-2.5 w-2.5 ${grafanaSuccess}`} />
                Trial Bounds
              </div>
              <p className={`mt-1 text-xs ${TEXT_SECONDARY}`}>
                Exports are watermarked with "Wideo11 Trial" overlay. Maximum 720p resolution.
                30-second output limit per export.
              </p>
            </div>
            <div className={`rounded-md ${grafanaPanel} p-3`}>
              <div className={`flex items-center gap-2 text-xs font-medium ${grafanaText}`}>
                <FileVideo className={`h-2.5 w-2.5 ${productAccent}`} />
                Premium Export
              </div>
              <p className={`mt-1 text-xs ${TEXT_SECONDARY}`}>
                Watermark-free rendering. Up to 4K resolution. Unlimited output duration.
                Requires full AURA plan license.
              </p>
            </div>
          </div>
          <p className={`text-xs ${TEXT_SECONDARY}`}>
            Placement is frame-accurate: positions and opacity values set inside the 3-frame buffer ring
            are preserved through export. The watermark check runs at compositing time, so trial exports
            cannot be "uncropped" to reveal branding later.
          </p>
        </div>
      </section>

      {/* ---- Section 5: FAQs ---- */}
      <section className={`rounded-md ${SECTION_BORDER} ${productSunken} p-6`}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <HelpCircle className={`h-2.5 w-2.5 ${grafanaPrimary}`} />
          Frequently Asked Questions
        </h2>
        <div className="space-y-3">
          {FAQ_ENTRIES.map((faq, idx) => (
            <details
              key={idx}
              className={`rounded-md ${grafanaPanel} p-3 text-sm`}
            >
              <summary className={`cursor-pointer text-xs font-medium ${grafanaText} list-none flex items-center justify-between`}>
                <span>{faq.question}</span>
                <ExternalLink className={`h-2.5 w-2.5 ${grafanaTextMuted} transition-transform duration-150 group-open:rotate-90`} />
              </summary>
              <p className={`mt-2 text-xs ${TEXT_SECONDARY} leading-relaxed`}>
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* ---- Demo / Try It Button ---- */}
      <div className="mt-8 flex justify-center">
        <Button
          onClick={() => setShowDialog(true)}
          className={`${productAccentBg} text-white hover:${productAccentBg}/85 ${productFocusRing}/50`}
        >
          <Layers className="mr-2 h-2.5 w-2.5" />
          Try AURA Micro-Frame Studio
        </Button>
      </div>

      {/* ---- Dialog Overlay ---- */}
      <AuraMicroFrameStudio
        open={showDialog}
        onOpenChange={setShowDialog}
        activeFrame={1}
        fps={30}
        totalFrames={90}
        onFrameChange={() => {}}
        onPlayPause={() => {}}
        isPlaying={false}
        playbackSpeed={1.0}
        onPlaybackSpeedChange={() => {}}
        durationMs={3000}
        currentTimeMs={0}
        userEmail={identity.email}
        isSuperadmin={identity.isSuperadmin}
        onTimelineSync={(payload) => {
          // Zero-Duplication: edit ops existing timeline storage hook par
          // jate hain — yahan future me project-store ka direct sync judega.
          if (process.env.NODE_ENV !== 'production') {
            console.info('[aura-micro-frame] timeline sync payload', payload);
          }
        }}
      />
    </div>
  );
}

// Re-export for lazy loading
export default MicroFrameGuide;

