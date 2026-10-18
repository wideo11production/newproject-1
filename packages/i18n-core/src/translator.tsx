// ============================================================================
// packages/i18n-core/src/translator.ts
//
// Static dictionary-based translation — zero-cost, no external APIs.
//
'use client';
// This module provides a foundational translation layer on top of static
// message dictionaries. It does NOT call Google Cloud Translation, DeepL,
// or any other paid service. All translations come from locally-stored
// dictionaries imported at build time.
//
// HINGLISH: Ye module static message dictionaries se translation deta hai -
// koi paid API call nahi. Sab kuch locally import hota hai build time pe.
//
// KEY DESIGN DECISIONS
//
// 1. Dot-notation keys: `dashboard.error_rate` → nested lookup in the dictionary.
// 2. Parameter substitution: `{count}`, `{email}` replaced at render time.
// 3. Fallback chain: requested locale → English → key itself.
// 4. Pluralization hints: `_one` / `_other` suffixes for plural forms.
// 5. React context provider for app-wide locale state.
//
// HOW TO ADD A NEW LOCALE
//
//   1. Create `src/locales/<xx>.ts` exporting a `messages` object.
//   2. Add the locale to `SUPPORTED_LOCALES` below.
//   3. Import it in `src/index.ts` and register in `ALL_MESSAGES`.
// ============================================================================

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from 'react';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { de } from './locales/de';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranslationKey = string;
export type MessageDictionary = Record<string, Record<string, string>>;

export interface I18nCoreContext {
  /** Current active locale code */
  locale: string;
  /** All loaded message dictionaries, keyed by locale */
  messages: Record<string, MessageDictionary>;
  /** Translate a key with optional params */
  t: (key: TranslationKey, params?: Record<string, unknown>) => string;
  /** Switch to a different locale */
  setLocale: (locale: string) => void;
  /** Available locale codes */
  availableLocales: string[];
}

// ---------------------------------------------------------------------------
// Supported locales
// ---------------------------------------------------------------------------

export const SUPPORTED_LOCALES: string[] = ['en', 'es', 'fr', 'de'];

// Default fallback: English.
export const DEFAULT_LOCALE: string = 'en';

// ---------------------------------------------------------------------------
// Static dictionary registry
// ---------------------------------------------------------------------------

/**
 * All locale messages, statically imported at build time.
 *
 * HINGLISH: Sab locale messages build time pe static import kiye gaye hain -
 * koi external API call nahi, sab local files se.
 */
export const ALL_MESSAGES: Record<string, MessageDictionary> = {
  en,
  es,
  fr,
  de,
};

/**
 * Load locale messages from the static registry.
 *
 * HINGLISH: Static registry se messages lao - dynamic import nahi.
 */
export function loadLocaleMessages(locale: string): MessageDictionary | null {
  return ALL_MESSAGES[locale] ?? null;
}

/**
 * Get the fallback chain for a locale: [requested, 'en', ...].
 *
 * HINGLISH: fallback chain - requested locale, phir English, phir key itself.
 */
export function getFallbackChain(locale: string): string[] {
  const chain: string[] = [locale];
  if (locale !== DEFAULT_LOCALE) {
    chain.push(DEFAULT_LOCALE);
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Translation function
// ---------------------------------------------------------------------------

/**
 * Get a nested value from a dictionary using dot notation.
 *
 * HINGLISH: dot notation se nested value nikalo dictionary se.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  return path
    .split('.')
    .reduce((acc: unknown, key: string) => {
      if (acc === null || acc === undefined || typeof acc !== 'object') {
        return undefined;
      }
      return (acc as Record<string, unknown>)[key];
    }, obj) as string | undefined;
}

/**
 * Translate a key using the active locale's dictionary.
 *
 * HINGLISH: active locale ke dictionary se key translate karo.
 * Params: {count: 5} → "{count} items" → "5 items"
 * Falls back: requested locale → English → return the key itself.
 */
export function translate(
  key: TranslationKey,
  messages: Record<string, MessageDictionary>,
  locale: string,
  params?: Record<string, unknown>
): string {
  const chain = getFallbackChain(locale);

  for (const loc of chain) {
    const dict = messages[loc];
    if (!dict) continue;

    const value = getNestedValue(dict, key);
    if (value && value !== key) {
      return substituteParams(value, params);
    }
  }

  // Last resort: return the key itself (operator can see what's missing)
  return key;
}

/**
 * Replace {param} placeholders in a translated string.
 *
 * HINGLISH: string mein {param} ko replace karo actual value se.
 */
function substituteParams(
  value: string,
  params?: Record<string, unknown>
): string {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_match, paramKey) => {
    const val = params[paramKey];
    if (val === undefined || val === null) return `{${paramKey}}`;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });
}

// ---------------------------------------------------------------------------
// React: I18nCoreProvider + useI18nCore hook
// ---------------------------------------------------------------------------

interface I18nCoreProviderProps {
  children: ReactNode;
  /** Initial locale. Defaults to 'en' or stored value in localStorage. */
  defaultLocale?: string;
  /** Persist selected locale to localStorage under 'wideo11.locale'. */
  persist?: boolean;
}

const I18nCoreContext = createContext<I18nCoreContext | null>(null);

export const I18nCoreProvider: React.FC<I18nCoreProviderProps> = ({
  children,
  defaultLocale = DEFAULT_LOCALE,
  persist = true,
}) => {
  const [locale, setLocaleState] = useState<string>(defaultLocale);
  const [messagesMap, setMessagesMap] = useState<Record<string, MessageDictionary>>(
    {}
  );

  // Load messages for the current locale on mount and on locale change.
  // Synchronously from the static registry — no async, no external API.
  useEffect(() => {
    const dict = loadLocaleMessages(locale);
    if (dict) {
      setMessagesMap((prev) => ({ ...prev, [locale]: dict }));
    }
  }, [locale]);

  // Restore persisted locale on mount.
  useEffect(() => {
    if (persist && typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('wideo11.locale');
        if (stored && SUPPORTED_LOCALES.includes(stored)) {
          setLocaleState(stored);
        }
      } catch {
        // ignore
      }
    }
  }, [persist]);

  const setLocale = useCallback(
    (nextLocale: string) => {
      if (!SUPPORTED_LOCALES.includes(nextLocale)) return;
      setLocaleState(nextLocale);
      if (persist && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('wideo11.locale', nextLocale);
        } catch {
          // ignore
        }
      }
    },
    [persist]
  );

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, unknown>): string => {
      return translate(key, messagesMap, locale, params);
    },
    [messagesMap, locale]
  );

  return (
    <I18nCoreContext.Provider
      value={{
        locale,
        messages: messagesMap,
        t,
        setLocale,
        availableLocales: SUPPORTED_LOCALES,
      }}
    >
      {children}
    </I18nCoreContext.Provider>
  );
};

export function useI18nCore(): I18nCoreContext {
  const c = useContext(I18nCoreContext);
  if (!c) {
    throw new Error(
      'useI18nCore must be used within an I18nCoreProvider. Wrap your app with <I18nCoreProvider>.'
    );
  }
  return c;
}