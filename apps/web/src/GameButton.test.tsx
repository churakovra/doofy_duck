// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameButton } from './GameButton';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

it('isolates every button variant from field pointer input while preserving its action', () => {
  const field = vi.fn();
  const action = vi.fn();
  const pointer = vi.fn();
  act(() => root.render(<div onPointerDown={field}>
    {(['primary', 'pause', 'control'] as const).map((variant) => <GameButton key={variant} variant={variant} onPointerDown={pointer} onClick={action}>{variant}</GameButton>)}
  </div>));
  act(() => {
    for (const button of host.querySelectorAll('button')) {
      button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      button.click();
    }
  });
  expect(field).not.toHaveBeenCalled();
  expect(pointer).toHaveBeenCalledTimes(3);
  expect(action).toHaveBeenCalledTimes(3);
});

it('preserves native disabled and accessible toggle behavior without submitting a form', () => {
  const action = vi.fn();
  act(() => root.render(<GameButton variant="control" disabled aria-pressed={false} aria-label="Music" onClick={action}>Music: off</GameButton>));
  const button = host.querySelector('button')!;
  expect(button.type).toBe('button');
  expect(button.getAttribute('aria-label')).toBe('Music');
  expect(button.getAttribute('aria-pressed')).toBe('false');
  act(() => button.click());
  expect(action).not.toHaveBeenCalled();
});
