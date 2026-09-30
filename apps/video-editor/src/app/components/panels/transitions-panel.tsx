'use client';

// ============================================================================
// Transitions panel
// ============================================================================
//
// Picking a transition here drops it on the JOIN at the end of the selected
// clip, which is the only join a selected clip unambiguously has. Selecting a
// transition badge on the timeline instead switches this panel into editing
// that one, so the two surfaces are two views of the same object rather than
// two features that happen to overlap.
//
// ---- WHY A TRANSITION IS NOT A PROPERTY OF A CLIP ----
//
// It belongs to the boundary. Two clips swapped around would otherwise drag
// their transition with them, and then the transition would be sitting on a
// join that no longer exists. `atTime` on a `Transition`, resolved against the
// track, cannot go stale that way.

import { Shuffle, X, Clock } from 'lucide-react';
import { PanelSection, Tile, TileGrid, Slider, Field, Button, EmptyState } from './panel-kit';
import { TRANSITIONS, MAX_TRANSITION, DEFAULT_TRANSITION_DURATION } from '../../lib/engine/transitions';
import type { TimelineClip, TimelineTrack, Transition, TransitionType } from '../../lib/engine/types';

export interface JoinCandidate {
  trackId: string;
  /** The outgoing clip's end == the incoming clip's start. */
  atTime: number;
  label: string;
}

/**
 * Every join in the project, as a list the panel can offer.
 *
 * A join exists only where one clip ends exactly where the next begins. Two
 * clips with a gap have no boundary to put a transition on, and pretending
 * otherwise is how a user ends up with a transition that does nothing.
 */
export function findJoins(tracks: TimelineTrack[]): JoinCandidate[] {
  const out: JoinCandidate[] = [];
  for (const track of tracks) {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const end = a.startTime + a.duration;
      if (Math.abs(end - b.startTime) < 1e-3) {
        out.push({
          trackId: track.id,
          atTime: end,
          label: `${a.mediaName} → ${b.mediaName}`,
        });
      }
    }
  }
  return out;
}

/** The join at the end of a given clip, if the next clip starts exactly there. */
export function joinAtEndOf(clips: TimelineClip[], clipId: string): { atTime: number } | null {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const end = clip.startTime + clip.duration;
  const next = clips.find((c) => Math.abs(c.startTime - end) < 1e-3);
  return next ? { atTime: end } : null;
}

export function TransitionsPanel({
  tracks,
  transitions,
  selectedClipId,
  selectedTransitionId,
  onApply,
  onSelectTransition,
  onChangeTransition,
  onRemoveTransition,
  onClose,
}: {
  tracks: TimelineTrack[];
  transitions: Transition[];
  selectedClipId: string | null;
  selectedTransitionId: string | null;
  onApply: (trackId: string, atTime: number, type: TransitionType) => void;
  onSelectTransition: (id: string | null) => void;
  onChangeTransition: (id: string, patch: Partial<Transition>) => void;
  onRemoveTransition: (id: string) => void;
  onClose: () => void;
}) {
  const selected = transitions.find((t) => t.id === selectedTransitionId) ?? null;

  // A selected badge wins: the user clicked something on the timeline and is
  // editing exactly that, not "the join next to the selected clip".
  const clip = selectedClipId ? tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId) : null;
  const trackOfClip = clip ? tracks.find((t) => t.clips.some((c) => c.id === clip.id)) : null;
  const target = clip && trackOfClip ? joinAtEndOf(trackOfClip.clips, clip.id) : null;
  const joins = findJoins(tracks);

  return (
    <div className="space-y-3">
      {selected ? (
        <>
          <PanelSection
            title="Selected transition"
            action={
              <button
                type="button"
                onClick={() => onSelectTransition(null)}
                aria-label="Stop editing this transition"
                title="Back to the list"
                className="rounded p-0.5 text-fg-muted hover:bg-surface-overlay hover:text-fg"
              >
                <X className="h-3 w-3" />
              </button>
            }
          >
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-fg-secondary">
              <Clock className="h-3 w-3" aria-hidden="true" />
              At {selected.atTime.toFixed(2)}s on {tracks.find((t) => t.id === selected.trackId)?.name ?? 'a track'}
            </p>
            <TileGrid>
              {TRANSITIONS.map((def) => (
                <Tile
                  key={def.id}
                  label={def.label}
                  hint={def.hint}
                  swatch={def.accent}
                  active={selected.type === def.id}
                  onClick={() => onChangeTransition(selected.id, { type: def.id })}
                />
              ))}
            </TileGrid>
            <div className="mt-2">
              <Field label="Length" hint={`${selected.duration.toFixed(2)}s`}>
                <Slider
                  min={0.1}
                  max={MAX_TRANSITION}
                  step={0.1}
                  value={selected.duration}
                  ariaLabel="Transition length"
                  onChange={(n) => onChangeTransition(selected.id, { duration: n })}
                />
              </Field>
            </div>
            <div className="mt-2">
              <Button full variant="danger" onClick={() => onRemoveTransition(selected.id)}>
                Remove this transition
              </Button>
            </div>
          </PanelSection>
        </>
      ) : (
        <>
          <PanelSection title="Transitions" hint="Pick one to drop it on the join at the end of the selected clip.">
            {target && clip ? (
              <>
                <p className="mb-2 flex items-center gap-1.5 rounded border border-edge bg-surface-raised/60 px-2 py-1 text-[10px] text-fg-secondary">
                  <Shuffle className="h-3 w-3 shrink-0 text-sky-400" aria-hidden="true" />
                  <span className="truncate">
                    {clip.mediaName} → next clip, at {target.atTime.toFixed(2)}s
                  </span>
                </p>
                <TileGrid>
                  {TRANSITIONS.map((def) => (
                    <Tile
                      key={def.id}
                      label={def.label}
                      hint={def.hint}
                      swatch={def.accent}
                      onClick={() => onApply(clip ? trackOfClip!.id : '', target.atTime, def.id)}
                    />
                  ))}
                </TileGrid>
              </>
            ) : (
              <>
                <EmptyState
                  title={clip ? 'No join at the end of that clip' : 'Select a clip first'}
                  body={
                    clip
                      ? 'A transition needs two clips that meet exactly. Drag the next clip so its start touches this one’s end, or trim this one to reach it.'
                      : 'A transition sits between two clips. Select a clip, then pick one here to place it on the join at that clip’s end.'
                  }
                />
                {joins.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {joins.map((j) => (
                      <li key={`${j.trackId}-${j.atTime}`}>
                        <button
                          type="button"
                          onClick={() => {
                            const first = tracks.find((t) => t.id === j.trackId)?.clips.find(
                              (c) => Math.abs(c.startTime + c.duration - j.atTime) < 1e-3
                            );
                            if (first) {
                              const existing = transitions.find(
                                (t) => t.trackId === j.trackId && Math.abs(t.atTime - j.atTime) < 1e-3
                              );
                              onSelectTransition(existing?.id ?? null);
                            }
                          }}
                          className="w-full truncate rounded border border-edge px-2 py-1 text-left text-[10px] text-fg-secondary hover:border-edge-strong hover:text-fg"
                          title={j.label}
                        >
                          {j.label} · {j.atTime.toFixed(2)}s
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </PanelSection>
        </>
      )}

      <p className="text-[10px] leading-snug text-fg-muted">
        A transition overlaps the two clips for its length. The outgoing clip is held past the cut and
        the incoming one is drawn over it, so applying or removing one never moves a single frame of
        the edit underneath. Default length {DEFAULT_TRANSITION_DURATION}s, maximum {MAX_TRANSITION}s.
      </p>
    </div>
  );
}
