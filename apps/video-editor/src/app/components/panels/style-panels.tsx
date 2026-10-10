'use client';

// ============================================================================
// Style panels: filters, titles, stickers, pan & zoom, overlay layouts
// ============================================================================
//
// All five are the same shape: a grid of real presets from the stock sample
// resources, a click that applies the selected one to the selected clip, and
// an honest line when there is nothing selected to apply it to.
//
// ---- WHERE THE PRESETS COME FROM ----
//
// `lib/engine/resources.generated.ts`, produced by `tools/gen-editor-resources.mjs`
// from `app/resources/samples/stock/**`. The colour grades carry the real
// brightness/contrast/saturation/temperature values out of Movavi's
// `Effect::ManualEnhance` files; the pan-and-zoom presets are the two-keyframe
// envelopes in `Envelope::TransformationPreset`; the picture-in-picture layouts
// are read straight off each effect's affine matrix. Nothing here is a
// hand-typed approximation of a resource that exists.
//
// A grade whose effect class the browser cannot reproduce (auto white balance,
// magic enhance) maps to near-neutral. It is still listed - hiding it would
// make the panel look like it was missing resources it has.

import { useMemo } from 'react';
import { Type, Smile, Move, LayoutGrid, Palette, Sticker as StickerIcon } from 'lucide-react';
import { PanelSection, Tile, TileGrid, Field, TextInput, Slider, EmptyState, Select, ColorInput, Toggle, Button, FontSelect, AnimationSelect } from './panel-kit';
import { stockColourFilters, stockPanZoom, stockPip, stockTitles } from '../../lib/engine/resources.generated';
import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_TEXT_ANIMATION,
  type ClipFilter,
  type ClipTransform,
  type TextAnimation,
  type TextAnimationKind,
  type TextClipStyle,
  type TimelineClip,
} from '../../lib/engine/types';

/** A real text style. Every one of these is rendered by the compositor. */
const TEXT_STYLES: Array<{ id: string; label: string; hint: string; style: Partial<TextClipStyle> }> = [
  { id: 'plain', label: 'Plain', hint: 'White, centred, no background', style: {} },
  {
    id: 'title',
    label: 'Title',
    hint: 'Large, bold, on a dark plate',
    style: { size: 0.1, weight: 800, background: 'rgba(0,0,0,0.55)', letterSpacing: 0.01 },
  },
  {
    id: 'lower-third',
    label: 'Lower third',
    hint: 'Small, left aligned, dark plate — the news chyron',
    style: { size: 0.05, weight: 600, align: 'left', background: 'rgba(0,0,0,0.72)' },
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    hint: 'Centred, italic, sits low',
    style: { size: 0.045, weight: 500, italic: true },
  },
  {
    id: 'callout',
    label: 'Callout',
    hint: 'Bright plate, black text',
    style: { size: 0.06, weight: 800, color: '#111827', background: '#fde047' },
  },
  { id: 'outline', label: 'Outline', hint: 'Coloured text with a hard shadow', style: { size: 0.085, weight: 800, color: '#f97316', shadow: true } },
];

/** Stickers. Drawn by the compositor as text on an overlay lane, so they need
 *  no image files and no network — and they scale with the project. */
const STICKERS: Array<{ id: string; label: string; hint: string; style: Partial<TextClipStyle> }> = [
  { id: 'thumbs-up', label: 'Thumbs up', hint: '👍', style: { content: '👍' } },
  { id: 'fire', label: 'Fire', hint: '🔥', style: { content: '🔥' } },
  { id: 'star', label: 'Star', hint: '⭐', style: { content: '⭐' } },
  { id: 'heart', label: 'Heart', hint: '❤️', style: { content: '❤️' } },
  { id: 'check', label: 'Check', hint: '✅', style: { content: '✅' } },
  { id: 'arrow', label: 'Arrow', hint: '➜', style: { content: '➜' } },
  { id: 'note', label: 'Music note', hint: '♪', style: { content: '♪' } },
  { id: 'sparkle', label: 'Sparkle', hint: '✦', style: { content: '✦' } },
];

const STICKER_COLOURS = ['#fde047', '#f97316', '#22d3ee', '#f472b6', '#a3e635', '#ffffff'];

export interface PanelClip {
  clip: TimelineClip | null;
  applyFilter: (f: Partial<ClipFilter>) => void;
  applyTransform: (t: Partial<ClipTransform>) => void;
  applyText: (t: Partial<TextClipStyle>) => void;
  addText: (style: Partial<TextClipStyle>, transform?: Partial<ClipTransform>) => void;
  addSticker: (emoji: string) => void;
}

function NoSelection({ what }: { what: string }) {
  return (
    <EmptyState
      title={`Select a clip to apply ${what}`}
      body="Click a clip on the timeline first — the panel then changes that one clip and nothing else."
    />
  );
}

export function FiltersPanel({ clip, applyFilter }: PanelClip) {
  const active = clip?.filter;
  return (
    <div className="space-y-3">
      <PanelSection title="Colour grades" hint="From the stock sample resources. Click to apply to the selected clip.">
        {active ? (
          <TileGrid>
            {stockColourFilters.map((f) => (
              <Tile
                key={f.id}
                label={f.label}
                hint={`${f.kind.split('::').pop()}`}
                swatch={gradeSwatch(f.params)}
                active={sameGrade(active, f.params)}
                onClick={() => applyFilter(f.params)}
                ariaLabel={`Apply the ${f.label} colour grade`}
              />
            ))}
          </TileGrid>
        ) : (
          <NoSelection what="a grade" />
        )}
      </PanelSection>

      {active && (
        <PanelSection
          title="Manual"
          action={
            <Button variant="outline" onClick={() => applyFilter({})}>
              Reset
            </Button>
          }
        >
          <p className="mb-2 text-[8px] text-fg-muted">
            Brightness, contrast, saturation and hue are the CSS filter operators, so what the slider
            says is what the canvas does. Temperature has no such operator and is applied as a warm or
            cool wash in the overlay blend mode.
          </p>
          <div className="space-y-2">
            <Field label="Brightness" hint={active.brightness.toFixed(2)}>
              <Slider min={0} max={2} step={0.01} value={active.brightness} ariaLabel="Brightness" onChange={(n) => applyFilter({ brightness: n })} />
            </Field>
            <Field label="Contrast" hint={active.contrast.toFixed(2)}>
              <Slider min={0} max={2} step={0.01} value={active.contrast} ariaLabel="Contrast" onChange={(n) => applyFilter({ contrast: n })} />
            </Field>
            <Field label="Saturation" hint={active.saturate.toFixed(2)}>
              <Slider min={0} max={3} step={0.01} value={active.saturate} ariaLabel="Saturation" onChange={(n) => applyFilter({ saturate: n })} />
            </Field>
            <Field label="Hue" hint={`${active.hue.toFixed(0)}°`}>
              <Slider min={-180} max={180} step={1} value={active.hue} ariaLabel="Hue rotation" onChange={(n) => applyFilter({ hue: n })} />
            </Field>
            <Field label="Temperature" hint={active.temperature > 0 ? 'warm' : active.temperature < 0 ? 'cool' : 'neutral'}>
              <Slider min={-1} max={1} step={0.01} value={active.temperature} ariaLabel="Temperature" onChange={(n) => applyFilter({ temperature: n })} />
            </Field>
            <Field label="Blur" hint={`${active.blur.toFixed(1)}px`}>
              <Slider min={0} max={24} step={0.5} value={active.blur} ariaLabel="Blur" onChange={(n) => applyFilter({ blur: n })} />
            </Field>
            <Field label="Greyscale" hint={active.grayscale.toFixed(2)}>
              <Slider min={0} max={1} step={0.01} value={active.grayscale} ariaLabel="Greyscale" onChange={(n) => applyFilter({ grayscale: n })} />
            </Field>
            <Field label="Sepia" hint={active.sepia.toFixed(2)}>
              <Slider min={0} max={1} step={0.01} value={active.sepia} ariaLabel="Sepia" onChange={(n) => applyFilter({ sepia: n })} />
            </Field>
            <Field label="Invert" hint={active.invert.toFixed(2)}>
              <Slider min={0} max={1} step={0.01} value={active.invert} ariaLabel="Invert" onChange={(n) => applyFilter({ invert: n })} />
            </Field>
          </div>
        </PanelSection>
      )}
    </div>
  );
}

function sameGrade(a: ClipFilter, b: ClipFilter): boolean {
  return (
    Math.abs(a.brightness - b.brightness) < 0.005 &&
    Math.abs(a.contrast - b.contrast) < 0.005 &&
    Math.abs(a.saturate - b.saturate) < 0.005 &&
    Math.abs(a.hue - b.hue) < 0.005 &&
    Math.abs(a.temperature - b.temperature) < 0.005
  );
}

/** A gradient that reads as the grade it names, for the tile. */
function gradeSwatch(p: ClipFilter): string {
  const h = Math.round(((p.hue % 360) + 360) % 360);
  const s = Math.round(Math.max(6, Math.min(90, p.saturate * 45)));
  const l1 = Math.round(Math.max(8, Math.min(60, p.brightness * 32 - p.contrast * 8)));
  const warm = p.temperature;
  return `from-[hsl(${h} ${s}% ${l1}%)] ${
    warm >= 0 ? `to-[hsl(${(h + 25) % 360} ${s + 8}% ${Math.max(6, l1 - 12)}%)]` : `to-[hsl(${(h + 215) % 360} ${s + 8}% ${Math.max(6, l1 - 12)}%)]`
  }`;
}

export function TitlesPanel({ clip, applyText, addText }: PanelClip) {
  const text = clip?.text ?? DEFAULT_TEXT_STYLE;
  return (
    <div className="space-y-3">
      <PanelSection title="Add a title" hint="Drops a text clip on the first text track, starting at the playhead.">
        <TileGrid>
          {TEXT_STYLES.map((s) => (
            <Tile
              key={s.id}
              label={s.label}
              hint={s.hint}
              onClick={() => addText({ ...s.style, content: s.label })}
            />
          ))}
        </TileGrid>
        {stockTitles.filter((t) => !t.downloadable).length > 0 && (
          <p className="mt-2 text-[8px] leading-snug text-fg-muted">
            {stockTitles.filter((t) => t.downloadable).length} bundled title themes in the sample
            resources point at a downloadable package that is not in this repository, so they are not
            offered — a button that always fails is worse than no button.
          </p>
        )}
      </PanelSection>

      {clip ? (
        <>
          <PanelSection title="Font">
            <div className="space-y-2">
              <Field label="Text">
                <TextInput value={text.content} ariaLabel="Title text" onChange={(v) => applyText({ content: v })} />
              </Field>
              <Field label="Font family">
                <FontSelect value={text.fontFamily} ariaLabel="Font family" onChange={(v) => applyText({ fontFamily: v })} />
              </Field>
              <Field label="Size" hint={`${(text.size * 100).toFixed(1)}% of frame height`}>
                <Slider min={0.02} max={0.3} step={0.005} value={text.size} ariaLabel="Title size" onChange={(n) => applyText({ size: n })} />
              </Field>
              <Field label="Weight" hint={String(text.weight)}>
                <Slider min={100} max={900} step={100} value={text.weight} ariaLabel="Font weight" onChange={(n) => applyText({ weight: n })} />
              </Field>
              <Field label="Colour">
                <ColorInput value={text.color} ariaLabel="Title colour" onChange={(v) => applyText({ color: v })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Toggle checked={text.italic} onChange={(v) => applyText({ italic: v })} label="Italic" />
                <Toggle checked={text.uppercase} onChange={(v) => applyText({ uppercase: v })} label="Uppercase" />
              </div>
            </div>
          </PanelSection>

          <PanelSection title="Background & Alignment">
            <div className="space-y-2">
              <Field label="Background">
                <ColorInput value={text.background === 'transparent' ? '#000000' : text.background} ariaLabel="Background colour" onChange={(v) => applyText({ background: v })} />
              </Field>
              <Field label="Background opacity" hint={`${Math.round((text.background === 'transparent' ? 0 : 0.65) * 100)}%`}>
                <Slider min={0} max={1} step={0.05} value={text.background === 'transparent' ? 0 : 0.65} ariaLabel="Background opacity" onChange={(n) => applyText({ background: n === 0 ? 'transparent' : `rgba(0,0,0,${n})` })} />
              </Field>
              <Field label="Alignment">
                <Select
                  value={text.align}
                  ariaLabel="Title alignment"
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Centre' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onChange={(v) => applyText({ align: v })}
                />
              </Field>
              <Field label="Letter spacing" hint={text.letterSpacing.toFixed(3)}>
                <Slider min={-0.05} max={0.5} step={0.005} value={text.letterSpacing} ariaLabel="Letter spacing" onChange={(n) => applyText({ letterSpacing: n })} />
              </Field>
              <Field label="Line height" hint={text.lineHeight.toFixed(2)}>
                <Slider min={0.8} max={3} step={0.05} value={text.lineHeight} ariaLabel="Line height" onChange={(n) => applyText({ lineHeight: n })} />
              </Field>
            </div>
          </PanelSection>

          <PanelSection title="Outline & Glow">
            <div className="space-y-2">
              <Field label="Outline width" hint={`${text.outlineWidth}px`}>
                <Slider min={0} max={8} step={0.5} value={text.outlineWidth} ariaLabel="Outline width" onChange={(n) => applyText({ outlineWidth: n })} />
              </Field>
              <Field label="Outline colour">
                <ColorInput value={text.outlineColor} ariaLabel="Outline colour" onChange={(v) => applyText({ outlineColor: v })} />
              </Field>
              <Field label="Glow width" hint={`${text.glowWidth}px`}>
                <Slider min={0} max={32} step={1} value={text.glowWidth} ariaLabel="Glow width" onChange={(n) => applyText({ glowWidth: n })} />
              </Field>
              <Field label="Glow colour">
                <ColorInput value={text.glowColor} ariaLabel="Glow colour" onChange={(v) => applyText({ glowColor: v })} />
              </Field>
              <Toggle checked={text.shadow} onChange={(v) => applyText({ shadow: v })} label="Drop shadow" hint="Classic drop shadow behind text" />
            </div>
          </PanelSection>

          <PanelSection title="Animation">
            <div className="space-y-2">
              <Field label="Animation">
                <AnimationSelect value={text.animation.kind} ariaLabel="Text animation" onChange={(v) => applyText({ animation: { ...text.animation, kind: v } })} />
              </Field>
              <Field label="Duration" hint={`${(text.animation.duration * 100).toFixed(0)}% of clip`}>
                <Slider min={0.1} max={1} step={0.05} value={text.animation.duration} ariaLabel="Animation duration" onChange={(n) => applyText({ animation: { ...text.animation, duration: n } })} />
              </Field>
              <Field label="Delay" hint={`${(text.animation.delay * 100).toFixed(0)}% of clip`}>
                <Slider min={0} max={1} step={0.05} value={text.animation.delay} ariaLabel="Animation delay" onChange={(n) => applyText({ animation: { ...text.animation, delay: n } })} />
              </Field>
              <Toggle checked={text.animation.loop} onChange={(v) => applyText({ animation: { ...text.animation, loop: v } })} label="Loop" hint="Repeat animation" />
            </div>
          </PanelSection>

          <PanelSection title="Presets">
            <TileGrid cols={2}>
              {[
                { id: 'plain', label: 'Plain', hint: 'Clean white text', style: { fontFamily: 'system', weight: 500, color: '#ffffff', size: 0.08, outlineWidth: 0, glowWidth: 0, animation: DEFAULT_TEXT_ANIMATION } },
                { id: 'cinematic', label: 'Cinematic', hint: 'Large serif with fade', style: { fontFamily: 'playfair', weight: 600, color: '#ffffff', size: 0.12, letterSpacing: 0.02, animation: { ...DEFAULT_TEXT_ANIMATION, kind: 'fade' as TextAnimationKind, duration: 0.5 } } },
                { id: 'neon', label: 'Neon', hint: 'Glowing outline effect', style: { fontFamily: 'montserrat', weight: 800, color: '#ffffff', size: 0.09, outlineWidth: 2, outlineColor: '#f97316', glowWidth: 12, glowColor: '#f97316', animation: { ...DEFAULT_TEXT_ANIMATION, kind: 'fade-up' as TextAnimationKind, duration: 0.6 } } },
                { id: 'typewriter', label: 'Typewriter', hint: 'Character reveal', style: { fontFamily: 'mono', weight: 500, color: '#a3e635', size: 0.07, animation: { ...DEFAULT_TEXT_ANIMATION, kind: 'typewriter' as TextAnimationKind, duration: 0.8 } } },
                { id: 'bounce', label: 'Bounce', hint: 'Playful entrance', style: { fontFamily: 'poppins', weight: 700, color: '#fde047', size: 0.09, animation: { ...DEFAULT_TEXT_ANIMATION, kind: 'bounce' as TextAnimationKind, duration: 0.7 } } },
                { id: 'rotate', label: 'Rotate In', hint: 'Spin entrance', style: { fontFamily: 'bebas', weight: 800, color: '#22d3ee', size: 0.1, animation: { ...DEFAULT_TEXT_ANIMATION, kind: 'rotate-in' as TextAnimationKind, duration: 0.8 } } },
                { id: 'wave', label: 'Wave', hint: 'Per-char wave motion', style: { fontFamily: 'raleway', weight: 600, color: '#f472b6', size: 0.08, animation: { ...DEFAULT_TEXT_ANIMATION, kind: 'wave' as TextAnimationKind, duration: 1, loop: true } } },
                { id: 'lower-third', label: 'Lower Third', hint: 'Broadcast style', style: { fontFamily: 'inter', weight: 500, color: '#ffffff', size: 0.05, align: 'left' as const, background: 'rgba(0,0,0,0.72)', animation: { ...DEFAULT_TEXT_ANIMATION, kind: 'slide-up' as TextAnimationKind, duration: 0.4 } } },
              ].map((s) => (
                <Tile
                  key={s.id}
                  label={s.label}
                  hint={s.hint}
                  onClick={() => applyText({ ...s.style, content: s.label })}
                />
              ))}
            </TileGrid>
          </PanelSection>
        </>
      ) : (
        <NoSelection what="title options" />
      )}
    </div>
  );
}

export function StickersPanel({ addSticker, clip, applyTransform }: PanelClip) {
  return (
    <div className="space-y-3">
      <PanelSection title="Stickers" hint="Drawn by the compositor on the overlay track — no image files, nothing to download.">
        <TileGrid cols={3}>
          {STICKERS.map((s) => (
            <Tile
              key={s.id}
              label={s.label}
              hint={s.hint}
              onClick={() => addSticker(s.style.content ?? '')}
              ariaLabel={`Add the ${s.label} sticker`}
            />
          ))}
        </TileGrid>
      </PanelSection>
      {clip && (
        <PanelSection title="Position this overlay">
          <div className="space-y-2">
            <Field label="Horizontal" hint={clip.transform.x.toFixed(2)}>
              <Slider min={0} max={1} step={0.01} value={clip.transform.x} ariaLabel="Overlay horizontal position" onChange={(n) => applyTransform({ x: n, fit: clip.transform.fit === 'pip' ? 'contain' : clip.transform.fit })} />
            </Field>
            <Field label="Vertical" hint={clip.transform.y.toFixed(2)}>
              <Slider min={0} max={1} step={0.01} value={clip.transform.y} ariaLabel="Overlay vertical position" onChange={(n) => applyTransform({ y: n, fit: clip.transform.fit === 'pip' ? 'contain' : clip.transform.fit })} />
            </Field>
            <Field label="Size" hint={`${Math.round(clip.transform.scale * 100)}%`}>
              <Slider min={0.05} max={2} step={0.01} value={clip.transform.scale} ariaLabel="Overlay size" onChange={(n) => applyTransform({ scale: n })} />
            </Field>
            <Field label="Rotation" hint={`${clip.transform.rotation.toFixed(0)}°`}>
              <Slider min={-180} max={180} step={1} value={clip.transform.rotation} ariaLabel="Overlay rotation" onChange={(n) => applyTransform({ rotation: n })} />
            </Field>
          </div>
        </PanelSection>
      )}
    </div>
  );
}

export function PanZoomPanel({ clip, applyTransform }: PanelClip) {
  if (!clip) {
    return (
      <div className="space-y-3">
        <PanelSection title="Pan & zoom" hint="A slow push in or pull out across the clip's own length.">
          <NoSelection what="a pan or zoom" />
        </PanelSection>
      </div>
    );
  }
  const t = clip.transform;
  const moving = t.zoomStart !== 1 || t.zoomEnd !== 1 || t.panX !== 0 || t.panY !== 0;
  return (
    <div className="space-y-3">
      <PanelSection
        title="Pan & zoom"
        hint="From the stock sample resources: each preset is the two-keyframe envelope in the file."
        action={
          moving ? (
            <Button variant="outline" onClick={() => applyTransform({ zoomStart: 1, zoomEnd: 1, panX: 0, panY: 0 })}>
              Clear
            </Button>
          ) : undefined
        }
      >
        <TileGrid>
          {stockPanZoom.map((p) => (
            <Tile
              key={p.id}
              label={p.label}
              hint={`${p.zoomStart.toFixed(2)}x → ${p.zoomEnd.toFixed(2)}x, ${p.interpolation.toLowerCase()}`}
              swatch="from-slate-600/60 to-slate-900/20"
              active={t.zoomStart === p.zoomStart && t.zoomEnd === p.zoomEnd && t.panX === p.panX && t.panY === p.panY}
              onClick={() =>
                applyTransform({ zoomStart: p.zoomStart, zoomEnd: p.zoomEnd, panX: p.panX, panY: p.panY })
              }
            />
          ))}
        </TileGrid>
      </PanelSection>

      <PanelSection title="Manual">
        <div className="space-y-2">
          <Field label="Zoom at start" hint={`${t.zoomStart.toFixed(2)}x`}>
            <Slider min={0.5} max={3} step={0.01} value={t.zoomStart} ariaLabel="Zoom at start" onChange={(n) => applyTransform({ zoomStart: n })} />
          </Field>
          <Field label="Zoom at end" hint={`${t.zoomEnd.toFixed(2)}x`}>
            <Slider min={0.5} max={3} step={0.01} value={t.zoomEnd} ariaLabel="Zoom at end" onChange={(n) => applyTransform({ zoomEnd: n })} />
          </Field>
          <Field label="Pan across" hint={t.panX.toFixed(2)}>
            <Slider min={-0.5} max={0.5} step={0.01} value={t.panX} ariaLabel="Horizontal pan" onChange={(n) => applyTransform({ panX: n })} />
          </Field>
          <Field label="Tilt across" hint={t.panY.toFixed(2)}>
            <Slider min={-0.5} max={0.5} step={0.01} value={t.panY} ariaLabel="Vertical pan" onChange={(n) => applyTransform({ panY: n })} />
          </Field>
        </div>
      </PanelSection>
    </div>
  );
}

/**
 * Overlay layouts.
 *
 * These are the affine matrices out of each `Effect::PictureInPicture` file,
 * so the grid of three-across and the corner inset are the real resource
 * geometry, not an approximation of it.
 */
export function LayoutsPanel({ clip, applyTransform }: PanelClip) {
  const layouts = useMemo(
    () =>
      stockPip.map((p) => ({
        ...p,
        swatch: 'from-sky-500/30 to-slate-900/40',
      })),
    []
  );
  return (
    <div className="space-y-3">
      <PanelSection title="Picture in picture" hint="Drop a video on an overlay track, then choose where it sits.">
        {clip ? (
          <>
            <TileGrid>
              {layouts.map((l) => (
                <Tile
                  key={l.id}
                  label={l.label}
                  hint={`${Math.round(l.scale * 100)}% wide at ${Math.round(l.x * 100)}%, ${Math.round(l.y * 100)}%`}
                  swatch={l.swatch}
                  active={clip.transform.fit === 'pip' && Math.abs(clip.transform.pipSize - l.scale) < 0.005 && clip.transform.x === l.x}
                  onClick={() =>
                    applyTransform({
                      fit: 'pip',
                      pipSize: l.scale,
                      x: l.x + l.scale / 2,
                      y: l.y + l.scaleY / 2,
                      scale: 1,
                    })
                  }
                />
              ))}
            </TileGrid>
            <div className="mt-2 space-y-2">
              <Field label="Size" hint={`${Math.round(clip.transform.pipSize * 100)}% of frame width`}>
                <Slider min={0.1} max={0.6} step={0.01} value={clip.transform.pipSize} ariaLabel="Picture in picture size" onChange={(n) => applyTransform({ pipSize: n })} />
              </Field>
              <Field label="Corner">
                <Select
                  value={clip.transform.corner}
                  ariaLabel="Picture in picture corner"
                  options={[
                    { value: 'top-left', label: 'Top left' },
                    { value: 'top-right', label: 'Top right' },
                    { value: 'bottom-left', label: 'Bottom left' },
                    { value: 'bottom-right', label: 'Bottom right' },
                  ]}
                  onChange={(v) => applyTransform({ corner: v })}
                />
              </Field>
              <Field label="Fit">
                <Select
                  value={clip.transform.fit}
                  ariaLabel="Fit mode"
                  options={[
                    { value: 'contain', label: 'Fit inside the frame' },
                    { value: 'cover', label: 'Fill the frame, crop the edges' },
                    { value: 'pip', label: 'Picture in picture' },
                    { value: 'fill', label: 'Stretch to fill' },
                  ]}
                  onChange={(v) => applyTransform({ fit: v })}
                />
              </Field>
            </div>
          </>
        ) : (
          <NoSelection what="a layout" />
        )}
      </PanelSection>
    </div>
  );
}

export const PANEL_ICONS = { Palette, Type, StickerIcon, Move, LayoutGrid };
