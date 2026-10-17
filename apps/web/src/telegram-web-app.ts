export type TelegramWebApp = {
  initData?: string;
  ready?: () => void;
};

export class TelegramWebAppUnavailableError extends Error {
  constructor() {
    super('telegram_web_app_unavailable');
    this.name = 'TelegramWebAppUnavailableError';
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const sdkUrl = 'https://telegram.org/js/telegram-web-app.js';
const sdkTimeoutMs = 5_000;
let loadPromise: Promise<TelegramWebApp> | undefined;

export function loadTelegramWebApp(timeoutMs = sdkTimeoutMs): Promise<TelegramWebApp> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new TelegramWebAppUnavailableError());
  }
  const existing = window.Telegram?.WebApp;
  if (existing) return Promise.resolve(existing);
  if (loadPromise) return loadPromise;

  const script = document.createElement('script');
  script.src = sdkUrl;
  script.async = true;
  const loading = new Promise<TelegramWebApp>((resolve, reject) => {
    const cleanup = () => {
      script.onload = null;
      script.onerror = null;
      window.clearTimeout(timeout);
    };
    const fail = () => {
      cleanup();
      script.remove();
      reject(new TelegramWebAppUnavailableError());
    };
    script.onload = () => {
      const webApp = window.Telegram?.WebApp;
      if (!webApp) {
        fail();
        return;
      }
      cleanup();
      resolve(webApp);
    };
    script.onerror = fail;
    const timeout = window.setTimeout(fail, timeoutMs);
    document.head.append(script);
  });
  const tracked = loading.then((webApp) => {
    if (loadPromise === tracked) loadPromise = undefined;
    return webApp;
  }, (error: unknown) => {
    if (loadPromise === tracked) loadPromise = undefined;
    throw error;
  });
  loadPromise = tracked;
  return tracked;
}
