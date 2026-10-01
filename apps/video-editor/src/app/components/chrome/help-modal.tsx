'use client';

// ============================================================================
// Help display modal
// ============================================================================
//
// A compact, floating panel that explains the editor: what each control is
// for, what it is good at, and what it costs you. Deliberately SMALL - it is
// opened from a help icon, not browsed, and a modal you have to dismiss before
// you can cut anything is a modal nobody opens twice.
//
// ---- WHY IT LIVES IN ITS OWN FILE ----
//
// It is the only part of the editor that is neither chrome nor editing. Keeping
// it apart means the toolbar stays about editing, and the help text can be
// reworded without touching anything a user drags.

import { useEffect, useRef, useState } from 'react';
import { X, Search, ThumbsUp, ThumbsDown, Sparkles } from 'lucide-react';

// ---------------------------------------------------------------------------
// Character placeholders: Wino, Mino, Rino
// ---------------------------------------------------------------------------
//
// The brand characters are NOT drawn yet. Rather than ship broken image boxes
// (which is how this app used to show a field of broken glyphs), each one is a
// CSS avatar: a coloured disc with the character's initial. It occupies exactly
// the space the final artwork will, so swapping the art in later is a one-line
// change per character and no layout moves.
//
// The tint is per-character and stable, so a user learns "the amber one is the
// short tips" without reading a label.
interface Character {
  id: 'wino' | 'mino' | 'rino';
  name: string;
  role: string;
  blurb: string;
  tint: string;
  ring: string;
}

const CHARACTERS: Character[] = [
  {
    id: 'wino',
    name: 'Wino',
    role: 'Keeps the cut tidy',
    blurb: 'Talks about handles, snapping and undo. Use him when a clip landed half a frame off from where you meant it to.',
    tint: 'from-amber-400 to-amber-600',
    ring: 'ring-amber-400/40',
  },
  {
    id: 'mino',
    name: 'Mino',
    role: 'Keeps it fast',
    blurb: 'Talks about large projects, waveforms and export. Use him when the timeline has more clips than eyes.',
    tint: 'from-emerald-400 to-emerald-600',
    ring: 'ring-emerald-400/40',
  },
  {
    id: 'rino',
    name: 'Rino',
    role: 'Explains the why',
    blurb: 'Explains what a setting actually does, and what it costs. Use him before you change something you cannot undo.',
    tint: 'from-sky-400 to-sky-600',
    ring: 'ring-sky-400/40',
  },
];

/** Placeholder avatar. Replaced by final artwork without moving anything. */
function CharacterAvatar({ c, size = 'md' }: { c: Character; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-14 w-14 text-[8px]' : size === 'sm' ? 'h-7 w-7 text-[8px]' : 'h-10 w-10 text-[8px]';
  return (
    <span
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${c.tint} font-semibold text-white shadow-sm ring-2 ${c.ring}`}
      title={`${c.name} - ${c.role} (character art pending)`}
      aria-hidden="true"
    >
      {c.name[0]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The reference content
// ---------------------------------------------------------------------------
//
// Every entry answers THREE questions, in this order: what is it, what is it
// good at, and what does it cost. The third is the one that is usually missing,
// and it is the reason a user either adopts a feature or turns it off forever.
//
// `cons` is deliberately allowed to be empty - a feature with no real downside
// should not invent one just to look balanced.

interface Entry {
  icon: string;
  name: string;
  does: string;
  good: string;
  cons: string;
  use: string;
}

const ENTRIES: Entry[] = [
  {
    icon: 'Magnet',
    name: 'Snapping (N)',
    does: 'Pulls a dragged clip onto the playhead, another clip’s edge, a marker or the timeline ends.',
    good: 'Cuts that line up frame-exactly without a ruler and a calculator.',
    cons: 'Fights you on a 30-pixel clip where every target is within 8px. Turn it off and nudge with the arrow keys.',
    use: 'Every precise join.',
  },
  {
    icon: 'Scissors',
    name: 'Blade (S)',
    does: 'Cuts the clip under the playhead into two, leaving every other clip exactly where it was.',
    good: 'Non-destructive: both halves are still editable and Ctrl+Z puts them back as one.',
    cons: 'Refuses a cut that would leave fewer than one frame on either side, because a one-frame clip cannot be grabbed.',
    use: 'Splitting a take at a natural break.',
  },
  {
    icon: 'Layers',
    name: 'Transitions',
    does: 'Blends two touching clips over a chosen length. The outgoing clip is held past its own end rather than trimmed.',
    good: 'Removing or re-timing a transition never moves a single frame of the edit underneath.',
    cons: 'A very long crossfade makes the second clip’s own content start late — audible as a lip-sync slip if there is dialogue.',
    use: 'Scene changes, and covering a hard cut at a doorway.',
  },
  {
    icon: 'LayoutGrid',
    name: 'Overlays / picture-in-picture',
    does: 'A second video lane drawn over the first, with its own size, corner and opacity.',
    good: 'Face-cam over a screen recording, or a logo corner over an export.',
    cons: 'Two lanes means twice the decode work — a four-track project is where playback starts to drop frames.',
    use: 'Tutorials, reaction edits, branding.',
  },
  {
    icon: 'MoveHorizontal',
    name: 'Ripple trim / Roll / Slip / Slide',
    does: 'Four different ways to move a boundary. Ripple shifts everything downstream; Roll moves the cut between two clips; Slip moves the source inside a fixed slot; Slide moves the clip between its neighbours.',
    good: 'Ripple is the one that keeps a cutlist free of gaps without hand-editing everything after it.',
    cons: 'Slip needs audio to be useful — on silent footage you are moving a picture you cannot tell has moved.',
    use: 'Ripple: tightening a talking head. Roll: syncing to music. Slip: starting a clip on the right word. Slide: nudging a middle clip.',
  },
  {
    icon: 'AudioWaveform',
    name: 'Waveforms',
    does: 'Decoded peaks drawn on the clip, so silence and speech are visible without playing.',
    good: 'Finds the gaps before you cut, which is most of the work in a talking-head edit.',
    cons: 'Decoding costs a moment the first time. A container the browser cannot decode shows a flat line — honest, but it looks like silence.',
    use: 'Voiceover and podcast timelines.',
  },
  {
    icon: 'Film',
    name: 'Export',
    does: 'Renders the timeline through the same compositor the preview uses, and records it to a file.',
    good: 'What you see is literally what you get — one renderer, two consumers.',
    cons: 'It is REAL-TIME, so a one-minute timeline takes a minute, and the container is whatever the browser’s encoder produces (WebM here).',
    use: 'Delivering a cut, not just previewing it.',
  },
  {
    icon: 'Undo2',
    name: 'Undo / Redo',
    does: 'Restores whole snapshots of the track list, and redo survives a browser refresh.',
    good: 'One action per edit — a slider dragged across twenty positions is one undo, not twenty.',
    cons: 'Fifty steps deep. Beyond that it forgets, which is deliberate: this is browser memory.',
    use: 'Trying things.',
  },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const rows = needle ? ENTRIES.filter((e) => (e.name + e.does + e.good + e.cons + e.use).toLowerCase().includes(needle)) : ENTRIES;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Editor help"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl"
      >
        {/* ---- Header: title, search, close ---- */}
        <header className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
          <Sparkles className="h-2 w-2 shrink-0 text-sky-400" aria-hidden="true" />
          <h2 className="text-[10px] font-semibold text-fg">What every control is for</h2>
          <div className="relative ml-auto w-52">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-2 w-2 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search help…"
              aria-label="Search help"
              className="w-full rounded-md border border-edge bg-surface-raised py-1 pl-7 pr-2 text-[8px] text-fg placeholder:text-fg-muted focus:border-sky-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="rounded p-1 text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg"
          >
            <X className="h-2 w-2" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* ---- Character row ----
              Placeholders, not artwork. They sit exactly where the finished
              art will, so adding it later moves nothing. */}
          <section className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CHARACTERS.map((c) => (
              <div key={c.id} className="flex items-start gap-2 rounded-lg border border-edge bg-surface-raised p-2">
                <CharacterAvatar c={c} />
                <div className="min-w-0">
                  <p className="text-[8px] font-semibold text-fg">
                    {c.name} <span className="font-normal text-fg-muted">· {c.role}</span>
                  </p>
                  <p className="mt-0.5 text-[8px] leading-snug text-fg-secondary">{c.blurb}</p>
                </div>
              </div>
            ))}
          </section>

          {/* ---- The reference table ---- */}
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-[8px] uppercase tracking-wide text-fg-muted">
                <th className="w-40 pb-1.5 font-medium">Control</th>
                <th className="pb-1.5 font-medium">What it does</th>
                <th className="pb-1.5 font-medium">Good at</th>
                <th className="pb-1.5 font-medium">The cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.name} className="border-t border-edge align-top">
                  <td className="py-2 pr-3 text-[8px] font-medium text-fg">{e.name}</td>
                  <td className="py-2 pr-3 text-[8px] text-fg-secondary">{e.does}</td>
                  <td className="py-2 pr-3 text-[8px] text-fg-secondary">
                    <ThumbsUp className="mr-1 inline h-2 w-2 -translate-y-px text-emerald-400" aria-hidden="true" />
                    {e.good}
                  </td>
                  <td className="py-2 text-[8px] text-fg-secondary">
                    <ThumbsDown className="mr-1 inline h-2 w-2 -translate-y-px text-amber-400" aria-hidden="true" />
                    {e.cons}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-[8px] text-fg-muted">
                    Nothing matches “{q}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="mt-3 text-[8px] leading-snug text-fg-muted">
            The character art for Wino, Mino and Rino is not final; those discs are placeholders and hold the
            exact space the artwork will occupy.
          </p>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-edge px-4 py-2">
          <CharacterAvatar c={CHARACTERS[0]} size="sm" />
          <span className="text-[8px] text-fg-muted">
            Full shortcut list lives in the Help panel in the left rail — this modal is the short version.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md bg-sky-600 px-3 py-1 text-[8px] font-medium text-white transition-colors hover:bg-sky-500"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
