import { useState, useEffect, createContext, useContext, createElement } from 'react';
import { en } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { de } from './locales/de';

export type Locale = 'en' | 'es' | 'fr' | 'de';
export type Messages = Record<string, Record<string, string>>;

export const defaultLocale: Locale = 'en';

export const locales: Locale[] = ['en', 'es', 'fr', 'de'];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇬🇧',
  es: '🇪🇸',
  fr: '🇫🇷',
  de: '🇩🇪',
};

export const messages: Record<Locale, Messages> = {
  en,
  es,
  fr,
  de,
};

export interface I18nContextType {
  locale: Locale;
  messages: Messages;
  t: (key: string, params?: Record<string, unknown>) => string;
  setLocale: (locale: Locale) => void;
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  formatRelativeTime: (seconds: number) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'en',
  messages: en,
  t: (key) => key,
  setLocale: () => {},
  formatDate: (date) => date.toString(),
  formatNumber: (num) => num.toString(),
  formatRelativeTime: (seconds) => `${seconds}s`,
});

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};

const getNestedValue = (obj: any, path: string): string => {
  return path.split('.').reduce((acc, key) => acc?.[key], obj) || path;
};

export const I18nProvider: React.FC<{
  children: React.ReactNode;
  locale?: Locale;
  defaultNS?: string;
}> = ({ children, locale = defaultLocale }) => {
  const [currentLocale, setLocale] = useState<Locale>(locale);
  const [messagesMap, setMessagesMap] = useState<Messages>(messages[locale]);

  useEffect(() => {
    const storedLocale = localStorage.getItem('locale') as Locale;
    if (storedLocale && locales.includes(storedLocale)) {
      setLocale(storedLocale);
      setMessagesMap(messages[storedLocale]);
    }
  }, []);

  const changeLocale = (newLocale: Locale) => {
    setLocale(newLocale);
    setMessagesMap(messages[newLocale]);
    localStorage.setItem('locale', newLocale);
    document.documentElement.lang = newLocale;
  };

  const t = (key: string, params?: Record<string, unknown>): string => {
    let value = getNestedValue(messagesMap, key);
    if (value === key) {
      value = getNestedValue(messages[currentLocale], key);
    }
    
    if (params) {
      Object.entries(params).forEach(([paramKey, paramValue]) => {
        if (typeof paramValue === 'object') {
          value = value.replace(new RegExp(`{${paramKey}}`, 'g'), JSON.stringify(paramValue));
        } else {
          value = value.replace(new RegExp(`{${paramKey}}`, 'g'), String(paramValue));
        }
      });
    }

    return value;
  };

  const formatDate = (date: Date | string, options?: Intl.DateTimeFormatOptions): string => {
    const d = new Date(date);
    return new Intl.DateTimeFormat(currentLocale, options).format(d);
  };

  const formatNumber = (num: number, options?: Intl.NumberFormatOptions): string => {
    return new Intl.NumberFormat(currentLocale, options).format(num);
  };

  const formatRelativeTime = (seconds: number): string => {
    const units = currentLocale === 'en' ? ['year', 'month', 'week', 'day', 'hour', 'minute'] : ['year', 'month', 'week', 'day', 'hour', 'minute'];
    
    if (seconds < 60) return t('time.seconds', { count: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('time.minutes', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('time.hours', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t('time.days', { count: days });
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return t('time.weeks', { count: weeks });
    const months = Math.floor(weeks / 4);
    if (months < 12) return t('time.months', { count: months });
    const years = Math.floor(months / 12);
    return t('time.years', { count: years });
  };

  return createElement(
    I18nContext.Provider,
    {
      value: {
        locale: currentLocale,
        messages: messagesMap,
        t,
        setLocale: changeLocale,
        formatDate,
        formatNumber,
        formatRelativeTime,
      },
    },
    children,
  );
};

