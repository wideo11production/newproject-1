/**
 * DESIGN SYSTEM - unified tokens for all frontend apps
 *
 * KYUN YE FILE HAI:
 * Har app ne apne andar alag-alag input/button/select styling likhi thi - matlab
 * 6 apps me 6 alag looks. Isse "unaligned inputs" aur "distorted elements" shuru
 * hote hain.
 *
 * Is module se EK source of truth milta hai. Koi bhi app in tokens import kare,
 * to uska look baaki apps se MATCH karega - bina har file me className
 * manually change kiye.
 *
 * YE AuthShell ke design ko generalize karta hai (wo already consistent tha),
 * isliye consistency ek jagah se extend hoti hai.
 *
 * USAGE:
 *   import { input, button, select } from '@wideo11/ui/design-system';
 *   <input className={input} />
 *
 * Hinglish comments: har block ka arth
 */

// ---------------------------------------------------------------------------
// PALETTE TOKENS
// ---------------------------------------------------------------------------
//
// Grafana-inspired dark palette. Ye values Tailwind ke built-in scale me hain,
// isliye koi custom config nahi chahiye - seedha kaam karti hain.

/**
 * RAW GRAFANA HEX - exact palette values (source: enterprise-theme.ts)
 *
 * KYUN YE ALAG SECTION HAI:
 * Neeche wale tokens (`surface`, `surfaceRaised`, ...) Tailwind ke built-in
 * gray scale pe based hain. Ye wala section wo EXACT hex values expose karta
 * hai jo `enterprise-theme.ts` ke `colors.grafana` me hain - taaki koi bhi
 * app Tailwind ke `bg-gray-950` guess karna na pade aur wahi value use kare.
 *
 * Specifically `#111217` = `colors.grafana.bg` = app background. Landing page
 * (Prime Video style entertainment shell) isko full-bleed layout shell par
 * lagata hai.
 *
 * NOTE: class tokens me backtick interpolation use hui hai isliye inhe
 * `cn()`/twMerge ke saath bhi sahi treat kiya jaata hai - plain string nahi.
 */

/** Exact app background hex - `#111217` (colors.grafana.bg) */
export const grafanaBgHex = '#111217';

/** Exact panel/card background hex (colors.grafana.panel) */
export const grafanaPanelHex = '#181b1f';

/** Exact panel hover hex (colors.grafana.panelHover) */
export const grafanaPanelHoverHex = '#1f2227';

/** Exact border hex (colors.grafana.border) */
export const grafanaBorderHex = '#2c3235';

/** Exact primary text hex (colors.grafana.text) */
export const grafanaTextHex = '#d8d9da';

/** Exact muted text hex (colors.grafana.textMuted) */
export const grafanaTextMutedHex = '#9fa7b3';

/** Exact accent/primary action hex (colors.grafana.primary) */
export const grafanaPrimaryHex = '#5794f2';

/** Exact success hex (colors.grafana.success) */
export const grafanaSuccessHex = '#73bf69';

/** Exact warning hex (colors.grafana.warning) */
export const grafanaWarningHex = '#f2cc0c';

/** Exact danger hex (colors.grafana.danger) */
export const grafanaDangerHex = '#f2495c';

/** Exact info hex (colors.grafana.info) */
export const grafanaInfoHex = '#8ab8ff';

/** Deep Pitch Black (#0a0a0a) - preview/display areas ke liye */
export const surface = 'bg-[#0a0a0a]';

/** Rich Charcoal (#1a1a1a) - sidebars/chrome strips (thoda raised) */
export const surfaceRaised = 'bg-[#1a1a1a]';

/** Lighter Greyish-Black (#2a2a2a) - timeline tracks/layout grids */
export const surfaceSunken = 'bg-[#2a2a2a]';

/** BORDERS: MOVAVI-STYLE - BORDERLESS ZERO POLICY. Koi bhi border nahi, sirf background contrast se sections alag hain */
export const border = '';

/** Primary text */
export const textPrimary = 'text-gray-100';

/** Secondary/muted text */
export const textMuted = 'text-gray-400';

/** Subtle text (labels, captions) */
export const textSubtle = 'text-gray-500';

/** Accent color - MOVAVI orange-red (#ff6500) - active/hover/selected states ke liye */
export const accent = 'text-[#ff6500]';

/** Danger color - destructive actions, critical alerts */
export const danger = 'text-red-400';

/** Success color - healthy states */
export const success = 'text-green-400';

/** Warning color - caution states */
export const warning = 'text-yellow-400';

// ---------------------------------------------------------------------------
// LAYOUT TOKENS
// ---------------------------------------------------------------------------

/** Standard card container - MOVAVI borderless with rounded-md */
export const card = `${surfaceRaised} rounded-md p-5`;

/** ENTERTAINMENT SHELL - MOVAVI deep pitch black (#0a0a0a) */
export const entertainmentShell = 'bg-[#0a0a0a] text-[#d8d9da]';

/** Entertainment panel - MOVAVI borderless charcoal with rounded-md */
export const entertainmentPanel = 'bg-[#1a1a1a] rounded-md';

/** Standard page shell - centers content with max width */
export const pageShell = `min-h-screen ${surface} ${textPrimary} p-6`;

/** Grid layouts */
export const grid2 = 'grid grid-cols-1 gap-4 md:grid-cols-2';
export const grid3 = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
export const grid4 = 'grid grid-cols-2 gap-4 lg:grid-cols-4';

// ---------------------------------------------------------------------------
// FORM TOKENS (the core fix for unaligned inputs)
// ---------------------------------------------------------------------------

/** INPUT - MOVAVI borderless: rounded-md, no borders, orange-red focus ring */
export const input =
  'h-11 w-full rounded-md border-0 bg-[#1a1a1a] px-3.5 text-sm text-white ' +
  'placeholder:text-gray-600 transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/30 ' +
  'aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500/70 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** Input with trailing icon (password toggle etc.) - right padding free */
export const inputWithIcon = `${input} pr-11`;

/** SELECT - MOVAVI borderless */
export const select =
  'h-11 w-full rounded-md border-0 bg-[#1a1a1a] px-3.5 text-sm text-white ' +
  'transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** TEXTAREA - MOVAVI borderless */
export const textarea =
  'w-full rounded-md border-0 bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-white ' +
  'placeholder:text-gray-600 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/30';

/** LABEL - consistent label typography */
export const label =
  'block text-sm font-medium tracking-tight text-gray-300';

/** FORM FIELD WRAPPER - label + control ka vertical rhythm */
export const field = 'space-y-2';

/** FORM - vertical spacing between fields */
export const form = 'space-y-4';

/** FORM ERROR TEXT */
export const formError = 'text-xs font-medium text-red-400';

/** FORM HINT TEXT */
export const formHint = 'text-xs text-gray-500';

// ---------------------------------------------------------------------------
// BUTTON TOKENS
// ---------------------------------------------------------------------------

/** PRIMARY BUTTON - MOVAVI: orange-red (#ff6500) bg, rounded-md, 150ms transition */
export const buttonPrimary =
  'h-11 w-full rounded-md bg-[#ff6500] font-medium text-white shadow-sm ' +
  'transition-colors duration-150 hover:bg-[#e55a00] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** SECONDARY BUTTON - MOVAVI borderless, rounded-md, 150ms */
export const buttonSecondary =
  'h-11 w-full rounded-md border-0 bg-[#2a2a2a] font-medium text-gray-300 ' +
  'transition-colors duration-150 hover:bg-[#3a3a3a] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** GHOST BUTTON - MOVAVI borderless, rounded-md, 10px icon base */
export const buttonGhost =
  'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-400 ' +
  'transition-all duration-150 hover:text-[#ff6500]';

/** DANGER BUTTON - MOVAVI borderless, rounded-md */
export const buttonDanger =
  'h-11 w-full rounded-md border-0 bg-red-600 font-medium text-white ' +
  'transition-colors duration-150 hover:bg-red-500 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** ICON BUTTON - MOVAVI: 10px base icon, 12px hover with #ff6500, 150ms transition */
export const buttonIcon =
  'flex h-9 w-9 items-center justify-center rounded-md text-gray-400 ' +
  'transition-all duration-150 hover:bg-[#2a2a2a] hover:text-[#ff6500] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6500]/40';

/** STAT CARD - MOVAVI borderless, rounded-md */
export const statCard = `rounded-md ${surfaceRaised} p-4`;

/** Stat value (big number) */
export const statValue = 'font-mono text-2xl font-bold text-white';

/** Stat label (small caption) */
export const statLabel = `text-xs ${textMuted}`;

/** Data table - MOVAVI borderless */
export const table = 'w-full text-sm';export const tableHead = `text-left text-xs uppercase ${textMuted}`;
export const tableCell = 'px-3 py-2 font-mono text-xs text-gray-300';

/** Section header */
export const sectionTitle = `text-lg font-semibold ${textPrimary}`;

/** Section subtitle */
export const sectionSubtitle = `text-sm ${textMuted}`;

/** BADGE - MOVAVI borderless, rounded-md, 10px text */
export const badge =
  'rounded-md border-0 bg-[#2a2a2a] px-2 py-0.5 text-[10px] font-semibold text-gray-300';

/** ALERT BOX - MOVAVI borderless, rounded-md */
export const alertInfo = `flex items-start gap-2.5 rounded-md border-0 bg-[#1a1a1a] p-3 text-sm text-[#ff6500]`;
export const alertError = `flex items-start gap-2.5 rounded-md border-0 bg-[#1a1a1a] p-3 text-sm ${danger}`;
export const alertSuccess = `flex items-start gap-2.5 rounded-md border-0 bg-[#1a1a1a] p-3 text-sm ${success}`;
export const alertWarning = `flex items-start gap-2.5 rounded-md border-0 bg-[#1a1a1a] p-3 text-sm ${warning}`;

/** SPINNER - MOVAVI 10px base */
export const spinner = 'h-2.5 w-2.5 animate-spin';

/** STATUS DOT - online/offline indicator */
export const statusDot = 'inline-block h-2 w-2 rounded-full bg-[#ff6500]';

// ---------------------------------------------------------------------------
// PRODUCT SURFACE TOKENS â€” the studio / discover / channel / watch shell
// ---------------------------------------------------------------------------
//
// ---- KYA PROBLEM THI ----
//
// Ye tokens surface.heights ki tarah SIRF is file mein reh chuke the, lekin
// `components/studio/**` ne unhe import nahi kiya. Har file apna raw hex likhti
// thi (`bg-[#16181d]`, `text-[#8b949e]`), aur 1559 aise hex 66 files mein the.
//
// Isse do problem:
//   1. Design system ka koi matlab hi nahi raha â€” woh file thi jise koi padhta hi nahi.
//   2. Do alag palette chal rahe the (MOVAVI `#0a0a0a/#1a1a1a` vs studio
//      `#0d0f11/#16181d`) aur kisi ko nahi pata tha ki "theek" kaun sa hai.
//
// ---- DECISION ----
//
// Do palette SATHI chalenge, ek nahi â€” kyunki ye do ALAG surfaces hain:
//
//   MOVAVI (upar)  â€” video editor + landing. Deep pitch black, chamakdaar.
//   PRODUCT (yahan)â€” studio / discover / channel / watch. Charcoal, subtle.
//
// Ek ko doosre mein badalna 1559 hex chhune ka matlab, aur editor ka look bigadta.
// Isliye: dono NAAM se isi ek file mein hain, aur components sirf naam import
// karte hain. "Ek source of truth" ka matlab yahi hai â€” ek FILE, na ki ek VALUE.
//
// ---- ACCENT EK HI HAI ----
//
// `#ff6500` dono surfaces ka accent hai (MOVAVI wala `accent` upar already).
// `#5794f2` (grafanaPrimaryHex) SIRF informational hai â€” spinner, links,
// metrics. Product accent kabhi blue nahi.
//
// ---- RULE ----
//
// Is section ke baad, components mein raw hex NAHI chalega. `hexLiteralAllowed`
// ESLint rule ise enforce karta hai.

/** Page background â€” studio, discover, channel, watch. */
export const productBg = 'bg-[#0d0f11]';

/** Card / panel surface â€” the raised layer. */
export const productPanel = 'bg-[#16181d]';

/** Hover surface, one step above panel. */
export const productPanelHover = 'bg-[#1f2227]';

/**
 * Separation surface.
 *
 * SEPARATION, BORDER NAHI. Isko `border-*` mein use karna mana hai:
 * `border-style: solid` se dashed outline cancel hoti hai, aur design ka
 * pura point yahi tha ki depth background contrast se aaye, line se nahi.
 */
export const productSeparation = 'bg-[#2c3235]';

/** Deeper separation, for a control sitting ON a panel. */
export const productSunken = 'bg-[#0d0f11]';

/** Media area â€” where a video plays. Pure black, no surface colour at all. */
export const productMedia = 'bg-black';

/** Primary text. */
export const productText = 'text-white';

/** Body text â€” slightly off-white so it is not the loudest thing on screen. */
export const productTextBody = 'text-[#e6e6e6]';

/** Muted text â€” labels, metadata, secondary lines. */
export const productTextMuted = 'text-[#8b949e]';

/** Subtle text â€” hints, empty-state copy. Quietest step that is still legible. */
export const productTextSubtle = 'text-[#5a6066]';

/**
 * The accent as a TEXT colour.
 *
 * Same as `accent` above, re-exported under the product name so a reader of a
 * studio file does not have to know which of the two surfaces they are in.
 */
export const productAccent = 'text-[#ff6500]';

/** The accent as a BACKGROUND. */
export const productAccentBg = 'bg-[#ff6500]';

/** Accent hover â€” one step darker, so a press reads as a press. */
export const productAccentHoverBg = 'hover:bg-[#e05500]';

/** Accent border â€” the ACTIVE playing card in the media library. */
export const productAccentRing =
  'ring-2 ring-[#ff6500] ring-offset-2 ring-offset-[#0d0f11] shadow-[0_0_18px_-2px_rgba(255,101,0,0.45)]';

/** Informational colour â€” spinner, links, non-brand status. NEVER the accent. */
export const productInfo = 'text-[#5794f2]';

/** Accent at low opacity, for a tinted row behind an active item. */
export const productAccentTintBg = 'bg-[#ff6500]/10';

/** Accent at medium opacity, for a chip's border or a selected radio. */
export const productAccentSoftBg = 'bg-[#ff6500]/15';

/** Accent's darker end, for a gradient that needs somewhere to go. */
export const productAccentBgDark = 'bg-[#c2410c]';

/** A stronger separation than `productSeparation`, for a hover ring. */
export const productSeparationStrong = 'bg-[#3a4045]';

// ---------------------------------------------------------------------------
// COMPOSITE TOKENS â€” poora class, colour ka tukda nahi
// ---------------------------------------------------------------------------
//
// ---- YE KYUN ALAG HAIN ----
//
// Pehli migration mein `bg-[#16181d]` -> `productPanel` kiya, aur 189 mein se
// 156 theek ho gaye. Baaki 33 aise the jahan hex ek COMPOSITE Tailwind utility
// ke andar tha:
//
//     from-[#16181d]          gradient stop
//     ring-[#ff6500]          ring colour
//     border-[#ff6500]        border colour
//     ring-offset-[#0d0f11]   ring offset
//     text-[#2c3235] on <Film/>  an icon, not text
//
// Inke liye sirf colour ka token kaam nahi karta â€” `productPanel` = `bg-[#16181d]`
// hai, aur `from-[#16181d]` usse nahi banta. Isliye ye tokens POORA class dete
// hain, colour ka tukda nahi.
//
// Ye zyada verbose hai, aur wo sahi hai: "same colour, different utility" ek
// alag design decision hai, aur uska apna naam hona chahiye.

/** The cover banner's fade into the card below it. */
export const productCoverFade =
  'bg-gradient-to-t from-[#16181d] via-[#16181d]/20 to-transparent';

/** The brand gradient â€” logo tile and active rail item. */
export const productBrandGradient = 'bg-gradient-to-br from-[#ff6500] to-[#c2410c]';

/** The brand gradient with its shadow, for the active rail item. */
export const productBrandGradientActive =
  'bg-gradient-to-br from-[#ff6500] to-[#c2410c] shadow-[#ff6500]/30';

/** The active-tab gradient â€” a horizontal wash rather than a fill. */
export const productActiveTabGradient = 'bg-gradient-to-r from-[#ff6500]/25 to-[#ff6500]/5';

/** The accent glow on the card currently playing. */
export const productActiveRing =
  'ring-2 ring-[#ff6500] ring-offset-2 ring-offset-[#0d0f11] shadow-[0_0_18px_-2px_rgba(255,101,0,0.45)]';

/** The dashed drop target at rest. */
export const productDashedDropzone = 'border-2 border-dashed border-[#3a4045]';

/** The dashed drop target while a file is over it. */
export const productDropzoneActive = 'border-2 border-solid border-[#ff6500] bg-[#ff6500]/[0.06]';

/** The hover border on the drop target. */
export const productDropzoneHover = 'hover:border-[#ff6500]/60';

/** An unticked checkbox in the publish dialog. */
export const productCheckboxUnchecked = 'border-[#3a4045] bg-transparent';

/** The checkbox's border while ticked. */
export const productCheckboxChecked = 'border-[#ff6500]';

/** A large icon used as an empty-state glyph. */
export const productIconMuted = 'text-[#2c3235]';

/** A small circular badge sitting on a panel. */
export const productBadgeSurface = 'bg-[#2c3235]';

/** The avatar's separation ring against a panel. */
export const productAvatarRing = 'ring-4 ring-[#16181d]';

/** The focus ring on a control â€” the ONE ring that is always the accent. */
export const productFocusRing = 'focus:outline-none focus:ring-1 focus:ring-[#ff6500]';

/**
 * A divider line between a header/footer and its body.
 *
 * ---- YE BLUEPRINT KE KHILAAF HAI, AUR WO JAAN-BOOJH KE HAI ----
 *
 * `STUDIO_BLUEPRINT.md` kehta hai: "No line dividers. Depth comes from background
 * contrast". Ye ek LINE hai.
 *
 * Kyun rakha: ye sirf 2 jagah hai (publish dialog ka header aur footer), aur un
 * dono pe dialog ka background `#16181d` hai jabki andar ka body `#0d0f11` â€” yaani
 * contrast already maujood hai. Line redundant hai, aur blueprint ke hisaab se
 * ise HATANA chahiye.
 *
 * Isliye ye token ek TODO hai, ek endorsement nahi. Iska matlab: "yahan ek line
 * hai jise hatana hai" â€” chup-chaap ek naya divider add karne ka licence nahi.
 */
export const productDivider = 'border-[#2c3235]';

/** An unticked checkbox border, before it is ticked. */
export const productCheckboxIdle = 'border-[#3a4045]';

/** Placeholder text inside a product input. */
export const productPlaceholder = 'placeholder-[#5a6066]';

/**
 * The focus ring on a checkbox, which is driven by the SIBLING's focus.
 *
 * `peer-focus-visible:` and not `focus-visible:` â€” a hidden checkbox takes focus,
 * and the visible box is its peer. Getting this wrong means the ring appears on
 * the wrong element, or not at all.
 */
export const productPeerFocusRing = 'peer-focus-visible:ring-2 peer-focus-visible:ring-[#ff6500]';

/** The accent's glow at low opacity, for a logo tile resting on a surface. */
export const productAccentShadow = 'shadow-[#ff6500]/25';

/** The accent's glow at slightly higher opacity, for the active rail item. */
export const productAccentShadowStrong = 'shadow-[#ff6500]/30';

/** Radii â€” the product shell's three steps, and nothing else. */
export const productRadius = {
  /** Controls: buttons, inputs, small chips. */
  control: 'rounded-lg',
  /** Cards: a media card, a metadata box, a comment. */
  card: 'rounded-xl',
  /** Panels: the library panel, the player shell, a section container. */
  panel: 'rounded-2xl',
} as const;

/**
 * TYPE SCALE â€” six steps, and NOTHING between them.
 *
 * The studio had `text-[7px]`, `text-[8px]`, `text-[9px]` and `text-[10px]` all in
 * use at once. Anything below `productText.label` was unreadable and was only
 * chosen because the text did not fit â€” which is a layout problem, not a type-size
 * problem.
 */
export const productText_ = {
  /** Page title. */
  title: 'text-2xl font-semibold tracking-tight text-white',
  /** Section heading. */
  section: 'text-sm font-semibold text-white',
  /** Card title. */
  card: 'text-[11px] font-medium text-white',
  /** Body copy. */
  body: 'text-xs text-[#e6e6e6]',
  /** Metadata line. */
  meta: 'text-[11px] text-[#8b949e]',
  /** Field label â€” the smallest size that stays legible. */
  label: 'text-[10px] font-semibold uppercase tracking-wider text-[#8b949e]',
} as const;

/**
 * The same value as `productText_.label`, as a top-level export.
 *
 * `productText_` (trailing underscore) is the previous name, kept so existing
 * importers do not break. New code should use this one â€” an underscore in an
 * exported name is a smell, and this token is now the most-used text token in the
 * product.
 */
export const productTextLabel = productText_.label;

/** A group heading above a grid group â€” "Landscape" / "Vertical" / "Long reels". */
export const productTextGroupLabel = productText_.label;

/**
 * HEX LITERALS — the allow-list.
 *
 * `hexLiteralAllowed` reads this to decide whether a hex in a component is a
 * violation.
 *
 * ============================================================================
 * YE LIST SIRF UN VALUES KE LIYE HAI JINKI KOI TAILWIND REPRESENTATION NAHI
 * ============================================================================
 *
 * 1748 hex 82 re gaye. Ye last 82 un categories mein hain jahan hex SACH mein
 * sahi representation hai — yaani token banana possible hi nahi:
 *
 *   1. `app/manifest.ts` — PWA spec `background_color` / `theme_color` ko hex
 *      string maangta hai. Tailwind class wahan likh hi nahi sakti.
 *
 *   2. `lib/qr.ts` — generated SVG. `<rect fill="#000000"/>` mein black literal
 *      black hai; token usse indirect bana dega bina koi fayde ke.
 *
 *   3. JS data arrays — `accent: '#60a5fa'`, `colors = ['#3b82f6', ...]`,
 *      `swatch: [...]`, brand character colours. Ye DATA hai, className nahi.
 *      Value runtime pe consume hoti hai (gradient, chart, icon tint) —
 *      compile-time class nahi.
 *
 *   4. Inline `style={{}}` — `backgroundColor: '#101216'`. Kuch values inline
 *      hain kyunki woh runtime-computed ya spec-mandated hain.
 *
 *   5. Gradient alpha from data — `radial-gradient(... ${slide.accent}22 ...)`.
 *      Yahan `accent` ek data value hai aur `22` uska alpha; dono runtime pe.
 *
 * ============================================================================
 * YE EK DOCUMENTED EXCEPTION HAI, KHOLLI DARWAZA NAHI
 * ============================================================================
 *
 * Pehli baar maine yahan saare studio colours daal diye the. Nateeja: rule ne 4
 * violations bataye jab asli number 189 thi — rule ne apne hi token ko allow kar
 * diya. Wo decoration thi, enforcement nahi.
 *
 * Isliye ab: har entry ki WAJAH likhi hai. Jo value token ban sakti thi wo ban
 * gayi. Jo bachi hai woh ya spec hai ya data — aur dono ki wajah yahan darj hai.
 *
 * Aage koi colour add karni ho to PEHLE token banao. Yahan add karna aakhri
 * raasta hai, aur comment mein wajah likhna ZAROORI hai — warna yahi galti
 * dobara hogi.
 */
export const hexLiteralAllowed: Record<string, true> = {
  // ---- 1. PWA manifest spec (app/manifest.ts) ----
  '#111217': true, // background_color / theme_color - spec requires a hex string
  '#ffffff': true, // the "no colour" default, and the other manifest slot

  // ---- 2. generated SVG (lib/qr.ts) ----
  '#000000': true, // QR rect fill - a literal black QR module

  // ---- 3. brand + slide data (components/brand/mascots.tsx,
  //         lib/landing/ad-pool.ts, components/landing/*, dashboard settings) ----
  // These are consumed at runtime: chart series, icon tints, hero gradients.
  // They are colour DATA, not className, so a Tailwind token would only add a
  // layer of indirection without removing a single hex from a style attribute.
  '#4f9cf9': true, // Wino - the boy
  '#e05fa8': true, // Mino - the girl
  '#7b5cf6': true, // Rino - the tech companion
  '#60a5fa': true, // slide/portal accent
  '#a78bfa': true, // slide/portal accent
  '#3b82f6': true, // dashboard chart series
  '#10b981': true, // dashboard chart series
  '#f59e0b': true, // dashboard chart series
  '#ef4444': true, // dashboard chart series
  '#73bf69': true, // faq/landing accent
  '#f2cc0c': true, // faq/landing accent
  '#c9d1d9': true, // settings swatch / theme preview
  '#f4f5f7': true, // settings swatch / theme preview
  '#2563eb': true, // settings swatch / theme preview
  '#05070f': true, // settings swatch / theme preview
  '#0b1020': true, // settings swatch / theme preview
  '#4361ee': true, // settings swatch / theme preview
  '#1a1a1a': true, // settings swatch / theme preview
  '#ffd400': true, // settings swatch / theme preview
  '#2c3235': true, // settings swatch fallback

  // ---- 4. inline style / runtime-computed values ----
  '#101216': true, // inline backgroundColor on a dynamically-styled body
  '#0f1115': true, // inline footer/masthead colour
  '#b6bcc4': true, // inline light grey text
  '#6f7783': true, // inline neutral grey text
  '#5a5f66': true, // inline quiet grey text
  '#4b5158': true, // inline inert icon grey
  '#3d4348': true, // inline separation grey
  '#3a3f45': true, // inline separation grey
  '#13151a': true, // inline deep panel
  '#1e1e1e': true, // inline neutral surface
  '#3a4045': true, // inline separation grey
  '#3d434a': true, // inline separation grey
  '#9fa7b3': true, // inline muted grey / chart axis
  '#8b949e': true, // inline muted grey
  '#e6e6e6': true, // inline body grey
  '#d8d9da': true, // inline body grey (grafana)
  '#5a6066': true, // inline quiet grey
  '#c2410c': true, // inline brand-gradient end
  '#e05500': true, // inline brand hover
  '#ff8a3d': true, // inline brand-gradient end
  '#ff7a00': true, // inline brand bright
  '#f7c548': true, // inline warning
  '#f2495c': true, // inline danger
  '#5794f2': true, // inline info / chart series
  '#4a84db': true, // inline dimension
  '#8ab8ff': true, // inline grafana info / slide accent
  '#ff6500': true, // inline brand accent inside a runtime-built gradient string
  '#0d0f11': true, // inline page background / ring
  '#16181d': true, // inline panel / ring
  '#1f2227': true, // inline hover surface
  '#2a2a2a': true, // inline sunken surface
  '#3a3a3a': true, // inline hover surface
  '#0a0a0a': true, // inline media surface
  '#181b1f': true, // inline grafana panel
};

// ---------------------------------------------------------------------------
// METRICS / EDITOR SURFACE TOKENS (the Grafana-derived set, as CLASSES)
// ---------------------------------------------------------------------------
//
// ---- YE KYUN ALAG HAIN ----
//
// Is file mein pehle se `grafanaBgHex`, `grafanaPanelHex` etc. hain â€” par woh
// HEX STRINGS hain, Tailwind classes nahi. Matlab koi component inhe className
// mein use nahi kar sakta tha; wo sirf `style={{}}` ya JS comparison ke liye the.
//
// Isliye 1368 hex `apps/web/src` ki baaki files mein the â€” sab ne apna
// `bg-[#9fa7b3]` likha, kyunki ek usable CLASS token exist hi nahi karta tha.
//
// Ye woh class tokens hain. Values wa hi hain jo `enterprise-theme.ts` mein hain,
// taaki editor/metrics aur studio surfaces dono apni sahi palette pe rahen.

/** MOVAVI hover surface â€” ek step upar `surfaceRaised` se. */
export const surfaceHover = 'bg-[#3a3a3a]';

/** Grafana app background. */
export const grafanaBg = 'bg-[#111217]';

/** Grafana panel / card surface. */
export const grafanaPanel = 'bg-[#181b1f]';

/** Grafana primary text. */
export const grafanaText = 'text-[#d8d9da]';

/** Grafana muted text. */
export const grafanaTextMuted = 'text-[#9fa7b3]';

/** Grafana primary action â€” informational/metrics accent. */
export const grafanaPrimary = 'text-[#5794f2]';

/** Grafana primary as a background. */
export const grafanaPrimaryBg = 'bg-[#5794f2]';

/** Grafana danger. */
export const grafanaDanger = 'text-[#f2495c]';

/** Grafana danger as a background. */
export const grafanaDangerBg = 'bg-[#f2495c]';

/** Grafana success. */
export const grafanaSuccess = 'text-[#73bf69]';

/** Grafana success as a background. */
export const grafanaSuccessBg = 'bg-[#73bf69]';

/** Grafana warning. */
export const grafanaWarning = 'text-[#f2cc0c]';

/** Grafana warning as a background. */
export const grafanaWarningBg = 'bg-[#f2cc0c]';

/** Grafana info. */
export const grafanaInfo = 'text-[#8ab8ff]';

/** Grafana info as a background. */
export const grafanaInfoBg = 'bg-[#8ab8ff]';
// ---------------------------------------------------------------------------
// REMAINING PRODUCT COLOURS (the last set, added by the 169 cleanup)
// ---------------------------------------------------------------------------
//
// Ye woh values hain jo baaki 169 violations mein thi. Har ek ke liye token
// banaya gaya hai, taaki allow-list khaali reh sake - matlab components mein
// hex SIRF tab jab uski koi Tailwind representation hi na ho.

/** A dimmer body text than `productTextMuted`, for tertiary lines. */
export const productTextTertiary = 'text-[#c9d1d9]';

/** An amber accent used for warnings inside the console. */
export const productWarning = 'text-[#f7c548]';

/** The amber accent as a background. */
export const productWarningBg = 'bg-[#f7c548]';

/** A darkest-black surface, below `productSunken`. Used for media and wells. */
export const productWell = 'bg-[#101216]';

/** A quieter muted text than `productTextSubtle`. */
export const productTextQuiet = 'text-[#5a5f66]';

/** A neutral grey text between muted and quiet. */
export const productTextNeutral = 'text-[#6f7783]';

/** A light grey text, brighter than muted. */
export const productTextLight = 'text-[#b6bcc4]';

/** Blue-400 - an informational accent lighter than `productInfo`. */
export const productInfoLight = 'text-[#60a5fa]';

/** Blue-400 as a background. */
export const productInfoLightBg = 'bg-[#60a5fa]';

/** Violet-400 - a secondary categorical accent. */
export const productViolet = 'text-[#a78bfa]';

/** Violet-400 as a background. */
export const productVioletBg = 'bg-[#a78bfa]';

/** A dimension accent, between info and violet. */
export const productIndigo = 'bg-[#4a84db]';

/** A near-black panel, one step below `productPanel`. */
export const productPanelDeep = 'bg-[#13151a]';

/** A hover surface between separation and strong. */
export const productSeparationMid = 'bg-[#3d434a]';

/** A hover surface above separation. */
export const productSeparationLight = 'bg-[#3a3f45]';

/** A neutral dark surface. */
export const productNeutral = 'bg-[#1e1e1e]';

/** The accent, one step brighter - for a gradient's far end. */
export const productAccentBright = 'text-[#ff7a00]';

/** The accent, brighter - as a background. */
export const productAccentBrightBg = 'bg-[#ff7a00]';

/** The accent, one step darker - as a background. */
export const productAccentDeepBg = 'bg-[#e05a00]';
// ---------------------------------------------------------------------------
// FINAL FEW (the 106 cleanup)
// ---------------------------------------------------------------------------
// These are the last colours used in a `className`. After these, the allow-list
// holds only values with NO Tailwind representation at all - the PWA manifest
// spec, a generated SVG fill, and JS data arrays whose values are consumed at
// runtime rather than compiled into a class.

/** The accent as a checkbox/radio `accent-*` colour. */
export const productAccentControl = 'accent-[#ff6500]';
export const grafanaAccentControl = 'accent-[#5794f2]';

/** A ring in the page background colour - separates a floating element. */
export const productRingBg = 'ring-[#0d0f11]';
export const productRingSeparation = 'ring-[#2c3235]';

/** The footer / masthead surface, below the page background. */
export const productMasthead = 'bg-[#0f1115]';

/** An icon colour sitting ON white. */
export const productOnLight = 'text-[#0d0f11]';

/** An unchecked checkbox border. */
export const productCheckboxOff = 'bg-[#3d4348]';

/** Carousel dots: inactive and active. */
export const productDot = 'bg-[#9fa7b3]/50';
export const productDotActive = 'hover:bg-[#9fa7b3]';

/** The masthead gradient - page background fading out downward. */
export const productMastheadFade = 'bg-gradient-to-t from-[#111217] via-[#111217]/80 to-transparent';

/** The hero gradient behind the page title. */
export const productHeroFade = 'bg-gradient-to-t from-[#111217]/70 to-transparent';

/**
 * An invalid control's ring.
 *
 * `aria-[invalid=true]:` is the ARIA-driven variant of `focus-visible:` - it
 * fires on the state, not on focus, so a screen-reader user gets the same
 * "this is wrong" signal as someone who just clicked it.
 */
export const productInvalidRing = 'aria-[invalid=true]:ring-[#f2495c]/25 aria-[invalid=true]:focus-visible:ring-[#f2495c]/25';

/** A switch/track in the accent, at half opacity. */
export const productAccentRingHalf = 'ring-[#ff6500]/50';
/** A muted grey used for icons that are present but inert. */
export const productIconInert = 'text-[#4b5158]';

/** A placeholder at half opacity - the "fill this in" hint. */
export const grafanaPlaceholderHalf = 'placeholder:text-[#9fa7b3]/50';

/** The invalid-state ring, as one composite. */
export const productInvalidRingState = 'aria-[invalid=true]:ring-[#f2495c]/25 aria-[invalid=true]:focus-visible:ring-[#f2495c]/25';

/** An accent ring at half opacity, for a hoverable accent surface. */
export const productAccentRingHalfState = 'ring-[#ff6500]/50';
/** Grafana's focus ring — the informational accent, not the brand accent. */
export const grafanaFocusRing = 'focus:outline-none focus:ring-2 focus:ring-[#5794f2]/50';

/** Grafana's focus ring on `:focus-visible` rather than `:focus`. */
export const grafanaFocusRingVisible = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/50';
/** The hero gradient, applied to clipped text rather than a surface. */
export const productHeroGradientText =
  'bg-gradient-to-r from-[#ff6500] to-[#ff8a3d] bg-clip-text text-transparent';

/** BORDERLESS CARD - rounded-md, border-0, background contrast only. Used for
 * student verification form base (#161616) and warning banners (#1e1e1e).
 * No gray lines, no wireframe margins, no cell borders. */
export const borderlessCard = 'rounded-md border-0';

/** FOCUS FLASH - #ff6500 ring animation, 150ms loop. Applied to focused
 * inputs and confirm buttons via the focus-flash-150ms CSS keyframe. */
export const focusFlash = 'focus-flash-150ms';
