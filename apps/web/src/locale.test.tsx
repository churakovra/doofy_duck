// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider, formatCount, readLocale, useLocale, writeLocale } from './locale';
import { GameErrorBoundary } from './GameErrorBoundary';
import { messages as russian } from './messages.ru';
import { messages as english } from './messages.en';

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;

function MemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    values,
  };
}

function LocaleProbe() {
  const { locale, messages, setLocale } = useLocale();
  return <div>
    <output data-testid="locale">{locale}</output>
    <output data-testid="greeting">{messages.greeting}</output>
    <button onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}>switch</button>
  </div>;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('locale preference storage', () => {
  it('uses Russian by default and accepts only supported saved locales', () => {
    expect(readLocale()).toBe('ru');
    expect(readLocale(MemoryStorage({ 'doofy-duck:locale:v1': 'en' }) as unknown as Storage)).toBe('en');
    expect(readLocale(MemoryStorage({ 'doofy-duck:locale:v1': 'fr' }) as unknown as Storage)).toBe('ru');
    expect(readLocale(MemoryStorage({ 'doofy-duck:locale:v1': '{broken' }) as unknown as Storage)).toBe('ru');
  });

  it('falls back to Russian when reading is denied and tolerates a failed write', () => {
    const denied = { getItem: () => { throw new Error('storage denied'); } } as unknown as Storage;
    expect(readLocale(denied)).toBe('ru');
    const broken = { setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    expect(() => writeLocale(broken, 'en')).not.toThrow();
  });
});

describe('catalog coverage', () => {
  it('provides nonempty translations for the same complete message set', () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(russian).sort());
    for (const catalog of [russian, english]) {
      expect(Object.values(catalog).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});

describe('count wording', () => {
  it.each([
    [1, '1 монета'], [2, '2 монеты'], [5, '5 монет'], [11, '11 монет'], [21, '21 монета'],
  ])('formats Russian coin count %i', (count, expected) => {
    expect(formatCount('ru', 'coin', count)).toBe(expected);
  });

  it.each([
    [1, '1 coin'], [2, '2 coins'],
  ])('formats English coin count %i', (count, expected) => {
    expect(formatCount('en', 'coin', count)).toBe(expected);
  });

  it.each([
    ['ru', 1, '1 игровая звезда'], ['ru', 2, '2 игровые звезды'], ['ru', 5, '5 игровых звёзд'],
    ['en', 1, '1 in-game Star'], ['en', 2, '2 in-game Stars'],
  ] as const)('formats in-game Stars in %s for count %i', (locale, count, expected) => {
    expect(formatCount(locale, 'gameStar', count)).toBe(expected);
  });

  it('formats score counts with locale-appropriate number grouping', () => {
    expect(formatCount('ru', 'score', 1)).toBe('1 очко');
    expect(formatCount('ru', 'score', 2)).toBe('2 очка');
    expect(formatCount('ru', 'score', 11)).toBe('11 очков');
    expect(formatCount('en', 'score', 1)).toBe('1 point');
    expect(formatCount('en', 'score', 12345)).toBe('12,345 points');
  });
});

describe('LocaleProvider', () => {
  it('provides localized single-game lobby and retry copy in both catalogs', () => {
    expect(russian.greeting).toBe('Привет,');
    expect(english.greeting).toBe('Hello,');
    expect(russian.accountRetry).toBeTruthy();
    expect(english.accountRetry).toBeTruthy();
    expect(russian.accountStart).toBeTruthy();
    expect(english.accountStart).toBeTruthy();
  });

  it('formats verified run results with locale-appropriate score and currency units', () => {
    expect(formatCount('ru', 'score', 7)).toBe('7 очков');
    expect(formatCount('en', 'score', 7)).toBe('7 points');
    expect(formatCount('ru', 'coin', 0)).toBe('0 монет');
    expect(formatCount('en', 'coin', 0)).toBe('0 coins');
    expect(formatCount('en', 'gameStar', 0)).toBe('0 in-game Stars');
  });

  it('keeps the startup error fallback translated when its child fails', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function BrokenGame(): never { throw new Error('startup failed'); }
    try {
      const storage = MemoryStorage({ 'doofy-duck:locale:v1': 'en' }) as unknown as Storage;
      act(() => root.render(<LocaleProvider storage={storage}><LocaleProbe /><GameErrorBoundary><BrokenGame /></GameErrorBoundary></LocaleProvider>));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(english.unableToOpenGameHeading);
      act(() => host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(russian.unableToOpenGameHeading);
    } finally {
      report.mockRestore();
    }
  });

  it('exposes the selected catalog, updates document metadata, and persists a switch', () => {
    const storage = MemoryStorage() as unknown as Storage;
    act(() => root.render(<LocaleProvider storage={storage}><LocaleProbe /></LocaleProvider>));
    expect(host.querySelector('[data-testid="locale"]')?.textContent).toBe('ru');
    const russianTitle = document.title;
    const russianDescription = document.querySelector('meta[name="description"]')?.getAttribute('content');
    expect(russianTitle).toBeTruthy();
    expect(russianDescription).toBeTruthy();

    act(() => host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('[data-testid="locale"]')?.textContent).toBe('en');
    expect(host.querySelector('[data-testid="greeting"]')?.textContent).not.toBe('Привет,');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).not.toBe(russianTitle);
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).not.toBe(russianDescription);
    expect(storage.setItem).toHaveBeenCalledWith('doofy-duck:locale:v1', 'en');
  });

  it('updates account-facing catalog metadata when the locale changes', () => {
    const storage = MemoryStorage() as unknown as Storage;
    act(() => root.render(<LocaleProvider storage={storage}><LocaleProbe /></LocaleProvider>));
    expect(host.querySelector('[data-testid="greeting"]')?.textContent).toBe('Привет,');
    act(() => host.querySelector('button')!.click());
    expect(host.querySelector('[data-testid="greeting"]')?.textContent).toBe('Hello,');
    expect(document.documentElement.lang).toBe('en');
    expect(storage.setItem).toHaveBeenCalledWith('doofy-duck:locale:v1', 'en');
  });

  it('still changes locale when preference persistence fails', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    act(() => root.render(<LocaleProvider storage={storage}><LocaleProbe /></LocaleProvider>));
    expect(() => act(() => host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))).not.toThrow();
    expect(host.querySelector('[data-testid="locale"]')?.textContent).toBe('en');
  });
});
