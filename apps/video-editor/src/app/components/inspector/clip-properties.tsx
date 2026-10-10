'use client';

// ============================================================================
// Clip properties
// ============================================================================
//
// One dialog for everything about a single clip. It exists because the same
// numbers were previously scattered across a panel, a right-click menu that
// did not exist, and the timeline itself - so "where do I change the speed"
// had no answer.
//
// Opened by double-clicking a clip, by the properties button on a selected
// clip, or by pressing Enter.

import { X, RotateCcw, Gauge, Volume2, Sparkles, Move, Type as TypeIcon, Link2 } from 'lucide-react';
import { PanelSection, Field, Slider, Select, NumberInput, ColorInput, Toggle, Button, TextInput, FontSelect, AnimationSelect } from '../panels/panel-kit';
import {
  DEFAULT_TRANSFORM,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TEXT_ANIMATION,
  NEUTRAL_FILTER,
  type ClipFilter,
  type ClipTransform,
  type TextAnimationKind,
  type TextClipStyle,
  type TimelineClip,
} from '../../lib/engine/types';

export function ClipProperties({
  clip,
  fps,
  onPatch,
  onReset,
  onClose,
  onOpenFilters,
  onOpenLayouts,
  linkedClip,
  onUnlink,
}: {
  clip: TimelineClip | null;
  /** The timeline's rate. Frame fields are computed with it, so a clip's
   *  duration means something concrete rather than "some number of frames". */
  fps: number;
  onPatch: (patch: Partial<TimelineClip>) => void;
  onReset: () => void;
  onClose: () => void;
  onOpenFilters: () => void;
  onOpenLayouts: () => void;
  linkedClip: TimelineClip | null;
  onUnlink: () => void;
}) {
  if (!clip) return null;
  const f = clip.filter;
  const t: ClipTransform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const text: TextClipStyle = { ...DEFAULT_TEXT_STYLE, ...clip.text };
  const setFilter = (p: Partial<ClipFilter>) => onPatch({ filter: { ...f, ...p } });
  const setTransform = (p: Partial<ClipTransform>) => onPatch({ transform: { ...t, ...p } });
  const setText = (p: Partial<TextClipStyle>) => onPatch({ text: { ...text, ...p } });
  const isVisual = clip.type === 'video' || clip.type === 'image';
  const isSound = clip.type === 'audio' || clip.type === 'video';

  return (
    <div
      role="dialog"
      aria-label={`Properties of ${clip.mediaName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-md-edge-strong bg-surface-raised shadow-2xl">
        <header className="flex items-center justify-between-edge px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-[10px] font-medium text-fg">{clip.mediaName}</h2>
            <p className="font-mono text-[8px] text-fg-muted">
              {clip.type} · frames {Math.round(clip.startTime * fps)}–{Math.round((clip.startTime + clip.duration) * fps)} ·{' '}
              {Math.round(clip.duration * fps)}f at {fps}fps
              {clip.sourceIn > 0 && ` · source in ${Math.round(clip.sourceIn * fps)}f`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close clip properties"
            className="rounded p-1 text-fg-muted hover:bg-surface-overlay hover:text-fg"
          >
            <X className="h-2 w-2" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-6 gap-y-0 overflow-y-auto p-4 md:grid-cols-2">
          <div className="space-y-3">
            <PanelSection title="Timing">
              <div className="space-y-2">
                <Field label="Start on the timeline" hint={`${clip.startTime.toFixed(2)}s`}>
                  <NumberInput
                    value={Number(clip.startTime.toFixed(2))}
                    min={0}
                    step={0.1}
                    ariaLabel="Start time"
                    onChange={(n) => onPatch({ startTime: Math.max(0, n) })}
                  />
                </Field>
                <Field label="Duration" hint={`${clip.duration.toFixed(2)}s`}>
                  <NumberInput
                    value={Number(clip.duration.toFixed(2))}
                    min={0.2}
                    step={0.1}
                    ariaLabel="Duration"
                    onChange={(n) => onPatch({ duration: Math.max(0.2, n) })}
                  />
                </Field>
                <Field label="Start within the source" hint={`${clip.sourceIn.toFixed(2)}s`}>
                  <NumberInput
                    value={Number(clip.sourceIn.toFixed(2))}
                    min={0}
                    step={0.1}
                    ariaLabel="Source in point"
                    onChange={(n) => onPatch({ sourceIn: Math.max(0, n) })}
                  />
                </Field>
                <Field
                  label="Speed"
                  hint={`${clip.speed.toFixed(2)}x`}
                >
                  <Slider
                    min={0.1}
                    max={4}
                    step={0.05}
                    value={clip.speed}
                    ariaLabel="Playback speed"
                    onChange={(n) => onPatch({ speed: n })}
                  />
                </Field>
                <p className="text-[8px] leading-snug text-fg-muted">
                  Speed changes how fast the source plays. The preview seeks the underlying media to
                  the matching offset every frame, and the exporter does the same, so 2x here is 2x in
                  the file you export.
                </p>
              </div>
            </PanelSection>

            {isSound && (
              <PanelSection title="Audio">
                <div className="space-y-2">
                  <Field label="Volume" hint={`${Math.round(clip.volume * 100)}%`}>
                    <Slider min={0} max={1} step={0.01} value={clip.volume} ariaLabel="Clip volume" onChange={(n) => onPatch({ volume: n })} />
                  </Field>
                  <Field label="Fade in" hint={`${clip.fadeIn.toFixed(2)}s`}>
                    <Slider
                      min={0}
                      max={Math.max(0.5, clip.duration / 2)}
                      step={0.05}
                      value={clip.fadeIn}
                      ariaLabel="Fade in"
                      onChange={(n) => onPatch({ fadeIn: n })}
                    />
                  </Field>
                  <Field label="Fade out" hint={`${clip.fadeOut.toFixed(2)}s`}>
                    <Slider
                      min={0}
                      max={Math.max(0.5, clip.duration / 2)}
                      step={0.05}
                      value={clip.fadeOut}
                      ariaLabel="Fade out"
                      onChange={(n) => onPatch({ fadeOut: n })}
                    />
                  </Field>
                  <Toggle
                    checked={clip.muted}
                    onChange={(v) => onPatch({ muted: v })}
                    label="Mute this clip"
                    hint="Silences the clip without touching the track fader"
                  />
                  <Button variant="outline" onClick={() => onPatch({ volume: 1, fadeIn: 0, fadeOut: 0, muted: false })}>
                    <Volume2 className="h-2 w-2" aria-hidden="true" />
                    Reset audio
                  </Button>
                </div>
              </PanelSection>
            )}

            {clip.linkedId && (
              <PanelSection title="Linked clip">
                <p className="mb-2 flex items-start gap-1.5 text-[8px] text-fg-secondary">
                  <Link2 className="mt-0.5 h-2 w-2 shrink-0 text-emerald-400" aria-hidden="true" />
                  {linkedClip ? `Linked to “${linkedClip.mediaName}”. Moving one moves the other.` : 'The clip this was linked to has been removed.'}
                </p>
                <Button variant="danger" onClick={onUnlink}>
                  Unlink
                </Button>
              </PanelSection>
            )}
          </div>

          <div className="space-y-3">
            {isVisual && (
              <PanelSection title="Opacity and fit">
                <div className="space-y-2">
                  <Field label="Opacity" hint={`${Math.round(clip.opacity * 100)}%`}>
                    <Slider min={0} max={1} step={0.01} value={clip.opacity} ariaLabel="Clip opacity" onChange={(n) => onPatch({ opacity: n })} />
                  </Field>
                  <Field label="Fit">
                    <Select
                      value={t.fit}
                      ariaLabel="Fit mode"
                      options={[
                        { value: 'contain', label: 'Fit inside the frame (letterbox)' },
                        { value: 'cover', label: 'Fill the frame (crop)' },
                        { value: 'fill', label: 'Stretch to fill' },
                        { value: 'pip', label: 'Picture in picture' },
                      ]}
                      onChange={(v) => setTransform({ fit: v })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Horizontal" hint={t.x.toFixed(2)}>
                      <Slider min={0} max={1} step={0.01} value={t.x} ariaLabel="Horizontal position" onChange={(n) => setTransform({ x: n })} />
                    </Field>
                    <Field label="Vertical" hint={t.y.toFixed(2)}>
                      <Slider min={0} max={1} step={0.01} value={t.y} ariaLabel="Vertical position" onChange={(n) => setTransform({ y: n })} />
                    </Field>
                    <Field label="Size" hint={`${Math.round(t.scale * 100)}%`}>
                      <Slider min={0.05} max={2} step={0.01} value={t.scale} ariaLabel="Scale" onChange={(n) => setTransform({ scale: n })} />
                    </Field>
                    <Field label="Rotation" hint={`${t.rotation.toFixed(0)}°`}>
                      <Slider min={-180} max={180} step={1} value={t.rotation} ariaLabel="Rotation" onChange={(n) => setTransform({ rotation: n })} />
                    </Field>
                  </div>
                  {t.fit === 'pip' && (
                    <>
                      <Field label="PIP size" hint={`${Math.round(t.pipSize * 100)}%`}>
                        <Slider min={0.1} max={0.6} step={0.01} value={t.pipSize} ariaLabel="Picture in picture size" onChange={(n) => setTransform({ pipSize: n })} />
                      </Field>
                      <Field label="Corner">
                        <Select
                          value={t.corner}
                          ariaLabel="Picture in picture corner"
                          options={[
                            { value: 'top-left', label: 'Top left' },
                            { value: 'top-right', label: 'Top right' },
                            { value: 'bottom-left', label: 'Bottom left' },
                            { value: 'bottom-right', label: 'Bottom right' },
                          ]}
                          onChange={(v) => setTransform({ corner: v })}
                        />
                      </Field>
                    </>
                  )}
                  <div className="flex gap-1.5">
                    <Button variant="outline" onClick={onOpenLayouts}>
                      <Move className="h-2 w-2" aria-hidden="true" />
                      Layouts
                    </Button>
                    <Button variant="outline" onClick={onOpenFilters}>
                      <Sparkles className="h-2 w-2" aria-hidden="true" />
                      Filters
                    </Button>
                  </div>
                </div>
              </PanelSection>
            )}

            {isVisual && (
              <PanelSection
                title="Colour"
                action={
                  <Button variant="outline" onClick={() => onPatch({ filter: { ...NEUTRAL_FILTER } })}>
                    <RotateCcw className="h-2 w-2" aria-hidden="true" />
                    Reset
                  </Button>
                }
              >
                <div className="space-y-2">
                  <Field label="Brightness" hint={f.brightness.toFixed(2)}>
                    <Slider min={0} max={2} step={0.01} value={f.brightness} ariaLabel="Brightness" onChange={(n) => setFilter({ brightness: n })} />
                  </Field>
                  <Field label="Contrast" hint={f.contrast.toFixed(2)}>
                    <Slider min={0} max={2} step={0.01} value={f.contrast} ariaLabel="Contrast" onChange={(n) => setFilter({ contrast: n })} />
                  </Field>
                  <Field label="Saturation" hint={f.saturate.toFixed(2)}>
                    <Slider min={0} max={3} step={0.01} value={f.saturate} ariaLabel="Saturation" onChange={(n) => setFilter({ saturate: n })} />
                  </Field>
                  <Field label="Hue" hint={`${f.hue.toFixed(0)}°`}>
                    <Slider min={-180} max={180} step={1} value={f.hue} ariaLabel="Hue" onChange={(n) => setFilter({ hue: n })} />
                  </Field>
                  <Field label="Temperature" hint={f.temperature.toFixed(2)}>
                    <Slider min={-1} max={1} step={0.01} value={f.temperature} ariaLabel="Temperature" onChange={(n) => setFilter({ temperature: n })} />
                  </Field>
                  <Field label="Blur" hint={`${f.blur.toFixed(1)}px`}>
                    <Slider min={0} max={24} step={0.5} value={f.blur} ariaLabel="Blur" onChange={(n) => setFilter({ blur: n })} />
                  </Field>
                </div>
              </PanelSection>
            )}

            {clip.type === 'text' && (
              <PanelSection title="Text">
                <div className="space-y-2">
                  <Field label="Words">
                    <TextInput value={text.content} ariaLabel="Title text" onChange={(v) => setText({ content: v })} />
                  </Field>
                  <Field label="Font family">
                    <FontSelect value={text.fontFamily} ariaLabel="Font family" onChange={(v) => setText({ fontFamily: v })} />
                  </Field>
                  <Field label="Size" hint={`${(text.size * 100).toFixed(1)}%`}>
                    <Slider min={0.02} max={0.3} step={0.005} value={text.size} ariaLabel="Text size" onChange={(n) => setText({ size: n })} />
                  </Field>
                  <Field label="Weight" hint={String(text.weight)}>
                    <Slider min={100} max={900} step={100} value={text.weight} ariaLabel="Font weight" onChange={(n) => setText({ weight: n })} />
                  </Field>
                  <Field label="Colour">
                    <ColorInput value={text.color} ariaLabel="Text colour" onChange={(v) => setText({ color: v })} />
                  </Field>
                  <Field label="Background">
                    <ColorInput value={text.background === 'transparent' ? '#000000' : text.background} ariaLabel="Background colour" onChange={(v) => setText({ background: v })} />
                  </Field>
                  <Field label="Alignment">
                    <Select
                      value={text.align}
                      ariaLabel="Text alignment"
                      options={[
                        { value: 'left', label: 'Left' },
                        { value: 'center', label: 'Centre' },
                        { value: 'right', label: 'Right' },
                      ]}
                      onChange={(v) => setText({ align: v })}
                    />
                  </Field>
                  <Field label="Letter spacing" hint={text.letterSpacing.toFixed(3)}>
                    <Slider min={-0.05} max={0.5} step={0.005} value={text.letterSpacing} ariaLabel="Letter spacing" onChange={(n) => setText({ letterSpacing: n })} />
                  </Field>
                  <Field label="Line height" hint={text.lineHeight.toFixed(2)}>
                    <Slider min={0.8} max={3} step={0.05} value={text.lineHeight} ariaLabel="Line height" onChange={(n) => setText({ lineHeight: n })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Toggle checked={text.italic} onChange={(v) => setText({ italic: v })} label="Italic" />
                    <Toggle checked={text.uppercase} onChange={(v) => setText({ uppercase: v })} label="Uppercase" />
                    <Toggle checked={text.shadow} onChange={(v) => setText({ shadow: v })} label="Drop shadow" />
                  </div>
                  <div className="border-t border-[#2a2a2a] pt-2 mt-2 space-y-2">
                    <Field label="Outline width" hint={`${text.outlineWidth}px`}>
                      <Slider min={0} max={8} step={0.5} value={text.outlineWidth} ariaLabel="Outline width" onChange={(n) => setText({ outlineWidth: n })} />
                    </Field>
                    <Field label="Outline colour">
                      <ColorInput value={text.outlineColor} ariaLabel="Outline colour" onChange={(v) => setText({ outlineColor: v })} />
                    </Field>
                    <Field label="Glow width" hint={`${text.glowWidth}px`}>
                      <Slider min={0} max={32} step={1} value={text.glowWidth} ariaLabel="Glow width" onChange={(n) => setText({ glowWidth: n })} />
                    </Field>
                    <Field label="Glow colour">
                      <ColorInput value={text.glowColor} ariaLabel="Glow colour" onChange={(v) => setText({ glowColor: v })} />
                    </Field>
                  </div>
                  <div className="border-t border-[#2a2a2a] pt-2 mt-2 space-y-2">
                    <Field label="Animation">
                      <AnimationSelect value={text.animation.kind} ariaLabel="Text animation" onChange={(v: TextAnimationKind) => setText({ animation: { ...text.animation, kind: v } })} />
                    </Field>
                    <Field label="Duration" hint={`${(text.animation.duration * 100).toFixed(0)}%`}>
                      <Slider min={0.1} max={1} step={0.05} value={text.animation.duration} ariaLabel="Animation duration" onChange={(n) => setText({ animation: { ...text.animation, duration: n } })} />
                    </Field>
                    <Field label="Delay" hint={`${(text.animation.delay * 100).toFixed(0)}%`}>
                      <Slider min={0} max={1} step={0.05} value={text.animation.delay} ariaLabel="Animation delay" onChange={(n) => setText({ animation: { ...text.animation, delay: n } })} />
                    </Field>
                    <Toggle checked={text.animation.loop} onChange={(v) => setText({ animation: { ...text.animation, loop: v } })} label="Loop animation" />
                  </div>
                </div>
              </PanelSection>
            )}

            <PanelSection title="Reset">
              <Button variant="outline" onClick={onReset}>
                <RotateCcw className="h-2 w-2" aria-hidden="true" />
                Reset every property on this clip
              </Button>
              <p className="mt-1.5 flex items-start gap-1.5 text-[8px] leading-snug text-fg-muted">
                <TypeIcon className="mt-0.5 h-2 w-2 shrink-0" aria-hidden="true" />
                Position, size and duration are left alone — resetting those would move the clip, and
                a button that quietly re-arranges your edit is not a reset.
              </p>
            </PanelSection>
          </div>
        </div>

        <footer className="flex items-center justify-between-edge px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[8px] text-fg-muted">
            <Gauge className="h-2 w-2" aria-hidden="true" />
            Changes apply to this clip only, and Ctrl+Z brings them back.
          </span>
          <Button onClick={onClose}>Done</Button>
        </footer>
      </div>
    </div>
  );
}
