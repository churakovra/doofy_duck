// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from './Game';
import { LocaleProvider } from './locale';

const state = vi.hoisted(() => ({ phase: 'READY' }));
vi.mock('./GameCanvas', () => ({ GameCanvas: () => <canvas aria-label="game" /> }));
vi.mock('./GameWardrobePreview', () => ({ GameWardrobePreview: () => <div data-testid="wardrobe-preview" /> }));
vi.mock('./useGameRun', () => ({ useGameRun: () => ({
  phase: state.phase, score: 14, rendererReady: true, runtimeError: '',
  getState: () => ({ phase: state.phase, tick: 0 }), getFeedback: () => null,
  acceptRenderer: vi.fn(), start: vi.fn(), restart: vi.fn(), pause: vi.fn(),
  onFieldPointerDown: vi.fn(), onFieldPointerUp: vi.fn(),
}) }));
vi.mock('./useGameProgress', () => ({ useGameProgress: () => ({
  canPlay: true, walletSessionStatus: 'ready', set: vi.fn(), refreshBest: vi.fn(), settleRun: vi.fn(),
  best: 31, wallet: { FEATHER: 1234, GAME_STAR: 56 }, walletPersistent: true,
}) }));
vi.mock('./useGameAudio', () => ({ useGameAudio: () => ({
  unlockFromGesture: vi.fn(), flap: vi.fn(), pickup: vi.fn(), setPhase: vi.fn(),
  preferences: { sound: true, music: true }, toggle: vi.fn(),
}) }));

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const stylesheet = readFileSync('apps/web/src/style.css', 'utf8');

function cssRule(selector: string, source = stylesheet) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.phase = 'READY';
  host = document.createElement('div');
  root = createRoot(host);
  act(() => root.render(<LocaleProvider><Game /></LocaleProvider>));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe('game HUD layout', () => {
  it('gives currency and score panels equal tracks and matching outer dimensions at every width', () => {
    const medium = stylesheet.match(/@container game-frame \(max-width: 520px\) \{([^]*?)\n\}/)?.[1] ?? '';
    const compact = stylesheet.match(/@container game-frame \(max-width: 360px\) \{([^]*?)\n\}/)?.[1] ?? '';
    const veryNarrow = stylesheet.match(/@container game-frame \(max-width: 240px\) \{([^]*?)\n\}/)?.[1] ?? '';
    const baseHud = cssRule('.hud');
    expect(baseHud).toContain('minmax(140px, 1fr) minmax(140px, 1fr)');
    expect(cssRule('.wallet-strip, .score-group')).toMatch(/width:\s*100%/);
    expect(cssRule('.wallet-strip, .score-group')).toMatch(/min-width:\s*140px/);
    expect(cssRule('.wallet-strip, .score-group')).toMatch(/min-height:\s*48px/);
    expect(cssRule('.wallet-strip, .score-group')).toMatch(/align-self:\s*stretch/);
    expect(cssRule('.hud', medium)).toContain('minmax(0, 1fr) minmax(0, 1fr)');
    expect(cssRule('.wallet-strip, .score-group', medium)).toMatch(/min-width:\s*0/);
    expect(cssRule('.hud', compact)).toContain('28px minmax(0, 1fr) minmax(0, 1fr) 94px');
    expect(cssRule('.hud', veryNarrow)).toContain('24px minmax(0, 1fr) minmax(0, 1fr) 90px');
    expect(stylesheet).toMatch(/@media \(max-height: 420px\) \{[^]*?\.wallet-strip, \.score-group \{ min-height: 44px; \}/);
  });

  it('groups currency and score panels after the brand and before the menu controls', () => {
    const hud = host.querySelector('.hud')!;
    const children = [...hud.children];
    expect(children[0]?.className).toBe('brand');
    expect(children[1]?.className).toBe('wallet-strip');
    expect(children[2]?.className).toBe('score-group');
    expect(children[3]?.className).toBe('hud-actions');
    expect(children[3]?.querySelector('.menu-trigger')).not.toBeNull();
    expect(children[3]?.querySelector('.wardrobe-trigger')).not.toBeNull();
    expect(hud.querySelectorAll('.wallet-total')).toHaveLength(2);
    const balances = [...hud.querySelectorAll<HTMLElement>('.wallet-total')];
    expect(balances.map((balance) => [...balance.children].map((child) => child.tagName))).toEqual([
      ['SPAN', 'STRONG'], ['SPAN', 'STRONG'],
    ]);
    expect(balances.every((balance) => balance.querySelector('.token')?.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(balances[0]?.getAttribute('aria-label')).toContain('монет');
    expect(balances[1]?.getAttribute('aria-label')).toContain('звёзд');
    expect(hud.querySelector('.wallet-total:nth-child(1) strong')?.textContent?.replace(/\D/g, '')).toBe('1234');
    expect(hud.querySelector('.wallet-total:nth-child(2) strong')?.textContent).toBe('56');
    expect(hud.querySelector('.score-card strong')?.textContent).toBe('14');
    expect(hud.querySelector('.best-card strong')?.textContent).toBe('31');
    expect(host.querySelector('.wallet-storage')?.textContent).toBe('Кошелёк на этом устройстве');
  });

  it('keeps the running score output and grouped HUD elements mounted', () => {
    state.phase = 'RUNNING';
    act(() => root.render(<LocaleProvider><Game /></LocaleProvider>));
    expect(host.querySelector('.running-score')).not.toBeNull();
    expect(host.querySelector('.brand')).not.toBeNull();
    expect(host.querySelector('.wallet-strip')).not.toBeNull();
    expect(host.querySelector('.score-group')).not.toBeNull();
    expect(host.querySelector('.menu-trigger')).not.toBeNull();
    expect(host.querySelector('.wardrobe-trigger')).toBeNull();
    expect(host.querySelectorAll('output')).toHaveLength(1);
  });
});
