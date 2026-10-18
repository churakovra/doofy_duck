import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('apps/web/src/style.css', 'utf8');

function cssRule(selector: string, source = stylesheet) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('account game HUD layout', () => {
  it('keeps the shared HUD and game field inside the bounded frame', () => {
    expect(cssRule('.game-frame')).toContain('aspect-ratio: 360 / 580');
    expect(cssRule('.stage')).toContain('position: absolute');
    expect(cssRule('.stage')).toContain('inset: 0');
    expect(cssRule('.hud')).toContain('pointer-events: none');
    expect(cssRule('.hud button')).toContain('pointer-events: auto');
  });

  it('keeps the shared menu touch targets usable in narrow account frames', () => {
    const compact = stylesheet.match(/@container game-frame \(max-width: 240px\) \{([^]*?)\n\}/)?.[1] ?? '';
    const short = stylesheet.match(/@media \(max-height: 420px\) \{([^]*?)\n\}/)?.[1] ?? '';
    expect(cssRule('.hud', compact)).toContain('24px minmax(0, 1fr) minmax(0, 1fr) 90px');
    expect(cssRule('.hud-actions', compact)).toContain('gap: 2px');
    expect(compact).toMatch(/\.hud-actions \.menu-trigger[^}]*min-width:\s*44px/);
    expect(cssRule('.account-shop-dialog', short)).toContain('padding: 10px');
  });

  it('centers the live score while the account run is in flight', () => {
    expect(stylesheet).toMatch(/\.game-frame\.running \.hud \{[^}]*justify-content:\s*center/);
    expect(stylesheet).toMatch(/\.game-frame\.running \.brand, \.game-frame\.running \.score-group,[^]*?\.wallet-status-strip[^}]*display:\s*none/);
    expect(cssRule('.running-score')).toContain('font-variant-numeric: tabular-nums');
  });
});
