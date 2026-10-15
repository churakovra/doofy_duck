// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider, formatCount, readLocale, useLocale, writeLocale } from './locale';
import { Game } from './Game';
import { GameErrorBoundary } from './GameErrorBoundary';
import { messages as russian } from './messages.ru';
import { messages as english } from './messages.en';

const integration = vi.hoisted(() => ({ canvasMounts: 0, starts: vi.fn(), flaps: vi.fn(), fieldPointer: vi.fn(), phase: 'RUNNING', runtimeError: '' }));
vi.mock('./GameCanvas', async () => {
  const React = await import('react');
  return { GameCanvas: () => {
    React.useEffect(() => { integration.canvasMounts += 1; }, []);
    return <canvas data-testid="game-canvas" />;
  } };
});
vi.mock('./useGameRun', () => ({ useGameRun: () => ({
  phase: integration.phase, score: 7, runtimeError: integration.runtimeError, rendererReady: true,
  getState: () => ({ phase: 'RUNNING', tick: 42 }), getFeedback: () => null,
  acceptRenderer: vi.fn(), start: integration.starts, restart: vi.fn(), pause: vi.fn(),
  onFieldPointerDown: integration.fieldPointer, onFieldPointerUp: vi.fn(),
}) }));
vi.mock('./useGameProgress', () => ({ useGameProgress: () => ({
  canPlay: true, walletSessionStatus: 'ready', set: vi.fn(), refreshBest: vi.fn(), settleRun: vi.fn(),
  best: 12, wallet: { FEATHER: 3, GAME_STAR: 2 }, walletPersistent: true,
}) }));
vi.mock('./useGameAudio', () => ({ useGameAudio: () => ({
  unlockFromGesture: vi.fn(), flap: integration.flaps, pickup: vi.fn(), setPhase: vi.fn(),
  preferences: { sound: true, music: true }, toggle: vi.fn(),
}) }));

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
  integration.fieldPointer.mockClear();
  integration.phase = 'RUNNING';
  integration.runtimeError = '';
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
  it('keeps settings hidden until the menu is opened', () => {
    const storage = MemoryStorage() as unknown as Storage;
    act(() => root.render(<LocaleProvider storage={storage}><Game /></LocaleProvider>));
    expect(host.querySelector('.locale-controls')).toBeNull();
    expect(host.querySelector('.audio-controls')).toBeNull();
    const menu = [...host.querySelectorAll('button')].find((button) => ['Меню', 'Menu'].includes(button.getAttribute('aria-label') ?? ''));
    expect(menu).toBeDefined();
    act(() => menu!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('[role="dialog"] .locale-controls')).toBeTruthy();
    expect(host.querySelector('[role="dialog"] .audio-controls')).toBeTruthy();
  });

  it('keeps only the field and HUD in the bounded game frame', () => {
    const storage = MemoryStorage() as unknown as Storage;
    act(() => root.render(<LocaleProvider storage={storage}><Game /></LocaleProvider>));
    const field = host.querySelector('.stage')!;
    const frame = field.parentElement!;
    expect(frame).not.toBe(host.querySelector('main'));
    for (const selector of ['.hud', '.wallet-strip']) {
      expect(frame.contains(host.querySelector(selector))).toBe(true);
    }
  });

  it('translates completed-run scores and earnings without duplicate units', () => {
    integration.phase = 'DEAD';
    const storage = MemoryStorage() as unknown as Storage;
    act(() => root.render(<LocaleProvider storage={storage}><Game /></LocaleProvider>));
    expect(host.querySelector('.result-score')?.textContent).toBe('7 очков');
    expect(host.querySelector('.earnings-summary')?.textContent).toContain('0 монет');
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Меню"], [aria-label="Menu"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!.click());
    act(() => host.querySelector<HTMLElement>('[role="option"][data-value="en"]')!.click());
    expect(host.querySelector('.result-score')?.textContent).toBe('7 points');
    expect(host.querySelector('.earnings-summary')?.textContent).toContain('0 coins');
    expect(host.querySelector('.earnings-summary')?.textContent).toContain('0 in-game Stars');
  });

  it('translates an existing runtime error after switching language', () => {
    integration.phase = 'PAUSED';
    integration.runtimeError = 'graphicsStartupError';
    const storage = MemoryStorage() as unknown as Storage;
    act(() => root.render(<LocaleProvider storage={storage}><Game /></LocaleProvider>));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(russian.graphicsStartupError);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Меню"], [aria-label="Menu"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!.click());
    act(() => host.querySelector<HTMLElement>('[role="option"][data-value="en"]')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(english.graphicsStartupError);
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

  it('switches language during a live run without restarting input or remounting the canvas', () => {
    const storage = MemoryStorage() as unknown as Storage;
    integration.canvasMounts = 0;
    integration.starts.mockClear();
    integration.flaps.mockClear();
    act(() => root.render(<LocaleProvider storage={storage}><Game /></LocaleProvider>));
    expect(integration.canvasMounts).toBe(1);
    const canvas = host.querySelector('[data-testid="game-canvas"]');
    expect(host.textContent).toContain('7');

    const menu = host.querySelector<HTMLButtonElement>('[aria-label="Меню"], [aria-label="Menu"]');
    expect(menu).toBeDefined();
    act(() => menu!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const language = host.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]');
    expect(language).toBeDefined();
    act(() => {
      language!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    act(() => language!.click());
    const english = host.querySelector<HTMLElement>('[role="option"][data-value="en"]');
    expect(english).toBeDefined();
    act(() => english!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    act(() => english!.click());
    expect(integration.fieldPointer).not.toHaveBeenCalled();
    expect(document.documentElement.lang).toBe('en');
    expect(host.textContent).toContain('Coins');
    expect(host.querySelector('[data-testid="game-canvas"]')).toBe(canvas);
    expect(integration.canvasMounts).toBe(1);
    expect(integration.starts).not.toHaveBeenCalled();
    expect(integration.flaps).not.toHaveBeenCalled();
    expect(host.textContent).toContain('7');
  });

  it('still changes locale when preference persistence fails', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    act(() => root.render(<LocaleProvider storage={storage}><LocaleProbe /></LocaleProvider>));
    expect(() => act(() => host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))).not.toThrow();
    expect(host.querySelector('[data-testid="locale"]')?.textContent).toBe('en');
  });
});
