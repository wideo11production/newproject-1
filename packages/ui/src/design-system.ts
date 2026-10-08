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
export const table = 'w-full text-sm';
export const tableHead = `text-left text-xs uppercase ${textMuted}`;
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
