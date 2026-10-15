import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { messages as englishMessages } from './messages.en';
import { messages as russianMessages, type MessageCatalog } from './messages.ru';
import type { StorageLike } from './storage';

export type Locale = 'ru' | 'en';
export type CountKind = 'coin' | 'gameStar' | 'score';
export type { MessageCatalog };
export type LocaleContextValue = {
  locale: Locale;
  messages: MessageCatalog;
  setLocale(locale: Locale): void;
};

const STORAGE_KEY = 'doofy-duck:locale:v1';
const catalogs: Record<Locale, MessageCatalog> = {
  ru: russianMessages,
  en: englishMessages,
};

function browserStorage(): StorageLike | undefined {
  try { return typeof window === 'undefined' ? undefined : globalThis.localStorage; }
  catch { return undefined; }
}

export function readLocale(storage: StorageLike | undefined = browserStorage()): Locale {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return saved === 'en' || saved === 'ru' ? saved : 'ru';
  } catch {
    return 'ru';
  }
}

export function writeLocale(storage: StorageLike | undefined, locale: Locale): void {
  try { storage?.setItem(STORAGE_KEY, locale); } catch { /* Preference is optional. */ }
}

export function formatCount(locale: Locale, kind: CountKind, count: number): string {
  const value = formatNumber(locale, count);
  return `${value} ${formatCountUnit(locale, kind, count)}`;
}

export function formatCountUnit(locale: Locale, kind: CountKind, count: number): string {
  if (kind === 'score') {
    if (locale === 'en') return count === 1 ? 'point' : 'points';
    const mod10 = Math.abs(count) % 10;
    const mod100 = Math.abs(count) % 100;
    return mod10 === 1 && mod100 !== 11 ? 'очко'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'очка' : 'очков';
  }
  if (locale === 'en') return kind === 'coin'
    ? (count === 1 ? 'coin' : 'coins')
    : `in-game ${count === 1 ? 'Star' : 'Stars'}`;
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (kind === 'coin') {
    return mod10 === 1 && mod100 !== 11 ? 'монета'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'монеты' : 'монет';
  }
  return mod10 === 1 && mod100 !== 11 ? 'игровая звезда'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'игровые звезды' : 'игровых звёзд';
}

export function formatNumber(locale: Locale, count: number): string {
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US').format(count);
}

const defaultValue: LocaleContextValue = {
  locale: 'ru', messages: russianMessages, setLocale: () => undefined,
};
const LocaleContext = createContext(defaultValue);

export function LocaleProvider({ children, storage }: { children: ReactNode; storage?: StorageLike }) {
  const [locale, setCurrentLocale] = useState<Locale>(() => readLocale(storage ?? browserStorage()));
  const setLocale = useCallback((next: Locale) => {
    setCurrentLocale(next);
    writeLocale(storage ?? browserStorage(), next);
  }, [storage]);
  const value = useMemo(() => ({ locale, messages: catalogs[locale], setLocale }), [locale, setLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = value.messages.documentTitle;
    let description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.append(description);
    }
    description.content = value.messages.documentDescription;
  }, [locale, value.messages]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue { return useContext(LocaleContext); }
