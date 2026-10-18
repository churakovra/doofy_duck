export type LocalDevAccount = { enabled: boolean; telegramUserId: number };

type AccountEnvironment = {
  DEV?: boolean;
  VITE_DD_DEV_AUTH_ENABLED?: string;
  VITE_DD_DEV_USER_ID?: string;
};

const DEFAULT_LOCAL_TELEGRAM_USER_ID = 100000001;

export function localDevAccount(environment: AccountEnvironment): LocalDevAccount {
  const configuredId = environment.VITE_DD_DEV_USER_ID;
  const hasValidConfiguredId = !configuredId || /^[1-9]\d{0,19}$/.test(configuredId);
  const telegramUserId = configuredId && hasValidConfiguredId ? Number(configuredId) : DEFAULT_LOCAL_TELEGRAM_USER_ID;
  const validId = Number.isSafeInteger(telegramUserId) && telegramUserId > 0;
  return {
    enabled: environment.VITE_DD_DEV_AUTH_ENABLED === 'true' && hasValidConfiguredId && validId,
    telegramUserId: validId ? telegramUserId : DEFAULT_LOCAL_TELEGRAM_USER_ID,
  };
}

export const LOCAL_DEV_ACCOUNT = localDevAccount(import.meta.env);
