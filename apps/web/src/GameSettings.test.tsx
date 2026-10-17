// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from './Game';
import { LocaleProvider } from './locale';
import './style.css';

const state = vi.hoisted(() => ({ phase: 'READY', pause: vi.fn(), start: vi.fn(), canRun: undefined as (() => boolean) | undefined, toggle: vi.fn(), field: vi.fn(), preferences: { sound: true, music: false } }));
vi.mock('./GameCanvas', () => ({ GameCanvas: () => <canvas aria-label="game" /> }));
vi.mock('./GameWardrobePreview', () => ({ GameWardrobePreview: () => <div className="wardrobe-preview-art" /> }));
vi.mock('./useGameRun', () => ({ useGameRun: (canRun: () => boolean) => { state.canRun = canRun; return ({
  phase: state.phase, score: 0, rendererReady: true, runtimeError: '',
  getState: () => ({ phase: state.phase, tick: 0 }), getFeedback: () => null,
  acceptRenderer: vi.fn(), start: state.start, restart: vi.fn(), pause: state.pause,
  onFieldPointerDown: state.field, onFieldPointerUp: vi.fn(),
}); } }));
vi.mock('./useGameProgress', () => ({ useGameProgress: () => ({
  canPlay: () => true, walletSessionStatus: 'ready', set: vi.fn(), refreshBest: vi.fn(), settleRun: vi.fn(),
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
  localStorage.clear();
  state.phase = 'READY'; state.preferences = { sound: true, music: false };
  state.pause.mockClear(); state.start.mockClear(); state.canRun = undefined; state.toggle.mockClear(); state.field.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('game settings menu', () => {
  it.each(['READY', 'PAUSED', 'DEAD'])('keeps a named menu trigger visible in %s', (phase) => {
    state.phase = phase; render();
    const trigger = menuTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(false);
    expect(getComputedStyle(trigger!).display).not.toBe('none');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.locale-controls')).toBeNull();
    expect(host.querySelector('.audio-controls')).toBeNull();
  });

  it.each(['READY', 'PAUSED', 'DEAD'])('shows a wardrobe trigger beside settings in %s', (phase) => {
    state.phase = phase; render();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Гардероб"]')).not.toBeNull();
    expect(host.querySelector('.hud-actions')?.children).toHaveLength(2);
  });

  it('hides wardrobe during flight and keeps settings and wardrobe mutually exclusive', () => {
    state.phase = 'RUNNING'; render();
    expect(host.querySelector('[aria-label="Гардероб"]')).toBeNull();
    expect(state.canRun?.()).toBe(true);
    state.phase = 'PAUSED'; render();
    click(host.querySelector('[aria-label="Гардероб"]')!);
    expect(host.querySelector('[aria-label="Меню"]')?.hasAttribute('disabled')).toBe(true);
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('wardrobe-heading');
    expect(state.canRun?.()).toBe(false);
    expect(state.pause).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
  });

  it.each(['READY', 'PAUSED', 'DEAD'])('does not permit run input while a modal is open in %s', (phase) => {
    state.phase = phase; render();
    expect(state.canRun?.()).toBe(true);
    click(host.querySelector('[aria-label="Гардероб"]')!);
    expect(state.canRun?.()).toBe(false);
    expect(state.pause).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
  });

  it('shows a localized session-only warning after Apply when storage writes fail', () => {
    state.phase = 'READY'; render();
    const nativeSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'doofy-duck:wardrobe:v1') throw new Error('blocked');
      return nativeSetItem.call(this, key, value);
    });
    click(host.querySelector('[aria-label="Гардероб"]')!);
    click([...host.querySelectorAll('button')].find((button) => button.textContent === 'Применить')!);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.screen-panel [role="status"]')?.textContent).toContain('Не удалось сохранить выбор');
  });

  it('marks the flight phase and renders a plain score without a pause control', () => {
    state.phase = 'RUNNING'; render();
    const frame = host.querySelector('.game-frame')!;
    expect(frame.classList.contains('running')).toBe(true);
    expect(host.querySelector('.running-score')).not.toBeNull();
    expect(host.querySelector('.running-score')?.tagName).toBe('OUTPUT');
    expect(host.querySelector('.running-score')?.closest('button')).toBeNull();
    expect(host.querySelector('.pause-button')).toBeNull();
  });

  it.each(['ru', 'en'] as const)('opens a localized modal without pausing the game (%s)', (locale) => {
    state.phase = 'PAUSED'; render(locale);
    const trigger = menuTrigger()!;
    trigger.focus(); click(trigger);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label') ?? dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(host.querySelector('[role="dialog"] h1, [role="dialog"] h2')).not.toBeNull();
    expect(state.pause).not.toHaveBeenCalled();
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
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')];
    expect(controls.length).toBeGreaterThan(1);
    controls.at(-1)!.focus();
    act(() => controls.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.activeElement).toBe(controls[0]);
  });

  it('renders the modal inside the fixed game frame and keeps the language choice pointer-active', () => {
    render(); openMenu();
    const frame = host.querySelector('.game-frame')!;
    const hud = host.querySelector('.hud')!;
    const backdrop = host.querySelector<HTMLElement>('.settings-backdrop')!;
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const language = dialog.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!;

    expect(frame.contains(backdrop)).toBe(true);
    expect(backdrop.closest('.hud')).toBeNull();
    expect(dialog.closest('.hud')).toBeNull();
    expect(hud.contains(backdrop)).toBe(false);
    expect(getComputedStyle(language).pointerEvents).toBe('auto');
    click(language);
    expect(dialog.querySelector('[role="listbox"]')).not.toBeNull();
    expect(frame.contains(dialog.querySelector('[role="listbox"]'))).toBe(true);
  });

  it('provides an accessible language dropdown and independent audio toggles', () => {
    render(); openMenu();
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    click(trigger);
    const listbox = host.querySelector('[role="listbox"]');
    const russian = host.querySelector<HTMLElement>('[role="option"][data-value="ru"]');
    const english = host.querySelector<HTMLElement>('[role="option"][data-value="en"]');
    expect(listbox?.getAttribute('aria-label')).toBe('Язык');
    expect(russian?.textContent).toContain('Русский');
    expect(english?.textContent).toContain('English');
    expect(russian?.getAttribute('aria-selected')).toBe('true');
    expect(english?.getAttribute('aria-selected')).toBe('false');
    const sound = host.querySelector<HTMLButtonElement>('[aria-label="Звук: вкл."], [aria-label="Sound: on"]');
    const music = host.querySelector<HTMLButtonElement>('[aria-label="Музыка: выкл."], [aria-label="Music: off"]');
    expect(sound?.getAttribute('aria-pressed')).toBe('true');
    expect(music?.getAttribute('aria-pressed')).toBe('false');
    act(() => sound!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    act(() => russian!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(state.field).not.toHaveBeenCalled();
    click(sound!); click(music!);
    expect(state.toggle).toHaveBeenNthCalledWith(1, 'sound');
    expect(state.toggle).toHaveBeenNthCalledWith(2, 'music');
  });

  it('opens the language list from the closed trigger with ArrowDown', () => {
    render(); openMenu();
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!;
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="option"][data-value="ru"]')?.contains(document.activeElement)).toBe(true);
  });

  it('changes language from the menu without restarting or remounting the canvas', () => {
    render();
    const canvas = host.querySelector('canvas');
    openMenu();
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!;
    click(trigger);
    const language = host.querySelector<HTMLElement>('[role="option"][data-value="en"]')!;
    click(language);
    expect(document.documentElement.lang).toBe('en');
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(state.pause).not.toHaveBeenCalled();
  });
});
