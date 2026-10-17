import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('document startup resources', () => {
  it('does not block practice startup on the external Telegram SDK', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=["']https:\/\/telegram\.org\//i);
  });
});
