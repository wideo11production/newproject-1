// ============================================================================
// Wideo11 i18n-core - Foundational Zero-Cost Translation Middleware
// ============================================================================
//
// WHY THIS PACKAGE EXISTS
//
// The existing `packages/i18n/` provides a React context for locale switching
// with 4 hardcoded locale files. It is a UI-level abstraction. What was missing
// is the FOUNDATIONAL layer beneath it: the middleware that decides WHICH locale
// to use, HOW to format numbers/currency for a user's country, and HOW to
// resolve a country context without any paid external API.
//
// This package is zero-cost:
//   - No paid translation API calls (no Google Cloud Translation, no DeepL)
//   - No paid currency API calls (no Open Exchange Rates, no CurrencyLayer)
//   - No geolocation API calls (no IPinfo, no MaxMind paid tier)
//   - Everything resolves from static data + browser APIs + Intl namespace
//
// HOW COUNTRY CONTEXT IS RESOLVED (in order of preference):
//
//   1. Explicit country set by the application (e.g. from auth profile,
//      billing address, or a user preference). This is the authoritative
//      source when available.
//
//   2. `navigator.language` / `navigator.languages` - the browser's own
//      locale setting. This is free, always available, and reflects what
//      the user's OS is set to.
//
//   3. `Intl.NumberFormat('en').resolvedOptions().numberSystem` and
//      `Intl.DateTimeFormat` - additional cultural signals from the browser's
//      ICU data. Free.
//
//   4. Fallback to 'US' / 'USD' when nothing else is available. This is a
//      safe default, not a guess.
//
// WHAT THIS PACKAGE PROVIDES
//
//   - Country → Currency mapping (static, ISO 4217)
//   - Country → Locale mapping (static, CLDR-based)
//   - Currency formatting via Intl.NumberFormat (free, browser-native)
//   - Locale resolution from multiple signals
//   - A React context provider for app-wide country/locale state
//   - A `useCountry` hook for components that need the resolved country
//
// ============================================================================

export {
  // Country / currency / locale mappings
  countryToCurrency,
  countryToLocale,
  currencyToLocale,
  supportedCurrencies,
  supportedLocales,
  supportedCountries,

  // Resolution functions
  resolveCountry,
  resolveLocale,
  resolveCurrency,

  // Formatting (zero-cost, Intl-based)
  formatCurrency,
  formatNumber,
  formatPercent,

  // React provider + hook
  CountryProvider,
  useCountry,
  useCurrency,
  useLocale,

  // Types
  type CountryCode,
  type CurrencyCode,
  type LocaleCode,
  type CountryContext,
} from './country';

export {
  // Translation dictionary loader (zero-cost, static imports)
  loadLocaleMessages,
  getFallbackChain,

  // Translation function
  translate,

  // React provider + hook
  I18nCoreProvider,
  useI18nCore,

  // Types
  type TranslationKey,
  type MessageDictionary,
  type I18nCoreContext,
} from './translator';