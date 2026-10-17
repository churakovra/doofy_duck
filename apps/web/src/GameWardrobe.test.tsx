// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameWardrobe } from './GameWardrobe';
import { messages as en } from './messages.en';
import { messages as ru } from './messages.ru';
import { DEFAULT_EQUIPMENT, type Equipment } from './wardrobe';

vi.mock('./GameWardrobePreview', () => ({ GameWardrobePreview: () => <div className="wardrobe-preview-art" /> }));

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let frame: HTMLDivElement;
const stylesheet = readFileSync('apps/web/src/style.css', 'utf8');
function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return stylesheet.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}
const applied = vi.fn();
const dismissed = vi.fn();
function render(locale: 'ru' | 'en' = 'en', equipped: Equipment = DEFAULT_EQUIPMENT) {
  act(() => root.render(<GameWardrobe locale={locale} messages={locale === 'en' ? en : ru} equipped={equipped} warning={false} portalContainer={{ current: frame }} onApply={applied} onDismiss={dismissed} />));
}
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host);
  frame = document.createElement('div'); document.body.append(frame);
  root = createRoot(host); applied.mockClear(); dismissed.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); frame.remove(); vi.unstubAllGlobals(); });

describe('wardrobe dialog', () => {
  it('keeps only a centered Apply action in the footer and retains the header close control', () => {
    expect(cssRule('.wardrobe-actions')).toMatch(/justify-content:\s*center/);
    expect(stylesheet).toMatch(/@container game-frame \(max-width: 240px\) \{[^]*?\.wardrobe-actions \{[^}]*justify-items:\s*center/);
    render(); click(host.querySelector('[aria-label="Wardrobe"]')!);
    const actions = frame.querySelector('.wardrobe-actions')!;
    expect(actions.querySelectorAll('button')).toHaveLength(1);
    expect(actions.querySelector('button')?.textContent).toBe('Apply');
    expect(frame.querySelector('.settings-dialog-header [aria-label="Close"]')).not.toBeNull();
  });

  it('groups each option name with its equipped label beside the centered swatch', () => {
    expect(cssRule('.wardrobe-option')).toMatch(/display:\s*flex/);
    expect(cssRule('.wardrobe-option')).toMatch(/align-items:\s*center/);
    expect(cssRule('.wardrobe-option')).toMatch(/justify-content:\s*center/);
    expect(cssRule('.wardrobe-option-copy')).toMatch(/display:\s*flex/);
    expect(cssRule('.wardrobe-option-copy')).toMatch(/flex-direction:\s*column/);
    expect(cssRule('.wardrobe-option-copy')).toMatch(/align-items:\s*center/);
    expect(cssRule('.wardrobe-option-copy')).toMatch(/overflow-wrap:\s*anywhere/);

    render(); click(host.querySelector('[aria-label="Wardrobe"]')!);
    const classic = [...frame.querySelectorAll<HTMLButtonElement>('.wardrobe-option')].find((button) => button.textContent?.includes('Classic'))!;
    const copy = classic.querySelector('.wardrobe-option-copy')!;
    expect(copy.children[0]?.textContent).toBe('Classic');
    expect(copy.children[1]?.textContent).toBe('Equipped');
    expect(classic.querySelector('.wardrobe-swatch')?.nextElementSibling).toBe(copy);
    const mint = [...frame.querySelectorAll<HTMLButtonElement>('.wardrobe-option')].find((button) => button.textContent?.includes('Mint'))!;
    expect(mint.querySelector('.wardrobe-option-copy')?.children).toHaveLength(1);
  });

  it.each([['ru', 'Гардероб'], ['en', 'Wardrobe']] as const)('localizes trigger and modal labels (%s)', (locale, label) => {
    render(locale);
    const trigger = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    click(trigger);
    expect(frame.querySelector('[role="dialog"] h2')?.textContent).toBe(label);
    expect(frame.querySelectorAll('.wardrobe-option')).toHaveLength(6);
    expect(frame.querySelector('.wardrobe-preview-art')).not.toBeNull();
  });

  it('marks the equipped pair, edits a draft, and closes without applying', () => {
    render(); click(host.querySelector('[aria-label="Wardrobe"]')!);
    const rose = [...frame.querySelectorAll<HTMLButtonElement>('.wardrobe-option')].find((button) => button.textContent?.includes('Rose'))!;
    click(rose);
    expect(rose.getAttribute('aria-pressed')).toBe('true');
    const winter = [...frame.querySelectorAll<HTMLButtonElement>('.wardrobe-option')].find((button) => button.textContent?.includes('Winter'))!;
    click(winter);
    click(frame.querySelector('[aria-label="Close"]')!);
    expect(applied).not.toHaveBeenCalled();
    expect(dismissed).toHaveBeenCalledOnce();
  });

  it('applies both selected IDs and restores focus to the trigger', () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Wardrobe"]')!;
    trigger.focus(); click(trigger);
    const rose = [...frame.querySelectorAll<HTMLButtonElement>('.wardrobe-option')].find((button) => button.textContent?.includes('Rose'))!;
    const winter = [...frame.querySelectorAll<HTMLButtonElement>('.wardrobe-option')].find((button) => button.textContent?.includes('Winter'))!;
    click(rose); click(winter);
    click([...frame.querySelectorAll('button')].find((button) => button.textContent === 'Apply')!);
    expect(applied).toHaveBeenCalledWith({ skinId: 'rose', backgroundId: 'winter' });
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape and returns focus to its trigger', () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Wardrobe"]')!;
    click(trigger);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(frame.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('contains keyboard focus inside the dialog in both Tab directions', () => {
    render(); click(host.querySelector('[aria-label="Wardrobe"]')!);
    const controls = [...frame.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    const first = controls[0]!;
    const last = controls.at(-1)!;
    first.focus();
    expect(document.activeElement).toBe(first);
    act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
    last.focus();
    act(() => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(first);
  });
});
