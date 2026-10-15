// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from './Game';
import { LocaleProvider } from './locale';
import './style.css';

const state = vi.hoisted(() => ({ phase: 'READY', pause: vi.fn(), toggle: vi.fn(), field: vi.fn(), preferences: { sound: true, music: false } }));
vi.mock('./GameCanvas', () => ({ GameCanvas: () => <canvas aria-label="game" /> }));
vi.mock('./useGameRun', () => ({ useGameRun: () => ({
  phase: state.phase, score: 0, rendererReady: true, runtimeError: '',
  getState: () => ({ phase: state.phase, tick: 0 }), getFeedback: () => null,
  acceptRenderer: vi.fn(), start: vi.fn(), restart: vi.fn(), pause: state.pause,
  onFieldPointerDown: state.field, onFieldPointerUp: vi.fn(),
}) }));
vi.mock('./useGameProgress', () => ({ useGameProgress: () => ({
  canPlay: true, walletSessionStatus: 'ready', set: vi.fn(), refreshBest: vi.fn(), settleRun: vi.fn(),
  best: 0, wallet: { FEATHER: 0, GAME_STAR: 0 }, walletPersistent: true,
}) }));
vi.mock('./useGameAudio', () => ({ useGameAudio: () => ({
  unlockFromGesture: vi.fn(), flap: vi.fn(), pickup: vi.fn(), setPhase: vi.fn(),
  preferences: state.preferences, toggle: state.toggle,
}) }));

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
function render(locale: 'ru' | 'en' = 'ru') {
  const storage = { getItem: (key: string) => key === 'doofy-duck:locale:v1' ? locale : null, setItem: vi.fn() } as unknown as Storage;
  act(() => root.render(<LocaleProvider storage={storage}><Game /></LocaleProvider>));
}
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
function menuTrigger() { return host.querySelector<HTMLButtonElement>('[aria-label="Меню"], [aria-label="Menu"]'); }
function openMenu() { click(menuTrigger()!); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.phase = 'READY'; state.preferences = { sound: true, music: false };
  state.pause.mockClear(); state.toggle.mockClear(); state.field.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('game settings menu', () => {
  it.each(['READY', 'RUNNING', 'PAUSED', 'DEAD'])('keeps a named menu trigger available in %s', (phase) => {
    state.phase = phase; render();
    const trigger = menuTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.locale-controls')).toBeNull();
    expect(host.querySelector('.audio-controls')).toBeNull();
  });

  it.each(['ru', 'en'] as const)('opens a localized modal and pauses only a running game (%s)', (locale) => {
    state.phase = 'RUNNING'; render(locale);
    const trigger = menuTrigger()!;
    trigger.focus(); click(trigger);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label') ?? dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(host.querySelector('[role="dialog"] h1, [role="dialog"] h2')).not.toBeNull();
    expect(state.pause).toHaveBeenCalledTimes(1);
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it.each(['READY', 'PAUSED', 'DEAD'])('does not pause on menu open in %s', (phase) => {
    state.phase = phase; render(); openMenu();
    expect(state.pause).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('closes on Escape, returns focus to the trigger, and does not resume', () => {
    state.phase = 'PAUSED'; render();
    const trigger = menuTrigger()!;
    click(trigger);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(state.pause).not.toHaveBeenCalled();
  });

  it('traps Tab within the dialog', () => {
    render(); openMenu();
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, select, [tabindex]:not([tabindex="-1"])')];
    expect(controls.length).toBeGreaterThan(1);
    controls.at(-1)!.focus();
    act(() => controls.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.activeElement).toBe(controls[0]);
  });

  it('renders the modal on the viewport plane outside the HUD and keeps the native dropdown pointer-active', () => {
    render(); openMenu();
    const viewport = host.querySelector('.game-viewport')!;
    const hud = host.querySelector('.hud')!;
    const backdrop = host.querySelector<HTMLElement>('.settings-backdrop')!;
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const language = dialog.querySelector<HTMLSelectElement>('select')!;

    expect(viewport.contains(backdrop)).toBe(true);
    expect(backdrop.closest('.hud')).toBeNull();
    expect(dialog.closest('.hud')).toBeNull();
    expect(hud.contains(backdrop)).toBe(false);
    expect(getComputedStyle(language).pointerEvents).toBe('auto');
  });

  it('provides a saved-locale language dropdown and independent accessible audio toggles', () => {
    render(); openMenu();
    const language = host.querySelector<HTMLSelectElement>('select[aria-label="Язык"], select[aria-label="Language"]');
    expect(language).not.toBeNull();
    expect([...language!.options].map(({ textContent, value }) => [textContent, value])).toEqual([
      ['Русский', 'ru'], ['English', 'en'],
    ]);
    expect(language!.value).toBe('ru');
    const sound = host.querySelector<HTMLButtonElement>('[aria-label="Звук: вкл."], [aria-label="Sound: on"]');
    const music = host.querySelector<HTMLButtonElement>('[aria-label="Музыка: выкл."], [aria-label="Music: off"]');
    expect(sound?.getAttribute('aria-pressed')).toBe('true');
    expect(music?.getAttribute('aria-pressed')).toBe('false');
    act(() => sound!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(state.field).not.toHaveBeenCalled();
    click(sound!); click(music!);
    expect(state.toggle).toHaveBeenNthCalledWith(1, 'sound');
    expect(state.toggle).toHaveBeenNthCalledWith(2, 'music');
  });

  it('changes language from the menu without restarting or remounting the canvas', () => {
    render();
    const canvas = host.querySelector('canvas');
    openMenu();
    const language = host.querySelector<HTMLSelectElement>('select[aria-label="Язык"], select[aria-label="Language"]')!;
    act(() => {
      language.value = 'en';
      language.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(document.documentElement.lang).toBe('en');
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(state.pause).not.toHaveBeenCalled();
  });
});
