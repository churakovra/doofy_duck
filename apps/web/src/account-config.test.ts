import { describe, expect, it } from 'vitest';
import { localDevAccount } from './account-config';

describe('local development account configuration', () => {
  it('is disabled unless the local build explicitly enables it', () => {
    expect(localDevAccount({ DEV: true })).toEqual({ enabled: false, telegramUserId: 100000001 });
    expect(localDevAccount({ VITE_DD_DEV_AUTH_ENABLED: 'true', VITE_DD_DEV_USER_ID: '7654321' }))
      .toEqual({ enabled: true, telegramUserId: 7654321 });
  });

  it('rejects invalid configured Telegram IDs and remains disabled', () => {
    expect(localDevAccount({ VITE_DD_DEV_AUTH_ENABLED: 'true', VITE_DD_DEV_USER_ID: '-1' }))
      .toEqual({ enabled: false, telegramUserId: 100000001 });
    expect(localDevAccount({ VITE_DD_DEV_AUTH_ENABLED: 'false', VITE_DD_DEV_USER_ID: '7654321' }))
      .toEqual({ enabled: false, telegramUserId: 7654321 });
  });
});
