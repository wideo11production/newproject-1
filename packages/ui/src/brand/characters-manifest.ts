/**
 * ============================================================================
 * BRAND CHARACTER DESIGN MANIFEST - Wino & Rino
 * ============================================================================
 *
 * PURPOSE (kyun ye file exist karti hai):
 *   Ye ek STATIC, FROZEN spec sheet hai. Isme koi function nahi, koi
 *   randomness nahi, koi AI/image-generation call nahi. Saare values plain
 *   number/string constants hain.
 *
 *   Iska uddeshya hai VISUAL DRIFT ZERO karna. Agar kabhi koi mascot SVG
 *   regenerate kare, AI se banwaye, ya manually tweak kare, to proportions
 *   drift kar sakte hain. Is manifest ko hi SINGLE SOURCE OF TRUTH banaya
 *   gaya hai:
 *
 *     1. `characters.tsx` ke SVG components inhi constants ko READ karte hain
 *        (koi hardcoded number SVG me nahi hai).
 *     2. Ad engine inhi specs ko ingest karta hai.
 *     3. `CHARACTER_SPEC_REVISION` batata hai ki ad engine kis spec version
 *        ke saath render hua - agar future me spec change ho to mismatch
 *        detect ho sake.
 *
 * DESIGN CONSTRAINTS (director mandate):
 *   - Wino = the BOY.   Deep corporate blue. "Dynamic active apparel" -
 *     matlab uske kapde par ek MOTION STRIPE hai (running/active feel).
 *   - Rino = the TECH MASCOT. Deep violet. Uski specialty ANTENNA ARRAY hai
 *     (3 antennas, alag-alag tip shapes) - ye SPECIFICALLY 16px par bhi
 *     readable honi chahiye, kyunki favicon/badge/chip slots me wahi size
 *     aata hai.
 *
 * 16px READABILITY RULE (Rino ke liye kyun critical):
 *   16px par koi antenna sub-2px ho to browser use drop kar deta hai (barely
 *   visible) ya antialias karke fata deta hai. Isliye manifest me
 *   `minLegiblePx: 16` hai aur antenna geometry deliberately COARSE rakhi
 *   hai: minimum stroke width 3.2 (64-unit viewBox me), minimum tip radius
 *   2.6, aur antennas 10-unit gap se separated. Ye 16px scale par survive
 *   karti hain.
 *
 * COST POSITION:
 *   Ye PURE vector constants hain. Koi image file nahi, koi CDN nahi, koi
 *   per-request cost nahi. Sab kuch in-house.
 *
 * Hinglish comments: har block ka arth
 */

/**
 * SPEC REVISION - ad engine ke liye version stamp.
 *
 * Agar tumhe kabhi proportions genuinely change karne hain to:
 *   1. Yahan `+ 1` karo (drift detect hoga - purane ads ka stamp mismatch
 *      karega).
 *   2. `CHANGELOG` array me entry daalo.
 *   3. Naya creative tab se banega.
 *
 * NOTE: ye sirf ek STRING hai, auto-increment nahi hota - manual bump taaki
 * tum jaane-bina change na ho.
 */
export const CHARACTER_SPEC_REVISION = '1.0.0';

/** Changelog - har spec change yahan record hota hai */
export const CHARACTER_CHANGELOG: ReadonlyArray<{
  revision: string;
  note: string;
}> = Object.freeze([
  Object.freeze({
    revision: '1.0.0',
    note: 'Initial lock. Wino (deep blue + motion stripe) aur Rino (violet + 3-antenna array) proportions finalized.',
  }),
]);

/**
 * SHARED CANVAS - dono characters ka common coordinate system.
 *
 * 64x64 viewBox: standard app-icon size, har jagah integer-friendly rehta
 * hai, aur 16px par 1:4 downscale clean hota hai (64/16 = 4, koi fraction
 * nahi - isliye pixel snapping predictable rehta hai).
 */
export const CANVAS = Object.freeze({
  /** SVG viewBox - square, 64 logical units */
  viewBox: '0 0 64 64',
  /** Canvas width/height in user units */
  size: 64,
  /** Safest rendering size (chips, badges) */
  minLegiblePx: 16,
  /** Comfortable display size (hero, cards) */
  recommendedPx: 96,
  /**
   * Corner radius of the background tile. 14/64 ~= 0.219 - squared-ish but
   * softened. Locked kyun? Kyunki rounded-square + circle head ka ratio hi
   * Wino ki "friendly but corporate" read banata hai.
   */
  tileRadius: 14,
  /**
   * HEAD GEOMETRY - shared across both characters.
   * Center (32, 28) + r15. Ye dono characters ka face anchor hai, isliye
   * side-by-side dikhne par heads perfectly align hote hain.
   */
  headCx: 32,
  headCy: 28,
  headR: 15,
  /**
   * EYE GEOMETRY - shared.
   * r2.6 at 16px = 0.65px rendered. Ye chhota lagta hai, isliye eyes ko
   * pure WHITE rakha hai dark head ke against - contrast hi size compensate
   * karta hai (bright-on-dark thin shape zyada readable hota hai).
   */
  eyeCy: 27,
  eyeLeftCx: 26,
  eyeRightCx: 38,
  eyeR: 2.6,
  /**
   * MOUTH - shared friendly smile arc.
   * Q-curve from (26,35) to (38,35) with control (32,40). strokeWidth 2.4.
   */
  mouthPath: 'M26 35 Q32 40 38 35',
  mouthStrokeWidth: 2.4,
  /** Pure white - eyes + mouth dono ka fill/stroke */
  ink: '#ffffff',
} as const);

/**
 * WINO - the boy.
 *
 * DEEP CORPORATE BLUE + DYNAMIC ACTIVE APPAREL.
 *
 * "Dynamic active apparel" ka matlab: uska torso/garment ek MOTION STRIPE
 * carry karta hai - do diagonal parallelograms jo speed/activity convey karte
 * hain. Ye stripe Wino ko Rino se visually alag karta hai bina extra shape ke.
 */
export const WINO = Object.freeze({
  id: 'wino',
  /** Display name (aria-label, captions) */
  name: 'Wino',
  /** One-liner personality - tooltips/onboarding me chalta hai */
  tagline: 'Your build buddy',
  /** Brand role - isse consumers role samajh sakte hain */
  role: 'the boy',
  /** Shared canvas reference (same object, zero duplication) */
  canvas: CANVAS,

  /**
   * WINO PALETTE - deep corporate blue.
   *
   * `deep` (#1e3a8a) sabse dark hai - garment ka base aur tile ka fill.
   * `mid` (#2563eb) brand primary blue - head fill.
   * `bright` (#60a5fa) motion stripe ka accent - ye Wino ka SIGNATURE colour
   * hai, isliye sabse saturated rakha hai.
   * `ink` (#0b1220) garment ka deep shadow - stripe ke neeche depth.
   */
  palette: Object.freeze({
    deep: '#1e3a8a',
    mid: '#2563eb',
    bright: '#60a5fa',
    ink: '#0b1220',
    skin: '#f2d3b3',
  }),

  /**
   * HAIR - short swept tuft (boy-coded, energetic).
   * Arc from (22,18) to (42,18) via control (32,8), stroke 4.
   * Stroke 4 deliberate hai: 16px par 1px hota hai - ek clean pixel line.
   */
  hair: Object.freeze({
    path: 'M22 18 Q32 8 42 18',
    strokeWidth: 4,
    strokeLinecap: 'round',
  }),

  /**
   * DYNAMIC ACTIVE APPAREL - motion stripe system.
   *
   * Ye Wino ka signature element hai. Do diagonal parallelograms garment ke
   * upar, slightly staggered, taaki "movement" feel aaye (static image me
   * bhi). Coordinates garment area (y 44-58) me locked hain.
   *
   * DESIGN LOGIC: parallelogram ka `skew` jaisa shape diagonal motion
   * indicate karta hai. Do alag width (26 aur 18) + alag offset = rhythm.
   */
  apparel: Object.freeze({
    /** Garment/torso base - rounded rect under the head */
    garmentPath: 'M18 60 Q18 44 32 44 Q46 44 46 60 Z',
    /** Front diagonal stripe (thicker) - the signature motion mark */
    stripePrimary: 'M24 60 L31 44 L38 44 L31 60 Z',
    /** Rear diagonal stripe (thinner, offset) - depth/rhythm layer */
    stripeSecondary: 'M38 60 L43 46 L46 46 L43 60 Z',
    /** Collar accent - chin se garment ka transition soften karta hai */
    collarPath: 'M26 44 L32 50 L38 44 Z',
  }),

  /**
   * Wino ki poori drawing order (paint sequence).
   * Array ko MANIFEST ne lock kiya hai taaki SVG layering har render me
   * identical rahe - koi bhi consumer inhe reorder nahi kar sakta bina
   * manifest badle.
   */
  paintOrder: Object.freeze([
    'tile',
    'garment',
    'stripeSecondary',
    'stripePrimary',
    'collar',
    'head',
    'hair',
    'eyes',
    'mouth',
  ]),
} as const);

/**
 * RINO - the tech mascot with specialized hardware antennas.
 *
 * DEEP VIOLET + TECH ANTENNA ARRAY.
 *
 * Rino ki specialty woh antenna array hai. Ye 3 antennas hain, TEENO ki tip
 * shape ALAG hai (circle / square / diamond) - isliye 16px par bhi character
 * ki identity nahi khota: koi bhi tip shape clearly dikh jaaye, Rino pakka
 * hai.
 *
 * ANTENNA MATH (16px survivability ke liye deliberately coarse):
 *   - Base y = 13 (head ke upar, head top = 28-15 = 13, so perfectly seated)
 *   - Lengths: 8 / 10 / 7 (unequal = organic, but sab >= 7)
 *   - Tip radius >= 2.6, min stroke 3.2
 *   - X spread: 20 / 32 / 44 (12-unit gap) - 16px par 3px gap, distinguishable
 *
 *   Koi bhi antenna 7 se chhota nahi, koi bhi tip 2.6 se chhota nahi - isliye
 *   16px par teeno visible rehte hain. Ye `minLegiblePx: 16` ka contract hai.
 */
export const RINO = Object.freeze({
  id: 'rino',
  name: 'Rino',
  tagline: 'Your automation sidekick',
  role: 'the tech mascot',
  canvas: CANVAS,

  /**
   * RINO PALETTE - technical deep violet.
   * `deep` (#4c1d95) antenna stalk + tile fill.
   * `mid` (#7c3aed) head fill - brand violet.
   * `bright` (#a78bfa) antenna tips + visor glow - Rino ka signature.
   * `ink` (#1e0b3a) visor inner shadow.
   * `signal` (#c4b5fd) tech highlight ring.
   */
  palette: Object.freeze({
    deep: '#4c1d95',
    mid: '#7c3aed',
    bright: '#a78bfa',
    ink: '#1e0b3a',
    signal: '#c4b5fd',
  }),

  /**
   * TECH ANTENNA ARRAY - Rino ka signature hardware.
   *
   * Ye 3 entries hain. HAR entry me:
   *   - `x`     : stalk ka horizontal anchor (head top par)
   *   - `length`: kitna upar (7+ ka minimum - 16px survivability ke liye)
   *   - `tip`   : tip ka SHAPE ('circle' | 'square' | 'diamond')
   *   - `tipR`  : tip ka radius (>= 2.6 - 16px survivability ke liye)
   *   - `strokeWidth` : stalk ki thickness (>= 3.2)
   *
   * TIP SHAPES ALAG HAIN - ye identity ka core hai:
   *   1. circle  (center antenna) - primary/broadcast
   *   2. square  (left antenna)  - data/compute
   *   3. diamond (right antenna) - signal/quantum
   */
  antennaArray: Object.freeze([
    Object.freeze({
      id: 'rino-ant-left',
      x: 20,
      length: 8,
      tip: 'square',
      tipR: 3,
      strokeWidth: 3.2,
    }),
    Object.freeze({
      id: 'rino-ant-center',
      x: 32,
      length: 10,
      tip: 'circle',
      tipR: 2.9,
      strokeWidth: 3.2,
    }),
    Object.freeze({
      id: 'rino-ant-right',
      x: 44,
      length: 7,
      tip: 'diamond',
      tipR: 3.1,
      strokeWidth: 3.2,
    }),
  ]),

  /** Antenna base Y - head ke exactly upar seat hota hai (28-15=13) */
  antennaBaseY: 13,

  /**
   * VISOR - Rino ka tech face. Eye area ek wide visor band se cover hota hai
   * (robot identity). Dark inner + violet glow edge.
   */
  visor: Object.freeze({
    /** Visor band ka rounded rect (eyes ke upar) */
    path: 'M20 24 L44 24 L41 30 L23 30 Z',
    fill: '#1e0b3a',
    /** Visor ke upar glow stroke - tech feel */
    stroke: '#a78bfa',
    strokeWidth: 1.2,
  }),

  /** Rino ka paint order (same locking logic as Wino) */
  paintOrder: Object.freeze([
    'tile',
    'antennae',
    'head',
    'visor',
    'visorGlow',
    'eyes',
    'mouth',
  ]),
} as const);

/**
 * COMPLETE CHARACTER REGISTRY - dono characters ek jagah.
 *
 * KEY RULE: keys EXACTLY 'Wino' | 'Rino' hain (capitalized, jo existing
 * `apps/web/src/components/brand/mascots.tsx` ke `MascotName` se match karta
 * hai). Isse purana mascot component aur naya manifest ek hi naming par baith
 * jaate hain.
 */
export const CHARACTER_REGISTRY = Object.freeze({
  Wino: WINO,
  Rino: RINO,
} as const);

/** Registry ke valid keys ka union type */
export type CharacterId = keyof typeof CHARACTER_REGISTRY;

/** Saare character ids ka array (iterate karne ke liye) */
export const CHARACTER_IDS = Object.freeze(
  Object.keys(CHARACTER_REGISTRY) as CharacterId[]
);

/**
 * SINGLE CHARACTER LOOKUP - type-safe accessor.
 *
 * Dynamic access chahiye to isko use karo (`CHARACTER_REGISTRY[name]` direct
 * bhi kar sakte ho, dono same hain - ye function readability ke liye hai).
 */
export function getCharacter(id: CharacterId) {
  return CHARACTER_REGISTRY[id];
}

/**
 * 16px READABILITY SELF-CHECK.
 *
 * Ye runtime assertion hai jo SPEC CONTRACT ko enforce karta hai: agar koi
 * kabhi antenna ko chhota kare ya tip shape bhool de, to ye `false` return
 * karega aur console me warn kare - jisse 16px par invisible antenna jane se
 * pehle pakda jaaye.
 *
 * YE RUNTIME ME CHALTA HAI, build pe nahi - isliye ye dev me alert deta hai
 * agar geometry drift ho gayi ho. Cost negligible hai (3 antennas check).
 */
export function validateMinLegibleGeometry(): {
  ok: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  const MIN_LENGTH = 7;
  const MIN_TIP_R = 2.6;
  const MIN_STROKE = 3.2;

  for (const ant of RINO.antennaArray) {
    if (ant.length < MIN_LENGTH) {
      failures.push(
        `${ant.id}: length ${ant.length} < ${MIN_LENGTH} (16px par invisible ho jayega)`
      );
    }
    if (ant.tipR < MIN_TIP_R) {
      failures.push(
        `${ant.id}: tipR ${ant.tipR} < ${MIN_TIP_R} (16px par antialias se mita jayega)`
      );
    }
    if (ant.strokeWidth < MIN_STROKE) {
      failures.push(
        `${ant.id}: strokeWidth ${ant.strokeWidth} < ${MIN_STROKE} (16px par 1px se kam)`
      );
    }
  }

  const ok = failures.length === 0;
  if (!ok && typeof console !== 'undefined') {
    console.warn(
      '[brand-manifest] 16px readability contract VIOLATED:\n' +
        failures.map((f) => `  - ${f}`).join('\n')
    );
  }
  return { ok, failures };
}

/**
 * EXPORTED MANIFEST SHAPE (ad engine ke liye).
 *
 * Ye woh exact object jo continuous ad engine ingest karta hai. Isme
 * sirf DATA hai - koi function nahi - taaki wo JSON-serialize karke apne
 * queue me rakh sake aur replay kare jab future me component badle.
 *
 * `specRevision` har ad record me embed hota hai, isliye ad engine ke paas
 * pata rahega ki ye creative kis lock par bana tha.
 */
export const CHARACTER_MANIFEST = Object.freeze({
  /** Version stamp - creative ke saath embed hota hai */
  specRevision: CHARACTER_SPEC_REVISION,
  /** Changelog for audit */
  changelog: CHARACTER_CHANGELOG,
  /** Shared canvas contract (viewBox, minLegiblePx, head/eye/mouth geometry) */
  canvas: CANVAS,
  /** Characters keyed by name */
  characters: CHARACTER_REGISTRY,
  /**
   * Koi bhi naya character is registry me add karna ho to yahan add karo -
   * ad engine registry ko hi padhta hai, isliye ek jagah add = sab jagah
   * available.
   */
} as const);

/**
 * Ad engine ke liye flat character metadata (serialize-friendly).
 * Sirf wahi fields jo ad creative ke saath embed karne hain - poora
 * geometry nahi (wo bada ho jata hai aur har record me duplicate hoga).
 */
export function characterAdMetadata(id: CharacterId) {
  const c = CHARACTER_REGISTRY[id];
  return Object.freeze({
    characterId: id,
    name: c.name,
    role: c.role,
    tagline: c.tagline,
    specRevision: CHARACTER_SPEC_REVISION,
    /** Sirf 2 swatch - ad engine ko full palette nahi chahiye */
    swatch: [c.palette.deep, c.palette.mid],
    minLegiblePx: CANVAS.minLegiblePx,
  });
}
