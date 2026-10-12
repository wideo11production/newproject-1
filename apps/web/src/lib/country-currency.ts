// Country & Currency Detection - Dynamic country/currency detection for plans
// ============================================================================
// Detects user's country via IP geolocation and maps to appropriate currency/region
// Supports VPN usage - uses client-side IP detection which respects VPN
// Currency mapping follows billing-service ad-economics regions (India/High/Low)

'use client';

import { useState, useEffect, useCallback } from 'react';

// Region types matching billing-service ad-economics.go
export type Region = 'india' | 'high' | 'low';

export interface CountryCurrencyInfo {
  countryCode: string;
  countryName: string;
  currency: string;
  currencySymbol: string;
  region: Region;
  isDetected: boolean;
}

// Currency to region mapping (matching billing-service PlanPriceTable)
const CURRENCY_TO_REGION: Record<string, Region> = {
  // India region - INR
  INR: 'india',
  // High region - currencies stronger than INR
  USD: 'high',
  EUR: 'high',
  GBP: 'high',
  CHF: 'high',
  AUD: 'high',
  CAD: 'high',
  SGD: 'high',
  AED: 'high',
  // Low region - currencies weaker than INR
  JPY: 'low',
  CNY: 'low',
  NZD: 'low',
  // Default fallback
  LOCAL: 'low',
};

// Country code to currency mapping (ISO 4217)
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  IN: 'INR',
  US: 'USD',
  GB: 'GBP',
  EU: 'EUR', // EU as a pseudo-country for EUR zone
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  // Add more as needed
  JP: 'JPY',
  CN: 'CNY',
  AU: 'AUD',
  CA: 'CAD',
  SG: 'SGD',
  AE: 'AED',
  NZ: 'NZD',
  CH: 'CHF',
  // Default fallback for unknown countries
  XX: 'USD',
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  AED: 'د.إ',
  NZD: 'NZ$',
  CHF: 'CHF',
  LOCAL: '₹',
};

const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  BE: 'Belgium',
  AT: 'Austria',
  IE: 'Ireland',
  PT: 'Portugal',
  FI: 'Finland',
  GR: 'Greece',
  JP: 'Japan',
  CN: 'China',
  AU: 'Australia',
  CA: 'Canada',
  SG: 'Singapore',
  AE: 'UAE',
  NZ: 'New Zealand',
  CH: 'Switzerland',
  XX: 'International',
};

// Cache key for localStorage
const CACHE_KEY = 'wideo11_country_currency';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CachedCountryCurrency {
  data: CountryCurrencyInfo;
  timestamp: number;
}

/**
 * Detects user's country via IP geolocation
 * Uses ipapi.co (free tier: 1000 requests/day) which works through VPN
 * Falls back to browser timezone/locale if IP detection fails
 */
export async function detectCountryCurrency(): Promise<CountryCurrencyInfo> {
  // Check cache first
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: CachedCountryCurrency = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL) {
          return { ...parsed.data, isDetected: true };
        }
      }
    } catch {
      // Ignore cache errors
    }
  }

  let countryCode = 'XX';
  let detectionMethod: 'ip' | 'timezone' | 'locale' | 'fallback' = 'fallback';

  // Method 1: IP-based geolocation (works with VPN)
  try {
    const response = await fetch('https://ipapi.co/json/', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      // Timeout after 5 seconds
      signal: AbortSignal.timeout(5000),
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.country_code && typeof data.country_code === 'string') {
        countryCode = data.country_code.toUpperCase();
        detectionMethod = 'ip';
      }
    }
  } catch {
    // IP detection failed, try other methods
  }

  // Method 2: Browser timezone (fallback)
  if (countryCode === 'XX' && typeof Intl !== 'undefined') {
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Map common timezones to countries
      const tzToCountry: Record<string, string> = {
        'Asia/Kolkata': 'IN',
        'America/New_York': 'US',
        'America/Los_Angeles': 'US',
        'America/Chicago': 'US',
        'America/Denver': 'US',
        'Europe/London': 'GB',
        'Europe/Paris': 'FR',
        'Europe/Berlin': 'DE',
        'Europe/Rome': 'IT',
        'Europe/Madrid': 'ES',
        'Asia/Tokyo': 'JP',
        'Asia/Shanghai': 'CN',
        'Asia/Singapore': 'SG',
        'Australia/Sydney': 'AU',
        'America/Toronto': 'CA',
        'America/Vancouver': 'CA',
        'Pacific/Auckland': 'NZ',
        'Europe/Zurich': 'CH',
        'Asia/Dubai': 'AE',
      };
      countryCode = tzToCountry[timezone] || 'XX';
      if (countryCode !== 'XX') detectionMethod = 'timezone';
    } catch {
      // Timezone detection failed
    }
  }

  // Method 3: Browser locale (last fallback)
  if (countryCode === 'XX' && typeof navigator !== 'undefined') {
    const locale = navigator.language || 'en-US';
    const localeCountry = locale.split('-')[1]?.toUpperCase();
    if (localeCountry && localeCountry.length === 2) {
      countryCode = localeCountry;
      detectionMethod = 'locale';
    }
  }

  const currency = COUNTRY_TO_CURRENCY[countryCode] || 'USD';
  const region = CURRENCY_TO_REGION[currency] || 'low';
  const currencySymbol = CURRENCY_SYMBOLS[currency] || '$';
  const countryName = COUNTRY_NAMES[countryCode] || 'International';

  const result: CountryCurrencyInfo = {
    countryCode,
    countryName,
    currency,
    currencySymbol,
    region,
    isDetected: detectionMethod !== 'fallback',
  };

  // Cache the result
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data: result,
        timestamp: Date.now(),
      }));
    } catch {
      // Ignore cache errors
    }
  }

  return result;
}

/**
 * React hook for country/currency detection
 * Provides reactive state and manual refresh capability
 */
export function useCountryCurrency() {
  const [info, setInfo] = useState<CountryCurrencyInfo>({
    countryCode: 'XX',
    countryName: 'Detecting...',
    currency: 'USD',
    currencySymbol: '$',
    region: 'low',
    isDetected: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detected = await detectCountryCurrency();
      setInfo(detected);
    } catch (err) {
      setError('Failed to detect location. Using default.');
      setInfo({
        countryCode: 'XX',
        countryName: 'International',
        currency: 'USD',
        currencySymbol: '$',
        region: 'low',
        isDetected: false,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { info, loading, error, refresh };
}

/**
 * Get plan price for a specific region and tier
 * Mirrors billing-service PlanPriceTable
 */
export function getPlanPrice(region: Region, tier: 'quarterly' | 'biannual' | 'annual'): {
  price: number;
  currency: string;
  minBalance: number;
  days: number;
} {
  const priceTable: Record<Region, Record<string, { price: number; currency: string; minBalance: number; days: number }>> = {
    india: {
      quarterly: { price: 300, currency: 'INR', minBalance: 1000, days: 90 },
      biannual: { price: 500, currency: 'INR', minBalance: 1000, days: 180 },
      annual: { price: 1000, currency: 'INR', minBalance: 1000, days: 365 },
    },
    high: {
      quarterly: { price: 150, currency: 'USD', minBalance: 1000, days: 90 },
      biannual: { price: 250, currency: 'USD', minBalance: 1000, days: 180 },
      annual: { price: 500, currency: 'USD', minBalance: 1000, days: 365 },
    },
    low: {
      quarterly: { price: 450, currency: 'LOCAL', minBalance: 3000, days: 90 },
      biannual: { price: 750, currency: 'LOCAL', minBalance: 3000, days: 180 },
      annual: { price: 1500, currency: 'LOCAL', minBalance: 3000, days: 365 },
    },
  };

  return priceTable[region]?.[tier] || { price: 0, currency: 'USD', minBalance: 0, days: 0 };
}

/**
 * Format price for display with currency symbol
 */
export function formatPlanPrice(priceMinor: number, currency: string, symbol?: string): string {
  const major = priceMinor / 100;
  const sym = symbol || CURRENCY_SYMBOLS[currency] || currency;
  return `${sym}${major.toLocaleString()}`;
}

/**
 * Clear cached country/currency (useful for testing or manual override)
 */
export function clearCountryCurrencyCache(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(CACHE_KEY);
  }
}