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

/** Page background - deep neutral */
export const surface = 'bg-gray-950';

/** Card/panel background (slightly raised) */
export const surfaceRaised = 'bg-gray-900/60';

/** Card border */
export const border = 'border-gray-800';

/** Primary text */
export const textPrimary = 'text-gray-100';

/** Secondary/muted text */
export const textMuted = 'text-gray-400';

/** Subtle text (labels, captions) */
export const textSubtle = 'text-gray-500';

/** Accent color - primary actions */
export const accent = 'text-blue-400';

/** Danger color - destructive actions, critical alerts */
export const danger = 'text-red-400';

/** Success color - healthy states */
export const success = 'text-green-400';

/** Warning color - caution states */
export const warning = 'text-yellow-400';

// ---------------------------------------------------------------------------
// LAYOUT TOKENS
// ---------------------------------------------------------------------------

/** Standard card container - every panel uses this */
export const card = `${surfaceRaised} ${border} rounded-xl p-5`;

/**
 * ENTERTAINMENT SHELL - full-bleed dark layout shell (landing page)
 *
 * `bg-[#111217]` = `colors.grafana.bg` EXACT hex. Ye `surface` (`bg-gray-950`)
 * se ALAG hai - gray-950 Tailwind ka built-in hai aur exact grafana value
 * nahi hai. Jab koi specifically "Grafana #111217 shell" maangta hai to ye
 * token use karo, `surface` nahi.
 *
 * `twMerge` discipline: ye token class-STRINGS hai, aur consumers inhe
 * `cn()` ke through dete hain - twMerge duplicate `bg-*` ko de-conflict karta
 * hai, isliye isko apni custom width/height ke saath safely mix kiya ja sakta
 * hai bina manual override kiye.
 */
export const entertainmentShell = 'bg-[#111217] text-[#d8d9da]';

/** Entertainment panel (hero card, content row tile) */
export const entertainmentPanel = 'border border-[#2c3235] bg-[#181b1f]';

/** Standard page shell - centers content with max width */
export const pageShell = `min-h-screen ${surface} ${textPrimary} p-6`;

/** Grid layouts */
export const grid2 = 'grid grid-cols-1 gap-4 md:grid-cols-2';
export const grid3 = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
export const grid4 = 'grid grid-cols-2 gap-4 lg:grid-cols-4';

// ---------------------------------------------------------------------------
// FORM TOKENS (the core fix for unaligned inputs)
// ---------------------------------------------------------------------------

/**
 * INPUT - standard text input
 *
 * Isko koi bhi input use kare to wo EXACTLY same height/padding/focus
 * behavior lega. Height 44px (h-11) industry standard touch target hai.
 */
export const input =
  'h-11 w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3.5 text-sm text-white ' +
  'placeholder:text-gray-600 transition-colors duration-200 ' +
  'focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ' +
  'aria-[invalid=true]:border-red-500/70 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** Input with trailing icon (password toggle etc.) - right padding free */
export const inputWithIcon = `${input} pr-11`;

/** SELECT - standard dropdown (native select) */
export const select =
  'h-11 w-full rounded-lg border border-gray-700 bg-gray-950 px-3.5 text-sm text-white ' +
  'transition-colors duration-200 ' +
  'focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** TEXTAREA - multi-line input */
export const textarea =
  'w-full rounded-lg border border-gray-700 bg-gray-950/60 px-3.5 py-2.5 text-sm text-white ' +
  'placeholder:text-gray-600 ' +
  'focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30';

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

/** PRIMARY BUTTON - main CTA */
export const buttonPrimary =
  'h-11 w-full rounded-lg bg-blue-600 font-medium text-white shadow-sm ' +
  'transition-colors duration-200 hover:bg-blue-500 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** SECONDARY BUTTON - alternative action */
export const buttonSecondary =
  'h-11 w-full rounded-lg border border-gray-700 bg-gray-900 font-medium text-gray-300 ' +
  'transition-colors duration-200 hover:bg-gray-800 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** GHOST BUTTON - low-emphasis action */
export const buttonGhost =
  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 ' +
  'transition-colors duration-200 hover:bg-gray-800 hover:text-gray-200';

/** DANGER BUTTON - destructive action */
export const buttonDanger =
  'h-11 w-full rounded-lg bg-red-600 font-medium text-white ' +
  'transition-colors duration-200 hover:bg-red-500 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/** ICON BUTTON - square, icon only */
export const buttonIcon =
  'flex h-9 w-9 items-center justify-center rounded-md text-gray-400 ' +
  'transition-colors duration-200 hover:bg-gray-800 hover:text-gray-200 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40';

// ---------------------------------------------------------------------------
// DATA DISPLAY TOKENS
// ---------------------------------------------------------------------------

/** Stat card - the KPI tiles used across dashboards */
export const statCard = `rounded-xl ${border} ${surfaceRaised} p-4`;

/** Stat value (big number) */
export const statValue = 'font-mono text-2xl font-bold text-white';

/** Stat label (small caption) */
export const statLabel = `text-xs ${textMuted}`;

/** Data table */
export const table = 'w-full text-sm';
export const tableHead = `border-b ${border} text-left text-xs uppercase ${textMuted}`;
export const tableCell = 'px-3 py-2 font-mono text-xs text-gray-300';

/** Section header */
export const sectionTitle = `text-lg font-semibold ${textPrimary}`;

/** Section subtitle */
export const sectionSubtitle = `text-sm ${textMuted}`;

/** BADGE - small status pill */
export const badge =
  'rounded-full border border-gray-700 bg-gray-800/60 px-2 py-0.5 text-[10px] font-semibold text-gray-300';

/** ALERT BOX - inline message */
export const alertInfo = `flex items-start gap-2.5 rounded-lg border border-blue-700/60 bg-blue-950/40 p-3 text-sm ${accent}`;
export const alertError = `flex items-start gap-2.5 rounded-lg border border-red-700/60 bg-red-950/40 p-3 text-sm ${danger}`;
export const alertSuccess = `flex items-start gap-2.5 rounded-lg border border-green-700/60 bg-green-950/40 p-3 text-sm ${success}`;
export const alertWarning = `flex items-start gap-2.5 rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-sm ${warning}`;

/** Spinner */
export const spinner = 'h-4 w-4 animate-spin';

/** STATUS DOT - online/offline indicator */
export const statusDot = 'inline-block h-2 w-2 rounded-full';
