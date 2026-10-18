import type { RunState } from '@doofy-duck/game-sim';
import type { ShopCatalog, ShopQuote, ShopItemType } from './account-shop';

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
};

export type AccountSummary = {
  account_id: string;
  telegram_user_id: number;
  created_at: string;
};

export type AccountProgress = { bestScore: number };

export type AccountRunStatus = 'active' | 'completion_pending' | 'completed' | 'rejected' | 'abandoned';
export type AccountVerificationStatus = 'in_progress' | 'verified' | 'rejected';
export type AccountDeliveryStatus = 'not_ready' | 'pending' | 'delivered' | 'rejected';
export type AccountRunSnapshot = {
  runId: string;
  accountId: string;
  lifeIndex: number;
  seed: number;
  simulationVersion: string;
  generatorVersion: string;
  configId: string;
  state: RunState;
  status: AccountRunStatus;
  verificationStatus: AccountVerificationStatus;
  deliveryStatus: AccountDeliveryStatus;
  checkpointSequence: number;
  writerGeneration: number;
  activeTicks: number;
  activeTickLimit: number;
  submissionDeadline: string;
  completionReason?: 'death' | 'flight_cap';
  writerToken?: string;
};

export type AccountCheckpoint = {
  checkpointSequence: number;
  writerGeneration: number;
  writerToken: string;
  idempotencyKey: string;
  ticks: readonly (readonly { sequence: number; action: 'FLAP' }[])[];
};

type AccountApiOptions = {
  baseUrl?: string;
  fetcher?: FetchLike;
};

export class AccountApiError extends Error {
  constructor(readonly status: number, readonly code: string, message = code, readonly retryAfterMs?: number, readonly current?: unknown) {
    super(message);
    this.name = 'AccountApiError';
  }
}

const authCookieLockName = 'doofy-duck:auth-cookie-mutation';
const uncertainRefreshKey = 'doofy-duck:auth-refresh-outcome-uncertain';
const refreshTimeoutMs = 15_000;
const authorizedRequestTimeoutMs = 30_000;
const localRefreshQueues = new Map<string, Promise<void>>();

async function withAuthCookieLock<T>(operation: () => Promise<T>, requireBrowserLock = false): Promise<T> {
  const previous = localRefreshQueues.get(authCookieLockName) ?? Promise.resolve();
  let unlock!: () => void;
  const turn = new Promise<void>((resolve) => { unlock = resolve; });
  const queued = previous.then(() => turn);
  localRefreshQueues.set(authCookieLockName, queued);
  await previous;
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(authCookieLockName, { mode: 'exclusive' }, operation);
    }
    if (requireBrowserLock) throw new AccountApiError(0, 'auth_refresh_coordination_unavailable');
    return await operation();
  } finally {
    unlock();
    if (localRefreshQueues.get(authCookieLockName) === queued) localRefreshQueues.delete(authCookieLockName);
  }
}

function errorFrom(response: Response, body: unknown): AccountApiError {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const detailValue = record.detail ?? record.error;
  const detail = detailValue && typeof detailValue === 'object' ? detailValue as Record<string, unknown> : record;
  const code = typeof detail.code === 'string' ? detail.code : typeof record.error === 'string' ? record.error : `http_${response.status}`;
  const message = typeof detail.message === 'string' ? detail.message : code;
  const retryAfter = response.headers.get('Retry-After');
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const until = Date.parse(retryAfter);
    const parsed = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(until) ? until - Date.now() : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) retryAfterMs = Math.min(parsed, 300_000);
  }
  return new AccountApiError(response.status, code, message, retryAfterMs, detail.current);
}

function csrfCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const pair = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('dd_csrf='));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice('dd_csrf='.length)); }
  catch { return pair.slice('dd_csrf='.length); }
}

function validTokenResponse(value: unknown): value is TokenResponse {
  if (!value || typeof value !== 'object') return false;
  const token = value as Partial<TokenResponse>;
  return typeof token.access_token === 'string' && token.access_token.length > 0
    && token.token_type === 'Bearer' && typeof token.expires_in === 'number'
    && Number.isInteger(token.expires_in) && token.expires_in > 0;
}

export class AccountApi {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  #accessToken: string | undefined;
  #boundAccountId: string | undefined;
  #refreshFlight: Promise<void> | undefined;
  #sessionGeneration = 0;
  #requests = new Set<AbortController>();

  constructor(options: AccountApiOptions = {}) {
    this.baseUrl = (options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
  }

  get signedIn(): boolean { return this.#accessToken !== undefined; }

  async login(initData: string): Promise<AccountSummary> {
    if (!initData.trim()) throw new AccountApiError(400, 'telegram_init_data_missing');
    const generation = this.beginSessionChange();
    const token = await withAuthCookieLock(() => this.fetchToken('/api/v1/auth/telegram', {
      method: 'POST', body: JSON.stringify({ init_data: initData }),
    }));
    this.assertSessionGeneration(generation);
    clearUncertainRefresh();
    return this.readAndBindCurrentAccount(generation, token.access_token);
  }

  async loginDev(telegramUserId: number): Promise<AccountSummary> {
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
      throw new AccountApiError(400, 'telegram_user_id_invalid');
    }
    const generation = this.beginSessionChange();
    const token = await withAuthCookieLock(() => this.fetchToken('/api/v1/auth/dev', {
      method: 'POST', body: JSON.stringify({ telegram_user_id: telegramUserId }),
    }));
    this.assertSessionGeneration(generation);
    clearUncertainRefresh();
    return this.readAndBindCurrentAccount(generation, token.access_token);
  }

  async restore(): Promise<AccountSummary> {
    const generation = this.#sessionGeneration;
    await this.refreshToken(generation);
    this.assertSessionGeneration(generation);
    return this.readAndBindCurrentAccount(generation);
  }

  async account(): Promise<AccountSummary> {
    return await this.authorized('/api/v1/account') as AccountSummary;
  }

  async createRun(): Promise<AccountRunSnapshot> {
    return await this.authorized('/api/v1/runs', { method: 'POST' }) as AccountRunSnapshot;
  }

  async currentRun(): Promise<AccountRunSnapshot | undefined> {
    try { return await this.authorized('/api/v1/runs/current') as AccountRunSnapshot; }
    catch (error) {
      if (error instanceof AccountApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async latestRun(): Promise<AccountRunSnapshot | undefined> {
    try { return await this.authorized('/api/v1/runs/latest') as AccountRunSnapshot; }
    catch (error) {
      if (error instanceof AccountApiError && error.status === 404) return undefined;
      throw error;
    }
  }

  async progress(): Promise<AccountProgress> {
    const value = await this.authorized('/api/v1/runs/progress') as Partial<AccountProgress>;
    if (!Number.isSafeInteger(value.bestScore) || value.bestScore! < 0) {
      throw new AccountApiError(502, 'account_progress_invalid');
    }
    return { bestScore: value.bestScore! };
  }

  async shopCatalog(): Promise<ShopCatalog> {
    return await this.authorized('/api/v1/shop/catalog') as ShopCatalog;
  }

  async shopInventory(cursor?: string, limit = 100): Promise<{ items: readonly unknown[]; next_cursor: string | null }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AccountApiError(400, 'shop_page_limit_invalid');
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return await this.authorized(`/api/v1/shop/inventory?${query}`) as { items: readonly unknown[]; next_cursor: string | null };
  }

  async shopEquipment(): Promise<{ equipment: readonly { item_type: ShopItemType; item_id: string; revision: number }[] }> {
    return await this.authorized('/api/v1/shop/equipment') as { equipment: readonly { item_type: ShopItemType; item_id: string; revision: number }[] };
  }

  async setShopEquipment(itemType: ShopItemType, itemId: string, expectedRevision: number): Promise<{ item_type: ShopItemType; item_id: string; revision: number }> {
    return await this.authorized(`/api/v1/shop/equipment/${itemType}`, {
      method: 'PUT', body: JSON.stringify({ item_id: itemId, expected_revision: expectedRevision }),
    }) as { item_type: ShopItemType; item_id: string; revision: number };
  }

  async shopQuote(itemType: ShopItemType, itemId: string): Promise<ShopQuote> {
    return await this.authorized('/api/v1/shop/quotes', {
      method: 'POST', body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    }) as ShopQuote;
  }

  async shopPurchase(quoteId: string, idempotencyKey: string): Promise<unknown> {
    return await this.authorized('/api/v1/shop/purchases', {
      method: 'POST', body: JSON.stringify({ quote_id: quoteId }),
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  async shopPurchaseLookup(idempotencyKey: string): Promise<unknown> {
    const query = new URLSearchParams({ idempotency_key: idempotencyKey });
    return await this.authorized(`/api/v1/shop/purchases/lookup?${query}`);
  }

  async shopPurchases(cursor?: string, limit = 50): Promise<unknown> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AccountApiError(400, 'shop_page_limit_invalid');
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    return await this.authorized(`/api/v1/shop/purchases?${query}`);
  }

  async walletBalances(): Promise<unknown> {
    return await this.authorized('/api/v1/wallets');
  }

  async completion(runId: string, lifeIndex: number): Promise<unknown> {
    return await this.authorized(`/api/v1/completions/${encodeURIComponent(runId)}/${lifeIndex}`);
  }

  async getRun(runId: string): Promise<AccountRunSnapshot> {
    return await this.authorized(`/api/v1/runs/${encodeURIComponent(runId)}`) as AccountRunSnapshot;
  }

  async submitCheckpoint(runId: string, checkpoint: AccountCheckpoint): Promise<AccountRunSnapshot> {
    return await this.authorized(`/api/v1/runs/${encodeURIComponent(runId)}/checkpoints`, {
      method: 'POST', body: JSON.stringify(checkpoint),
    }) as AccountRunSnapshot;
  }

  async takeover(runId: string): Promise<AccountRunSnapshot> {
    return await this.authorized(`/api/v1/runs/${encodeURIComponent(runId)}/takeover`, { method: 'POST' }) as AccountRunSnapshot;
  }

  async abandon(runId: string, writerGeneration: number, writerToken: string): Promise<AccountRunSnapshot> {
    return await this.authorized(`/api/v1/runs/${encodeURIComponent(runId)}/abandon`, {
      method: 'POST', body: JSON.stringify({ writerGeneration, writerToken }),
    }) as AccountRunSnapshot;
  }

  async logout(): Promise<void> {
    const generation = this.beginSessionChange();
    await withAuthCookieLock(async () => {
      if (generation !== this.#sessionGeneration) return;
      const csrf = csrfCookie();
      const response = await this.fetchWithDeadline(this.url('/api/v1/auth/logout'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(this.#accessToken ? { Authorization: `Bearer ${this.#accessToken}` } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
      });
      if (response.ok) clearUncertainRefresh();
    });
  }

  cancelPendingRequests(): void {
    for (const controller of this.#requests) controller.abort();
    this.#requests.clear();
  }

  async authorized(path: string, init: RequestInit = {}): Promise<unknown> {
    const generation = this.#sessionGeneration;
    if (!this.#accessToken) throw new AccountApiError(401, 'account_session_required');
    const controller = new AbortController();
    this.#requests.add(controller);
    let timeout: number | undefined;
    let timedOut = false;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new AccountApiError(0, 'request_timeout'));
      }, authorizedRequestTimeoutMs);
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new AccountApiError(0, timedOut ? 'request_timeout' : 'account_session_superseded'));
      }, { once: true });
    });
    const operation = async () => {
      let response = await this.fetchAuthorized(path, { ...init, signal: controller.signal }, generation);
      this.assertSessionGeneration(generation);
      if (response.status === 401) {
        await this.refreshToken(generation);
        this.assertSessionGeneration(generation);
        response = await this.fetchAuthorized(path, { ...init, signal: controller.signal }, generation);
      }
      this.assertSessionGeneration(generation);
      const body = await this.readResponse(response);
      this.assertSessionGeneration(generation);
      return body;
    };
    try { return await Promise.race([operation(), deadline, cancelled]); }
    finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      this.#requests.delete(controller);
    }
  }

  private async fetchAuthorized(path: string, init: RequestInit, generation: number): Promise<Response> {
    this.assertSessionGeneration(generation);
    const token = this.#accessToken;
    if (!token) throw new AccountApiError(401, 'account_session_required');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return this.fetcher(this.url(path), { ...init, headers, credentials: 'include' });
  }

  private async readCurrentAccount(generation: number, accessToken = this.#accessToken, sharedSignal?: AbortSignal): Promise<AccountSummary> {
    this.assertSessionGeneration(generation);
    if (!accessToken) throw new AccountApiError(401, 'account_session_required');
    const controller = sharedSignal ? undefined : new AbortController();
    const signal = sharedSignal ?? controller!.signal;
    if (controller) this.#requests.add(controller);
    let timedOut = false;
    let timeout: number | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      if (sharedSignal) return;
      timeout = window.setTimeout(() => {
        timedOut = true;
        controller!.abort();
        reject(new AccountApiError(0, 'request_timeout'));
      }, authorizedRequestTimeoutMs);
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      if (sharedSignal) return;
      signal.addEventListener('abort', () => {
        reject(new AccountApiError(0, timedOut ? 'request_timeout' : 'account_session_superseded'));
      }, { once: true });
    });
    const operation = async () => {
      const response = await this.fetcher(this.url('/api/v1/account'), {
        headers: new Headers({ Authorization: `Bearer ${accessToken}` }), credentials: 'include', signal,
      });
      this.assertSessionGeneration(generation);
      const value = await this.readResponse(response);
      this.assertSessionGeneration(generation);
      if (!value || typeof value !== 'object') throw new AccountApiError(502, 'account_response_invalid');
      const account = value as Partial<AccountSummary>;
      if (typeof account.account_id !== 'string' || account.account_id.length === 0
        || !Number.isSafeInteger(account.telegram_user_id) || (account.telegram_user_id ?? 0) <= 0
        || typeof account.created_at !== 'string') throw new AccountApiError(502, 'account_response_invalid');
      return account as AccountSummary;
    };
    try {
      return sharedSignal ? await operation() : await Promise.race([operation(), deadline, cancelled]);
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (controller) this.#requests.delete(controller);
    }
  }

  private async readAndBindCurrentAccount(generation: number, candidateToken = this.#accessToken): Promise<AccountSummary> {
    try {
      const account = await this.readCurrentAccount(generation, candidateToken);
      this.assertSessionGeneration(generation);
      // Keep a newly exchanged bearer private until its server-verified identity
      // has been read successfully. The assignments are synchronous and expose
      // the credential only after its identity binding is in place.
      this.#boundAccountId = account.account_id;
      if (candidateToken) this.#accessToken = candidateToken;
      return account;
    } catch (error) {
      if (generation === this.#sessionGeneration) {
        this.#accessToken = undefined;
        this.#boundAccountId = undefined;
      }
      throw error;
    }
  }

  private fetchWithDeadline(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timeout: number | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = window.setTimeout(() => {
        controller.abort();
        reject(new AccountApiError(0, 'request_timeout'));
      }, authorizedRequestTimeoutMs);
    });
    return Promise.race([
      this.fetcher(input, { ...init, signal: controller.signal }), deadline,
    ]).finally(() => { if (timeout !== undefined) window.clearTimeout(timeout); });
  }

  private async refreshToken(generation: number): Promise<void> {
    this.assertSessionGeneration(generation);
    if (this.#refreshFlight) return this.#refreshFlight;
    const flight = withAuthCookieLock(async () => {
      this.assertSessionGeneration(generation);
      if (isRefreshUncertain()) throw new AccountApiError(401, 'auth_refresh_outcome_uncertain');
      const csrf = csrfCookie();
      if (!csrf) throw new AccountApiError(401, 'account_session_expired');
      markRefreshUncertain();
      const controller = new AbortController();
      this.#requests.add(controller);
      let timeout: number | undefined;
      const request = this.fetchToken('/api/v1/auth/refresh', {
        method: 'POST', headers: { 'X-CSRF-Token': csrf }, signal: controller.signal,
      }).then(async (token) => {
        this.assertSessionGeneration(generation);
        const expectedAccountId = this.#boundAccountId;
        if (expectedAccountId) {
          const refreshedAccount = await this.readCurrentAccount(generation, token.access_token, controller.signal);
          // Some fetch implementations and test transports resolve a response body
          // after abort. A timed-out refresh no longer owns session state.
          if (controller.signal.aborted || timedOut) {
            throw new AccountApiError(0, timedOut ? 'auth_refresh_outcome_uncertain' : 'account_session_superseded');
          }
          if (refreshedAccount.account_id !== expectedAccountId) {
            this.#accessToken = undefined;
            clearUncertainRefresh();
            throw new AccountApiError(409, 'account_session_identity_mismatch');
          }
        }
        this.assertSessionGeneration(generation);
        return token;
      });
      let timedOut = false;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
          markRefreshUncertain();
          reject(new AccountApiError(0, 'auth_refresh_outcome_uncertain'));
        }, refreshTimeoutMs);
      });
      const cancelled = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          if (!timedOut) reject(new AccountApiError(0, 'account_session_superseded'));
        }, { once: true });
      });
      try {
        const token = await Promise.race([request, deadline, cancelled]);
        this.assertSessionGeneration(generation);
        this.#accessToken = token.access_token;
        clearUncertainRefresh();
      } catch (error) {
        if (error instanceof AccountApiError && (error.status === 401 || error.status === 403)) clearUncertainRefresh();
        throw error;
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
        this.#requests.delete(controller);
      }
    }, true).catch((error: unknown) => {
      if (generation === this.#sessionGeneration) this.#accessToken = undefined;
      throw error;
    });
    this.#refreshFlight = flight;
    try { await flight; }
    finally { if (this.#refreshFlight === flight) this.#refreshFlight = undefined; }
  }

  private async fetchToken(path: string, init: RequestInit): Promise<TokenResponse> {
    const response = await this.fetcher(this.url(path), {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const body = await this.readResponse(response);
    if (!validTokenResponse(body)) throw new AccountApiError(502, 'invalid_auth_response');
    return body;
  }

  private async readResponse(response: Response): Promise<unknown> {
    let body: unknown;
    try { body = await response.json(); }
    catch { body = undefined; }
    if (!response.ok) throw errorFrom(response, body);
    return body;
  }

  private url(path: string): string { return `${this.baseUrl}${path}`; }

  private beginSessionChange(): number {
    this.#sessionGeneration += 1;
    this.cancelPendingRequests();
    this.#accessToken = undefined;
    this.#boundAccountId = undefined;
    this.#refreshFlight = undefined;
    return this.#sessionGeneration;
  }

  private assertSessionGeneration(generation: number): void {
    if (generation !== this.#sessionGeneration) throw new AccountApiError(0, 'account_session_superseded');
  }
}

function isRefreshUncertain(): boolean {
  try { return localStorage.getItem(uncertainRefreshKey) === '1'; }
  catch { throw new AccountApiError(0, 'auth_refresh_coordination_unavailable'); }
}

function markRefreshUncertain(): void {
  try {
    localStorage.setItem(uncertainRefreshKey, '1');
    if (localStorage.getItem(uncertainRefreshKey) !== '1') throw new Error('Refresh uncertainty marker was not persisted');
  } catch {
    throw new AccountApiError(0, 'auth_refresh_coordination_unavailable');
  }
}

function clearUncertainRefresh(): void {
  try { localStorage.removeItem(uncertainRefreshKey); }
  catch { /* A new login still installs its fresh in-memory bearer token. */ }
}

