// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./AccountGame', () => ({ AccountGame: () => <main data-testid="account-backed-game">account-backed game</main> }));

describe('game entry point', () => {
  it('renders only the account-backed game without an anonymous mode selector', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    host.id = 'root';
    document.body.append(host);
    try {
      await act(async () => { await import('./main'); });
      expect(host.querySelector('[data-testid="account-backed-game"]')?.textContent).toBe('account-backed game');
      expect(host.querySelectorAll('main')).toHaveLength(1);
      expect(host.querySelector('[data-testid="practice-mode"], [aria-label="Practice mode"]')).toBeNull();
      expect(host.textContent).not.toContain('Practice');
    } finally {
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
