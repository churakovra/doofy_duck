// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTelegramWebApp, TelegramWebAppUnavailableError } from './telegram-web-app';

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'Telegram');
  document.querySelectorAll('script[src="https://telegram.org/js/telegram-web-app.js"]').forEach((script) => script.remove());
});

describe('Telegram Web App SDK loading', () => {
  it('adds an async SDK script and waits for its load event before exposing init data', async () => {
    const pending = loadTelegramWebApp(1_000);
    const script = document.querySelector<HTMLScriptElement>('script[src="https://telegram.org/js/telegram-web-app.js"]');
    expect(script?.async).toBe(true);
    expect(script?.defer).toBe(false);
    window.Telegram = { WebApp: { initData: 'signed-init-data' } };
    let settled = false;
    void pending.then(() => { settled = true; });
    expect(settled).toBe(false);

    script!.dispatchEvent(new Event('load'));

    await expect(pending).resolves.toMatchObject({ initData: 'signed-init-data' });
  });

  it('times out and permits a later retry', async () => {
    vi.useFakeTimers();
    const pending = loadTelegramWebApp(40);
    const pendingFailure = expect(pending).rejects.toBeInstanceOf(TelegramWebAppUnavailableError);
    const script = document.querySelector<HTMLScriptElement>('script[src="https://telegram.org/js/telegram-web-app.js"]')!;
    await vi.advanceTimersByTimeAsync(41);
    await pendingFailure;
    expect(script.isConnected).toBe(false);

    const retry = loadTelegramWebApp(40);
    const retryFailure = expect(retry).rejects.toBeInstanceOf(TelegramWebAppUnavailableError);
    const retryScript = document.querySelector<HTMLScriptElement>('script[src="https://telegram.org/js/telegram-web-app.js"]')!;
    expect(retryScript).not.toBe(script);
    retryScript.dispatchEvent(new Event('error'));
    await retryFailure;
  });
});
