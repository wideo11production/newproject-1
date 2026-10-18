// ============================================================================
// packages/i18n-core/src/country.ts
//
// Country / Currency / Locale resolution — zero-cost, no external APIs.
//
'use client';
// This module maps a country code to its canonical currency and locale using
// static tables. All resolution uses Intl (browser-native, free) or static
// data — nothing calls a paid geolocation or currency service.
//
// HINGLISH: Ye module country code ko uske currency aur locale se map karta
// hai using static tables. Koi external API call nahi hota - sab Intl ya
// static data se resolve hota hai.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CountryCode = string;
export type CurrencyCode = string;
export type LocaleCode = string;

export interface CountryContext {
  /** ISO 3166-1 alpha-2 country code (e.g. 'US', 'IN', 'GB') */
  country: CountryCode;
  /** ISO 4217 currency code (e.g. 'USD', 'INR', 'GBP') */
  currency: CurrencyCode;
  /** BCP 47 locale tag (e.g. 'en-US', 'hi-IN', 'en-GB') */
  locale: LocaleCode;
  /** Human-readable currency symbol for display */
  currencySymbol: string;
  /** How many minor units the currency uses (usually 2) */
  currencyDecimals: number;
  /** Source that determined this context */
  source: 'explicit' | 'browser' | 'fallback';
  /** Change the resolved country (updates currency + locale accordingly).
   * Optional when used outside a CountryProvider (returns no-op). */
  setCountry?: (countryCode: CountryCode) => void;
}

// ---------------------------------------------------------------------------
// Static mappings — country → currency / locale
// ---------------------------------------------------------------------------

/** ISO 4217 currency per country. Extracted from CLDR / ISO tables. */
export const countryToCurrency: Record<CountryCode, CurrencyCode> = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  EU: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  IN: 'INR',
  PK: 'PKR',
  BD: 'BDT',
  LK: 'LKR',
  NP: 'NPR',
  JP: 'JPY',
  KR: 'KRW',
  CN: 'CNY',
  HK: 'HKD',
  TW: 'TWD',
  SG: 'SGD',
  AU: 'AUD',
  NZ: 'NZD',
  CH: 'CHF',
  NO: 'NOK',
  SE: 'SEK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RU: 'RUB',
  TR: 'TRY',
  IL: 'ILS',
  AE: 'AED',
  SA: 'SAR',
  QA: 'QAR',
  KW: 'KWD',
  BH: 'BHD',
  OM: 'OMR',
  JO: 'JOD',
  EG: 'EGP',
  ZA: 'ZAR',
  NG: 'NGN',
  KE: 'KES',
  BR: 'BRL',
  MX: 'MXN',
  AR: 'ARS',
  CL: 'CLP',
  CO: 'COP',
  PE: 'PEN',
  MY: 'MYR',
  TH: 'THB',
  ID: 'IDR',
  PH: 'PHP',
  VN: 'VND',
  UA: 'UAH',
};

/** BCP 47 locale tag per country (primary language/script region). */
export const countryToLocale: Record<CountryCode, LocaleCode> = {
  US: 'en-US',
  CA: 'en-CA',
  GB: 'en-GB',
  EU: 'en-EU',
  DE: 'de-DE',
  FR: 'fr-FR',
  ES: 'es-ES',
  IT: 'it-IT',
  NL: 'nl-NL',
  BE: 'nl-BE',
  AT: 'de-AT',
  IE: 'en-IE',
  PT: 'pt-PT',
  FI: 'fi-FI',
  GR: 'el-GR',
  IN: 'hi-IN',
  PK: 'en-PK',
  BD: 'bn-BD',
  LK: 'si-LK',
  NP: 'ne-NP',
  JP: 'ja-JP',
  KR: 'ko-KR',
  CN: 'zh-CN',
  HK: 'zh-HK',
  TW: 'zh-TW',
  SG: 'en-SG',
  AU: 'en-AU',
  NZ: 'en-NZ',
  CH: 'de-CH',
  NO: 'nb-NO',
  SE: 'sv-SE',
  DK: 'da-DK',
  PL: 'pl-PL',
  CZ: 'cs-CZ',
  HU: 'hu-HU',
  RU: 'ru-RU',
  TR: 'tr-TR',
  IL: 'he-IL',
  AE: 'ar-AE',
  SA: 'ar-SA',
  QA: 'ar-QA',
  KW: 'ar-KW',
  BH: 'ar-BH',
  OM: 'ar-OM',
  JO: 'ar-JO',
  EG: 'ar-EG',
  ZA: 'en-ZA',
  NG: 'en-NG',
  KE: 'en-KE',
  BR: 'pt-BR',
  MX: 'es-MX',
  AR: 'es-AR',
  CL: 'es-CL',
  CO: 'es-CO',
  PE: 'es-PE',
  MY: 'ms-MY',
  TH: 'th-TH',
  ID: 'id-ID',
  PH: 'en-PH',
  VN: 'vi-VN',
  UA: 'uk-UA',
};

/** All currency codes we know how to format. */
export const supportedCurrencies: CurrencyCode[] = [
  'USD', 'CAD', 'GBP', 'EUR', 'INR', 'PKR', 'BDT', 'LKR', 'NPR',
  'JPY', 'KRW', 'CNY', 'HKD', 'TWD', 'SGD', 'AUD', 'NZD', 'CHF',
  'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'RUB', 'TRY', 'ILS',
  'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'EGP', 'ZAR',
  'NGN', 'KES', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'MYR',
  'THB', 'IDR', 'PHP', 'VND', 'UAH',
];

/** All locale tags we support formatting for. */
export const supportedLocales: LocaleCode[] = Object.values(countryToLocale);

/** All country codes we know about. */
export const supportedCountries: CountryCode[] = Object.keys(countryToCurrency);

// ---------------------------------------------------------------------------
// Currency → locale mapping (for formatting when we know the currency but
// not the country, e.g. a price shown to a user without a resolved country)
// ---------------------------------------------------------------------------

export const currencyToLocale: Record<CurrencyCode, LocaleCode> = {
  USD: 'en-US',
  CAD: 'en-CA',
  GBP: 'en-GB',
  EUR: 'de-DE',
  INR: 'hi-IN',
  PKR: 'en-PK',
  BDT: 'bn-BD',
  LKR: 'si-LK',
  NPR: 'ne-NP',
  JPY: 'ja-JP',
  KRW: 'ko-KR',
  CNY: 'zh-CN',
  HKD: 'zh-HK',
  TWD: 'zh-TW',
  SGD: 'en-SG',
  AUD: 'en-AU',
  NZD: 'en-NZ',
  CHF: 'de-CH',
  NOK: 'nb-NO',
  SEK: 'sv-SE',
  DKK: 'da-DK',
  PLN: 'pl-PL',
  CZK: 'cs-CZ',
  HUF: 'hu-HU',
  RUB: 'ru-RU',
  TRY: 'tr-TR',
  ILS: 'he-IL',
  AED: 'ar-AE',
  SAR: 'ar-SA',
  QAR: 'ar-QA',
  KWD: 'ar-KW',
  BHD: 'ar-BH',
  OMR: 'ar-OM',
  JOD: 'ar-JO',
  EGP: 'ar-EG',
  ZAR: 'en-ZA',
  NGN: 'en-NG',
  KES: 'en-KE',
  BRL: 'pt-BR',
  MXN: 'es-MX',
  ARS: 'es-AR',
  CLP: 'es-CL',
  COP: 'es-CO',
  PEN: 'es-PE',
  MYR: 'ms-MY',
  THB: 'th-TH',
  IDR: 'id-ID',
  PHP: 'en-PH',
  VND: 'vi-VN',
  UAH: 'uk-UA',
};

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a complete CountryContext from an explicit country code.
 *
 * HINGLISH: country code se pura context nikalo - currency, locale, symbol,
 * decimals. Source = 'explicit' kyunki user ya app ne diya hai.
 */
export function resolveCountryByCode(country: CountryCode): CountryContext {
  const upper = country.toUpperCase();
  const currency = countryToCurrency[upper] ?? 'USD';
  const locale = countryToLocale[upper] ?? 'en-US';
  const symbol = currencySymbol(currency);
  const decimals = currencyDecimals(currency);

  return {
    country: upper,
    currency,
    locale,
    currencySymbol: symbol,
    currencyDecimals: decimals,
    source: 'explicit',
  };
}

/**
 * Resolve a CountryContext from the browser environment (navigator language,
 * Intl resolved options). Source = 'browser'.
 *
 * HINGLISH: browser ke navigator aur Intl se context nikalo - koi paid API
 * nahi call ki jaati.
 */
export function resolveCountryFromBrowser(): CountryContext {
  // Try navigator.language first (e.g. "en-IN", "hi-IN", "en-US")
  const navLang =
    typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : undefined;

  if (navLang) {
    // Extract region from language tag (e.g. "en-IN" -> "IN")
    const region = navLang.split('-').pop()?.toUpperCase();
    if (region && countryToCurrency[region]) {
      return resolveCountryByCode(region);
    }
  }

  // Fall through to Intl-based guess
  try {
    const nf = new Intl.NumberFormat('en');
    const resolved = nf.resolvedOptions();
    const locale = resolved.locale;
    const region = locale.split('-').pop()?.toUpperCase();
    if (region && countryToCurrency[region]) {
      return resolveCountryByCode(region);
    }
  } catch {
    // Intl not available or locale unsupported
  }

  // Fallback: US / USD
  return resolveCountryByCode('US');
}

/**
 * Resolve a CountryContext with priority: explicit > browser > fallback.
 *
 * HINGLISH: Pehle explicit country check karo, phir browser, phir fallback
 * (US/USD).
 */
export function resolveCountry(
  explicitCountry?: CountryCode
): CountryContext {
  if (explicitCountry && countryToCurrency[explicitCountry.toUpperCase()]) {
    return resolveCountryByCode(explicitCountry.toUpperCase());
  }
  if (typeof navigator !== 'undefined' || typeof Intl !== 'undefined') {
    return resolveCountryFromBrowser();
  }
  return resolveCountryByCode('US');
}

/** Resolve just the currency code for a given country. */
export function resolveCurrency(country?: CountryCode): CurrencyCode {
  return resolveCountry(country).currency;
}

/** Resolve just the locale tag for a given country. */
export function resolveLocale(country?: CountryCode): LocaleCode {
  return resolveCountry(country).locale;
}

// ---------------------------------------------------------------------------
// Formatting helpers (zero-cost, Intl-based)
// ---------------------------------------------------------------------------

/** Currency symbol for a given ISO 4217 code. */
export function currencySymbol(code: CurrencyCode): string {
  try {
    const nf = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
    });
    // Extract symbol by formatting 0 and stripping digits/format chars
    const parts = nf.formatToParts(0);
    const symPart = parts.find((p) => p.type === 'currency');
    return symPart ? symPart.value : code;
  } catch {
    return code;
  }
}

/** Number of minor units (decimals) a currency uses. */
export function currencyDecimals(code: CurrencyCode): number {
  // Zero-decimal currencies
  const zeroDecimal = ['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'PYG'];
  return zeroDecimal.includes(code) ? 0 : 2;
}

/**
 * Format a numeric amount as currency for a given country context.
 *
 * Zero-cost: uses Intl.NumberFormat, no external API.
 *
 * HINGLISH: amount ko currency ke roop mein format karo us country ke
 * liye - Intl se, koi paid API nahi.
 */
export function formatCurrency(
  amount: number,
  country?: CountryCode,
  opts?: Intl.NumberFormatOptions
): string {
  const ctx = resolveCountry(country);
  return new Intl.NumberFormat(ctx.locale, {
    style: 'currency',
    currency: ctx.currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: ctx.currencyDecimals,
    maximumFractionDigits: ctx.currencyDecimals,
    ...opts,
  }).format(amount);
}

/**
 * Format a plain number for a given country context.
 *
 * HINGLISH: plain number ko us country ke format mein dikhao.
 */
export function formatNumber(
  num: number,
  country?: CountryCode,
  opts?: Intl.NumberFormatOptions
): string {
  const ctx = resolveCountry(country);
  return new Intl.NumberFormat(ctx.locale, opts).format(num);
}

/**
 * Format a ratio (0-1) as a percentage for a given country context.
 *
 * HINGLISH: 0-1 ke ratio ko us country ke percentage format mein dikhao.
 */
export function formatPercent(
  ratio: number,
  country?: CountryCode,
  opts?: Intl.NumberFormatOptions
): string {
  const ctx = resolveCountry(country);
  return new Intl.NumberFormat(ctx.locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...opts,
  }).format(ratio);
}

// ---------------------------------------------------------------------------
// React: CountryProvider + useCountry hook
// ---------------------------------------------------------------------------

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from 'react';

interface CountryProviderProps {
  children: ReactNode;
  /** If provided, overrides browser detection. ISO 3166-1 alpha-2. */
  defaultCountry?: CountryCode;
  /** If true, persist the resolved country to localStorage. */
  persist?: boolean;
}

const CountryContext = createContext<CountryContext | null>(null);

export const CountryProvider: React.FC<CountryProviderProps> = ({
  children,
  defaultCountry,
  persist = true,
}) => {
  // Initialize with a resolved value to avoid null context during first render
  const [ctx, setCtx] = useState<CountryContext>(() => {
    const initial = resolveCountry(defaultCountry);
    return { ...initial };
  });

  useEffect(() => {
    const resolved = resolveCountry(defaultCountry);
    setCtx({ ...resolved });

    if (persist && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('wideo11.country', resolved.country);
      } catch {
        // localStorage unavailable - silently ignore
      }
    }
  }, [defaultCountry, persist]);

  const setCountry = useCallback(
    (country: CountryCode) => {
      const next = resolveCountryByCode(country);
      setCtx(next);
      if (persist && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('wideo11.country', next.country);
        } catch {
          // ignore
        }
      }
    },
    [persist]
  );

  return (
    <CountryContext.Provider value={{ ...ctx, setCountry }}>
      {children}
    </CountryContext.Provider>
  );
};

export function useCountry(): CountryContext {
  const c = useContext(CountryContext);
  if (!c) {
    // Return a fallback context with no-op setCountry
    return {
      ...resolveCountry(),
      setCountry: () => {},
    };
  }
  return c;
}

/**
 * Convenience hook: just the resolved currency code.
 */
export function useCurrency(): CurrencyCode {
  return useCountry().currency;
}

/**
 * Convenience hook: just the resolved locale tag.
 */
export function useLocale(): LocaleCode {
  return useCountry().locale;
}