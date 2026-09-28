/**
 * ============================================================================
 * BRAND CHARACTER COMPONENTS - Wino & Rino (static inline SVG)
 * ============================================================================
 *
 * CRITICAL ARCHITECTURE RULE (drift prevention):
 *   Is file me KOI bhi geometry number HARD-CODED NAHI hai. Saare numbers
 *   `characters-manifest.ts` se READ hote hain:
 *     - viewBox            -> CANVAS.viewBox
 *     - head circle        -> CANVAS.headCx/headCy/headR
 *     - eyes               -> CANVAS.eyeLeftCx/eyeRightCx/eyeCy/eyeR
 *     - mouth              -> CANVAS.mouthPath + mouthStrokeWidth
 *     - tile radius        -> CANVAS.tileRadius
 *     - Wino hair/apparel  -> WINO.hair.*, WINO.apparel.*
 *     - Rino antennas      -> RINO.antennaArray (loop - array me jitne bhi)
 *     - palettes           -> WINO.palette.*, RINO.palette.*
 *
 *   Matlab: manifest badlo -> dono SVG automatically badal jaate hain. SVG aur
 *   manifest kabhi diverge hi nahi ho sakte. Yehi "visual drift zero" ka
 *   mechanism hai - AI regeneration, manual tweak, ya koi bhi change ek hi
 *   jagah se control hota hai.
 *
 * WHY INLINE SVG (not <img>):
 *   - Koi network request nahi (koi CDN nahi, koi paid asset nahi)
 *   - CSS se colour/size directly control ho sakti hai
 *   - 16px tak crisp rahega (vector resample hota hai, blur nahi)
 *   - Koi AI-generated pixel-art nahi - pure deterministic vector primitives
 *
 * ACCESSIBILITY:
 *   - `role="img"` + `aria-label` (name + tagline) - screen readers ke liye
 *   - `aria-hidden` option available - jab koi parent already label de raha ho
 *   - `focusable="false"` - IE/Edge legacy ke liye (SVG focusable bug)
 *
 * SERVER-SAFE: ye component koi hook use nahi karta, koi window access nahi
 * karta - isliye Server Component aur Client Component dono me render ho
 * sakta hai (Next.js App Router me koi constraint nahi).
 *
 * Hinglish comments: har block ka arth
 */

import {
  CANVAS,
  RINO,
  WINO,
  validateMinLegibleGeometry,
  type CharacterId,
} from './characters-manifest';

/**
 * Shared props - dono components ke liye common.
 *
 * `size` px me hai. `className` caller styling ke liye (tailwind).
 * Note: hum `width`/`height` attributes set karte hain JAB `size` diya ho -
 * warna SVG default 100%×auto stretch karega, jo flex layout me unpredictable
 * ho sakta hai.
 */
export interface BrandCharacterProps {
  /** Render size in px. Default = manifest ka recommendedPx (96) */
  size?: number;
  /** Extra classes - sizing override, positioning, etc. */
  className?: string;
  /**
   * Accessible label override. Default = manifest se auto-generated
   * (`"{name} - {tagline}"`).
   */
  label?: string;
  /**
   * `true` ho to SVG screen readers se hide ho jayega.
   * Use when: parent element already accessible name de raha ho
   * (e.g. `<button aria-label="Play Wino promo">`).
   */
  decorative?: boolean;
}

/**
 * Dev-time 16px readability contract check.
 *
 * Ye SIRF development me chalta hai (`process.env.NODE_ENV !== 'production'`).
 * Production me tree-shake ho jata hai - koi runtime cost nahi.
 *
 * Ye ek baar per module-load check karta hai (module-level flag), taaki har
 * render me repeat na ho.
 */
let geometryChecked = false;
// NOTE: bracket notation `['NODE_ENV']` - is package ka tsconfig
// `noPropertyAccessFromIndexSignature` ON rakhta hai, to dot notation
// (`process.env.NODE_ENV`) compile error deta hai.
if (process.env['NODE_ENV'] !== 'production' && typeof window !== 'undefined') {
  if (!geometryChecked) {
    geometryChecked = true;
    const result = validateMinLegibleGeometry();
    if (!result.ok) {
      // Dev me loud warning - geometry drift ko immediately pakadna hai
      console.warn(
        '[BrandCharacter] Rino antenna 16px contract broken:',
        result.failures
      );
    }
  }
}

/**
 * ANTENNA TIP RENDERER - Rino ke 3 alag-alag tip shapes.
 *
 * Ye alag component isliye hai taaki tip shapes EXPLICITLY enumerated rahein.
 * Agar naya tip shape add karna ho to yahan case add karo - manifest me bhi
 * tip string add karna padega, dono jagah mismatch compile-time pakadega
 * (kyunki `tip` ka type literal union hai).
 */
function AntennaTip({
  x,
  y,
  shape,
  r,
  color,
}: {
  x: number;
  y: number;
  shape: 'circle' | 'square' | 'diamond';
  r: number;
  color: string;
}) {
  if (shape === 'circle') {
    // Circle tip - center antenna (primary/broadcast)
    return <circle cx={x} cy={y} r={r} fill={color} />;
  }

  if (shape === 'square') {
    // Square tip - left antenna (data/compute).
    // NOTE: `rx={0.5}` - bilkul sharp square 16px par jagah se jagah judne
    // lagta hai (antialiasing). 0.5 radius basically invisible hai visually
    // par renderer ko stable rakhta hai.
    return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={0.5} fill={color} />;
  }

  // Diamond tip - right antenna (signal/quantum).
  // NOTE: rotated square. 16px par diamond CIRCLE se zyada distinct dikhta
  // hai (corners sharp hote hain) - ye identity ka core hai.
  return (
    <path
      d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`}
      fill={color}
    />
  );
}

/**
 * SHARED SVG FRAME - dono characters ka common wrapper.
 *
 * Isse viewBox/role/aria/size handling ek jagah rehta hai, aur dono
 * characters ka accessibility behaviour guaranteed same hota hai (drift-proof).
 */
function CharacterFrame({
  spec,
  size,
  className,
  label,
  decorative,
  children,
}: {
  spec: { name: string; tagline: string };
  size: number | undefined;
  className: string;
  label: string | undefined;
  decorative: boolean | undefined;
  children: React.ReactNode;
}) {
  return (
    <svg
      // `focusable="false"` - legacy IE/Edge SVG focusable bug fix.
      // Naye browsers me ignore hota hai, harmless hai.
      focusable="false"
      // Width/height: `size` diya ho to px lock, warna auto (100%).
      // NOTE: hum `width`/`height` attributes + `viewBox` dono dete hain.
      // Sirf viewBox dene se SVG container ke width ke hisaab se scale hota
      // hai jo flex layouts me unpredictable ho sakta hai.
      width={size}
      height={size}
      // `preserveAspectRatio` default ("xMidYMid meet") rakhte hain -
      // square viewBox + square render = koi letterboxing nahi.
      viewBox={CANVAS.viewBox}
      // Accessibility: decorative mode me hide, warna labelled image.
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={
        decorative ? undefined : label ?? `${spec.name} - ${spec.tagline}`
      }
      className={className}
    >
      {children}
    </svg>
  );
}

/**
 * WINO - the boy (deep corporate blue + dynamic active apparel).
 *
 * PAINT ORDER (manifest se, strictly):
 *   tile -> garment -> stripeSecondary -> stripePrimary -> collar
 *   -> head -> hair -> eyes -> mouth
 *
 * NOTE: garment/head se PEHLE paint hota hai taaki collar aur stripes
 * head ke neeche correctly clip lagein (z-order: pehle = neeche).
 *
 * SIGNATURE: `stripePrimary` + `stripeSecondary` = "dynamic active apparel".
 * Ye do diagonal parallelograms Wino ko motion/active feel dete hain.
 */
export function WinoCharacter({
  size = CANVAS.recommendedPx,
  className = '',
  label,
  decorative = false,
}: BrandCharacterProps) {
  const p = WINO.palette;
  const a = WINO.apparel;

  return (
    <CharacterFrame
      spec={WINO}
      size={size}
      className={className}
      label={label}
      decorative={decorative}
    >
      {/* ---- Layer 1: background tile ----
          Opacity 0.15 - halka, taaki card ke upar Wino pop kare. */}
      <rect
        width={CANVAS.size}
        height={CANVAS.size}
        rx={CANVAS.tileRadius}
        fill={p.deep}
        opacity={0.15}
      />

      {/* ---- Layer 2: garment (torso) ----
          Path manifest se - pear-shaped torso, shoulders se flare. */}
      <path d={a.garmentPath} fill={p.deep} />

      {/* ---- Layer 3: secondary motion stripe (thinner, rear) ----
          "dynamic active apparel" ka depth layer. `bright` at lower opacity
          taaki primary stripe se visually subordinate rahe. */}
      <path d={a.stripeSecondary} fill={p.bright} opacity={0.45} />

      {/* ---- Layer 4: primary motion stripe (thicker, front) ----
          Wino ka SIGNATURE element. Full opacity `bright` blue. */}
      <path d={a.stripePrimary} fill={p.bright} />

      {/* ---- Layer 5: collar accent ----
          Skin-tone collar - chin se garment ka transition soften karta hai,
          aur face ko torso se visually separate karta hai. */}
      <path d={a.collarPath} fill={p.skin} />

      {/* ---- Layer 6: head ----
          Circle from manifest (cx32 cy28 r15). `mid` blue fill. */}
      <circle cx={CANVAS.headCx} cy={CANVAS.headCy} r={CANVAS.headR} fill={p.mid} />

      {/* ---- Layer 7: hair (swept tuft) ----
          Boy-coded short hair. Manifest path + strokeWidth 4. */}
      <path
        d={WINO.hair.path}
        fill="none"
        stroke={p.ink}
        strokeWidth={WINO.hair.strokeWidth}
        strokeLinecap={WINO.hair.strokeLinecap}
      />

      {/* ---- Layer 8: eyes (shared geometry) ----
          Pure white on dark blue head. Contrast size compensate karta hai. */}
      <circle cx={CANVAS.eyeLeftCx} cy={CANVAS.eyeCy} r={CANVAS.eyeR} fill={CANVAS.ink} />
      <circle cx={CANVAS.eyeRightCx} cy={CANVAS.eyeCy} r={CANVAS.eyeR} fill={CANVAS.ink} />

      {/* ---- Layer 9: mouth (shared smile arc) ----
          Manifest path. White stroke, round caps. */}
      <path
        d={CANVAS.mouthPath}
        fill="none"
        stroke={CANVAS.ink}
        strokeWidth={CANVAS.mouthStrokeWidth}
        strokeLinecap="round"
      />
    </CharacterFrame>
  );
}

/**
 * RINO - the tech mascot (deep violet + 3-antenna array).
 *
 * PAINT ORDER (manifest se, strictly):
 *   tile -> antennae -> head -> visor -> visorGlow -> eyes -> mouth
 *
 * CRITICAL: antennae HEAD se PEHLE paint hote hain, taaki antenna stalks
 * head ke neeche jaan-bujhkar chale jaayein (visible na rahein). Tips head
 * ke upar nikalte rehte hain.
 *
 * SIGNATURE: `antennaArray` loop - 3 antennas with DISTINCT tip shapes
 * (square / circle / diamond). Ye 16px par bhi readable hain (guaranteed by
 * `validateMinLegibleGeometry()`).
 */
export function RinoCharacter({
  size = CANVAS.recommendedPx,
  className = '',
  label,
  decorative = false,
}: BrandCharacterProps) {
  const p = RINO.palette;

  return (
    <CharacterFrame
      spec={RINO}
      size={size}
      className={className}
      label={label}
      decorative={decorative}
    >
      {/* ---- Layer 1: background tile ----
          Violet deep fill, low opacity - Rino ke violet head pop kare. */}
      <rect
        width={CANVAS.size}
        height={CANVAS.size}
        rx={CANVAS.tileRadius}
        fill={p.deep}
        opacity={0.15}
      />

      {/* ---- Layer 2: ANTENNA ARRAY (head se pehle) ----
          Loop over manifest array. Har antenna:
            - stalk: vertical line from head-top up by `length` units
            - tip:   shape-specific (AntennaTip component)

          `strokeLinecap="round"` - stalks ke tips soft, jo 16px par
          zyada clean dikhte hain (sharp cap 1px par jagah se jagah judta). */}
      {RINO.antennaArray.map((ant) => {
        // Tip Y = base Y - length (upar ki taraf)
        const tipY = RINO.antennaBaseY - ant.length;
        return (
          <g key={ant.id}>
            {/* Stalk - head top se tip tak */}
            <line
              x1={ant.x}
              y1={RINO.antennaBaseY}
              x2={ant.x}
              y2={tipY}
              stroke={p.bright}
              strokeWidth={ant.strokeWidth}
              strokeLinecap="round"
            />
            {/* Tip - shape manifest se (square / circle / diamond) */}
            <AntennaTip
              x={ant.x}
              y={tipY}
              shape={ant.tip}
              r={ant.tipR}
              color={p.bright}
            />
          </g>
        );
      })}

      {/* ---- Layer 3: head ----
          Violet `mid` fill. Antennae ke neeche se head cover karta hai. */}
      <circle cx={CANVAS.headCx} cy={CANVAS.headCy} r={CANVAS.headR} fill={p.mid} />

      {/* ---- Layer 4: visor (dark band) ----
          Robot identity - eyes ka area ek wide dark band se cover hota hai.
          Rino ke liye ye "tech face" signal hai (Wino ke paas ye nahi). */}
      <path d={RINO.visor.path} fill={RINO.visor.fill} />

      {/* ---- Layer 5: visor glow (violet edge) ----
          Upper edge par bright violet stroke - "powered on" feel. */}
      <path
        d={RINO.visor.path}
        fill="none"
        stroke={RINO.visor.stroke}
        strokeWidth={RINO.visor.strokeWidth}
      />

      {/* ---- Layer 6: eyes (shared geometry) ----
          NOTE: eyes visor ke andar hain. Visor dark hai, eyes white -
          to contrast banta hai. Same shared eye geometry as Wino (par
          visually distinct kyunki background violet-dark hai, blue nahi). */}
      <circle cx={CANVAS.eyeLeftCx} cy={CANVAS.eyeCy} r={CANVAS.eyeR} fill={CANVAS.ink} />
      <circle cx={CANVAS.eyeRightCx} cy={CANVAS.eyeCy} r={CANVAS.eyeR} fill={CANVAS.ink} />

      {/* ---- Layer 7: mouth (shared smile) ----
          Same friendly arc. Consistency across characters - brand rule. */}
      <path
        d={CANVAS.mouthPath}
        fill="none"
        stroke={CANVAS.ink}
        strokeWidth={CANVAS.mouthStrokeWidth}
        strokeLinecap="round"
      />
    </CharacterFrame>
  );
}

/**
 * GENERIC CHARACTER RENDERER - dynamic name se render karta hai.
 *
 * Use when: character id DATA se aata hai (e.g. ad pool me se
 * `characterId: 'Rino'`). Tab `RinoCharacter` directly import karne ke bajaye
 * ye use karo.
 *
 * NOTE: ye component `CHARACTER_REGISTRY` ko runtime pe switch karta hai.
 * `CHARACTER_MANIFEST` ke `paintOrder` ko follow karta hai - but internally
 * Wino/Rino ke apne dedicated components call hote hain (jo already
 * manifest-paint-order follow karte hain). Ye sirf routing layer hai.
 */
export function BrandCharacter({
  id,
  ...props
}: BrandCharacterProps & { id: CharacterId }) {
  if (id === 'Wino') {
    return <WinoCharacter {...props} />;
  }
  return <RinoCharacter {...props} />;
}

/**
 * DUAL BRAND LOCKUP - Wino + Rino saath me, brand signature ke liye.
 *
 * Use: footer, "made by" section, ya jab dono characters ki presence
 * chahiye. Overlap karke rakhta hai (negative margin) taaki compact lagein -
 * ye intentional design choice hai.
 */
export function BrandLockup({
  size = 40,
  className = '',
  gap = '-space-x-2',
}: {
  size?: number;
  className?: string;
  gap?: string;
}) {
  return (
    <div className={`flex items-center ${gap} ${className}`}>
      <WinoCharacter size={size} decorative className="rounded-full" />
      <RinoCharacter size={size} decorative className="rounded-full" />
    </div>
  );
}
