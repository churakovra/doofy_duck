// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { Game } from './Game';
import { LocaleProvider } from './locale';

vi.mock('./AccountGame', () => ({ AccountGame: () => <main data-testid="account-backed-game">account-backed game</main> }));

describe('game entry point', () => {
  it('renders only the account-backed game without an anonymous mode selector', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      act(() => root.render(<LocaleProvider><Game /></LocaleProvider>));
      expect(host.querySelector('[data-testid="account-backed-game"]')?.textContent).toBe('account-backed game');
      expect(host.querySelectorAll('main')).toHaveLength(1);
      expect(host.querySelector('[data-testid="practice-mode"], [aria-label="Practice mode"]')).toBeNull();
      expect(host.textContent).not.toContain('Practice');
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
