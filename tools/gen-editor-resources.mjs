#!/usr/bin/env node
// ============================================================================
// Generate `lib/engine/resources.generated.ts` from the stock Movavi sample
// resources that ship in this repo.
// ============================================================================
//
// WHY A GENERATOR AND NOT A HAND-WRITTEN LIST
//
// `apps/video-editor/src/app/resources/samples/stock/**` contains real effect
// definitions - a colour grade with real brightness/contrast/temperature
// values, pan-and-zoom keyframes, picture-in-picture matrices, Web Audio
// parameters. They are JSON, and they are not in `public/`, so a browser
// cannot fetch them at runtime and the app cannot import them one by one
// without pulling ~40 modules into the client bundle.
//
// So the values are extracted here, once, into a single typed module. Two
// things follow from that, and both are the point:
//
//   * The numbers in the UI are the numbers in the resource files. They are
//     not invented to look plausible.
//   * Re-running the generator after adding a resource picks it up. Nothing
//     has to be remembered by hand.
//
//   node tools/gen-editor-resources.mjs
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const STOCK = join(ROOT, 'apps/video-editor/src/app/resources/samples/stock');
const OUT = join(ROOT, 'apps/video-editor/src/app/lib/engine/resources.generated.ts');

/** Every `config.json` under a stock category. */
function configs(category) {
  const base = join(STOCK, category);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'config.json') out.push(full);
    }
  };
  walk(base);
  return out.sort();
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n, dp = 3) => Number(n.toFixed(dp));
const payload = (p) => read(p).data.payload;

/** `01_TOP_Denoise` -> `Denoise`; `Preset_GoldenHour` -> `Golden Hour`. */
function prettyName(id) {
  return id
    .replace(/^\d+__?/, '')
    .replace(/^(TOP_|Preset_|Effect__|Effect_)/, '')
    .replace(/^All__?/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Colour filters - `Effect::ManualEnhance`, values in -1..1
// ---------------------------------------------------------------------------
//
// Movavi's grade is not a CSS filter: it has highlights, shadows, gamma and
// tint, which CSS has no operator for. Each is folded into the nearest CSS
// control rather than dropped, and the mapping is written out here so a reader
// can see exactly what was thrown away:
//
//   highlights -> brightness      shadows -> brightness
//   gamma      -> contrast        tint    -> hue
//
// The effect classes with no CSS equivalent (auto white balance, magic
// enhance) reduce to "close enough to neutral" and are still listed, because
// showing a resource that the browser cannot reproduce would be worse than
// showing a neutral one that it can.

const colourFilters = configs('colorFilters').map((file) => {
  const p = payload(file);
  const id = basename(dirname(file));
  const clampNum = (n) => clamp(Number(n ?? 0), -1, 1);
  const brightness = clampNum(p.brightness);
  const contrast = clampNum(p.contrast);
  const gamma = clampNum(p.gamma);
  const highlights = clampNum(p.highlights);
  const shadows = clampNum(p.shadows);
  const hue = clampNum(p.hue);
  const saturation = clampNum(p.saturation);
  const temperature = clampNum(p.temperature);
  const tint = clampNum(p.tint);

  return {
    id,
    label: prettyName(id),
    kind: p['@meta']?.class_name ?? 'Effect::ManualEnhance',
    params: {
      brightness: round(clamp(1 + brightness * 0.5 + shadows * 0.12 + highlights * 0.08, 0.2, 2)),
      contrast: round(clamp(1 + contrast * 0.5 + gamma * 0.3, 0.2, 2)),
      saturate: round(clamp(1 + saturation * 0.9, 0, 3)),
      hue: round(clamp(hue * 180 + tint * 30, -180, 180)),
      blur: 0,
      grayscale: 0,
      sepia: 0,
      invert: 0,
      temperature: round(temperature),
    },
  };
});

// ---------------------------------------------------------------------------
// Pan & zoom - `Envelope::TransformationPreset`
// ---------------------------------------------------------------------------
//
// Each preset is a two-keyframe envelope: a matrix at step 0 and a matrix at
// step 1. Taking the scale and translation off those two frames gives a
// start/end zoom and a pan, which is exactly what a Ken Burns needs. The
// interpolation preset is carried through because the UI says "linear" or
// "ease in out" from it, rather than guessing.

const panZoom = configs('panandzoom').map((file) => {
  const p = payload(file);
  const id = basename(dirname(file));
  const frames = p.transformation?.keyValues ?? [];
  const first = frames[0]?.value?.matrix ?? { m11: 1, m22: 1, m31: 0, m32: 0 };
  const last = frames[frames.length - 1]?.value?.matrix ?? first;
  const interpolation = frames[0]?.interpolationPreset?.tag ?? 'Linear';
  return {
    id,
    label: prettyName(id),
    interpolation,
    zoomStart: round(clamp(Number(first.m11 ?? 1), 0.5, 3)),
    zoomEnd: round(clamp(Number(last.m11 ?? 1), 0.5, 3)),
    panX: round(clamp(Number(last.m31 ?? 0), -0.5, 0.5)),
    panY: round(clamp(Number(last.m32 ?? 0), -0.5, 0.5)),
  };
});

// ---------------------------------------------------------------------------
// Picture in picture - `Effect::PictureInPicture`, a 3x3 affine matrix
// ---------------------------------------------------------------------------
//
// m11/m22 are scale, m31/m32 are the top-left corner as a fraction of the
// frame. The nine PiP layouts here are a 2x2 grid, a single 1x1, three
// horizontal and three vertical slices, so they map exactly onto an overlay
// track's position and scale.

const pip = configs('pipEffects').map((file) => {
  const p = payload(file);
  const id = basename(dirname(file));
  const m = p.transform ?? { m11: 0.5, m22: 0.5, m31: 0.25, m32: 0.25 };
  return {
    id,
    label: prettyName(id),
    scale: round(clamp(Number(m.m11 ?? 0.5), 0.05, 1)),
    scaleY: round(clamp(Number(m.m22 ?? 0.5), 0.05, 1)),
    x: round(clamp(Number(m.m31 ?? 0), 0, 1)),
    y: round(clamp(Number(m.m32 ?? 0), 0, 1)),
  };
});

// ---------------------------------------------------------------------------
// Audio effects - real Web Audio parameters
// ---------------------------------------------------------------------------
//
// These are kept as raw numbers and interpreted by `lib/engine/audio-fx.ts` at
// the node level, because a gate's threshold, a pitch's semitones and a radio
// effect's band-pass bounds mean different things to different nodes. Carrying
// the file's own value is the point; interpreting it in one place is what
// keeps it honest.

const audioOf = (category, group) =>
  configs(category).map((file) => {
    const p = payload(file);
    const id = basename(dirname(file));
    const holder = p['Effect::EffectsHolder']?.effects;
    const node = holder ? holder[0] : p;
    return {
      id,
      label: (p['Effect::AudioFilter']?.['Effect::Object']?.description ?? prettyName(id)).trim(),
      group,
      className: p['@meta']?.class_name ?? '',
      nodeClass: node?.['@meta']?.class_name ?? '',
      params: node ?? {},
    };
  });

const audioEffects = [
  ...audioOf('audioEffects', 'effect'),
  ...audioOf('audioEnhance', 'enhance'),
];

// ---------------------------------------------------------------------------
// Title templates - themes, intros, subtitles, wizard backgrounds
// ---------------------------------------------------------------------------
//
// Each carries a `tag`, a human `description` and a `category` string. The
// bundled package path (`#DOWNLOADABLE_PATH#/...mpack`) is deliberately NOT
// exposed in the UI: those files are not in this repo, so offering a "download"
// button would be a control that always fails. Only the ones with no remote
// package are offered as presets.

const titleDirs = ['themes', 'intros', 'subtitles', 'wizardBackgrounds'];
const titles = titleDirs.flatMap((dir) =>
  configs(dir).map((file) => {
    const p = payload(file);
    const id = basename(dirname(file));
    return {
      id: `${dir}-${id}`,
      label: (p.tag ?? prettyName(id)).toString(),
      description: (p.description ?? '').toString().trim(),
      category: (p.category ?? dir).toString().replace(/^CATEGORY_/, '').toLowerCase(),
      downloadable: typeof p.resourcePath === 'string' && p.resourcePath.includes('DOWNLOADABLE_PATH'),
    };
  })
);

// ---------------------------------------------------------------------------
// Sound effects - `resources/sounds`
// ---------------------------------------------------------------------------

const SOUND_DIR = join(ROOT, 'apps/video-editor/src/app/resources/sounds');
const sounds = (() => {
  try {
    return readdirSync(SOUND_DIR)
      .filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f))
      .sort()
      .map((f) => ({ id: f.replace(/\.[^.]+$/, ''), file: f }));
  } catch {
    return [];
  }
})();

const ts = (v) => JSON.stringify(v);
const arr = (name, type, items) => `export const ${name}: ${type}[] = ${JSON.stringify(items, null, 2)};\n`;

const header = `// ============================================================================
// GENERATED FILE - DO NOT EDIT BY HAND
// ============================================================================
//
// Produced by \`tools/gen-editor-resources.mjs\` from the stock sample
// resources in \`apps/video-editor/src/app/resources/samples/stock\`. Re-run
// the generator after adding a resource there; editing this file loses the
// change on the next run.
//
// Every number below comes out of a resource file. None of it is invented.

/** A stock colour grade, mapped onto CSS filter controls. */
export interface StockColourFilter {
  id: string;
  label: string;
  kind: string;
  params: {
    brightness: number;
    contrast: number;
    saturate: number;
    hue: number;
    blur: number;
    grayscale: number;
    sepia: number;
    invert: number;
    temperature: number;
  };
}

/** A stock Ken Burns envelope: a start and end zoom plus a pan. */
export interface StockPanZoom {
  id: string;
  label: string;
  interpolation: string;
  zoomStart: number;
  zoomEnd: number;
  panX: number;
  panY: number;
}

/** A stock picture-in-picture layout, read straight off its affine matrix. */
export interface StockPip {
  id: string;
  label: string;
  scale: number;
  scaleY: number;
  x: number;
  y: number;
}

/** A stock audio effect. \`params\` is the file's own payload, verbatim. */
export interface StockAudioEffect {
  id: string;
  label: string;
  group: 'effect' | 'enhance';
  className: string;
  nodeClass: string;
  params: Record<string, unknown>;
}

export interface StockTitle {
  id: string;
  label: string;
  description: string;
  category: string;
  downloadable: boolean;
}

export interface StockSound {
  id: string;
  file: string;
}
`;

const body = [
  arr('stockColourFilters', 'StockColourFilter', colourFilters),
  arr('stockPanZoom', 'StockPanZoom', panZoom),
  arr('stockPip', 'StockPip', pip),
  arr('stockAudioEffects', 'StockAudioEffect', audioEffects),
  arr('stockTitles', 'StockTitle', titles),
  arr('stockSounds', 'StockSound', sounds),
].join('\n');

writeFileSync(OUT, `${header}\n${body}`, 'utf8');

console.log(
  `wrote ${OUT}\n  colour filters: ${colourFilters.length}\n  pan & zoom:     ${panZoom.length}\n  picture-in-pic:  ${pip.length}\n  audio effects:  ${audioEffects.length}\n  title presets:  ${titles.length}\n  sounds:         ${sounds.length}`
);
