// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSettings } from './GameSettings';
import { LocaleProvider, useLocale } from './locale';
import './style.css';

const toggle = vi.fn();
function SettingsHarness() {
  const { locale, setLocale, messages } = useLocale();
  const [open, setOpen] = useState(false);
  const portalContainer = useRef<HTMLDivElement>(null);
  return <main><section className="game-frame" ref={portalContainer}><header className="hud"><div className="hud-actions">
    <GameSettings locale={locale} setLocale={setLocale} messages={messages}
      preferences={{ sound: true, music: false }} toggle={toggle}
      wallet={{ FEATHER: 24, GAME_STAR: 2 }} walletPersistent walletStatus="ready" walletBlocked={false}
      portalContainer={portalContainer} open={open} onOpenChange={setOpen} />
  </div></header><div className="stage" /></section></main>;
}

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
function render(locale: 'ru' | 'en' = 'ru') {
  const storage = { getItem: (key: string) => key === 'doofy-duck:locale:v1' ? locale : null, setItem: vi.fn() } as unknown as Storage;
  act(() => root.render(<LocaleProvider storage={storage}><SettingsHarness /></LocaleProvider>));
}
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
function menuTrigger() { return host.querySelector<HTMLButtonElement>('[aria-label="Меню"], [aria-label="Menu"]'); }
function openMenu() { click(menuTrigger()!); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  toggle.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shared game settings menu', () => {
  it('keeps a named menu trigger visible and closed until requested', () => {
    render();
    expect(menuTrigger()).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.locale-controls')).toBeNull();
    expect(host.querySelector('.audio-controls')).toBeNull();
  });

  it.each(['ru', 'en'] as const)('opens a localized accessible modal (%s)', (locale) => {
    render(locale);
    const trigger = menuTrigger()!;
    trigger.focus(); click(trigger);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label') ?? dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(host.querySelector('[role="dialog"] h1, [role="dialog"] h2')).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and returns focus to the menu trigger', () => {
    render();
    const trigger = menuTrigger()!;
    click(trigger);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

  it('keeps the dialog portal in the game frame and its controls pointer-active', () => {
    render(); openMenu();
    const frame = host.querySelector('.game-frame')!;
    const backdrop = host.querySelector<HTMLElement>('.settings-backdrop')!;
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const language = dialog.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!;
    expect(frame.contains(backdrop)).toBe(true);
    expect(dialog.closest('.hud')).toBeNull();
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
    const sound = host.querySelector<HTMLButtonElement>('[aria-label="Звук: вкл."], [aria-label="Sound: on"]')!;
    const music = host.querySelector<HTMLButtonElement>('[aria-label="Музыка: выкл."], [aria-label="Music: off"]')!;
    expect(sound.getAttribute('aria-pressed')).toBe('true');
    expect(music.getAttribute('aria-pressed')).toBe('false');
    click(sound); click(music);
    expect(toggle).toHaveBeenNthCalledWith(1, 'sound');
    expect(toggle).toHaveBeenNthCalledWith(2, 'music');
  });

  it('opens the language list from the closed trigger with ArrowDown', () => {
    render(); openMenu();
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!;
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="option"][data-value="ru"]')?.contains(document.activeElement)).toBe(true);
  });

  it('changes language without replacing the game frame', () => {
    render();
    const frame = host.querySelector('.game-frame');
    openMenu();
    click(host.querySelector<HTMLButtonElement>('[data-testid="language-dropdown-trigger"]')!);
    click(host.querySelector<HTMLElement>('[role="option"][data-value="en"]')!);
    expect(document.documentElement.lang).toBe('en');
    expect(host.querySelector('.game-frame')).toBe(frame);
  });
});
