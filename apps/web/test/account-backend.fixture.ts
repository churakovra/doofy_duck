import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { createRun, createRunDescriptor, step, type RunState } from '@doofy-duck/game-sim';

type RouteTarget = Pick<Page, 'route' | 'addInitScript'> | Pick<BrowserContext, 'route' | 'addInitScript'>;
type FixtureOptions = { balances?: { FEATHER: number; GAME_STAR: number } };
type FixtureRun = {
  id: string;
  state: RunState;
  checkpointSequence: number;
  writerGeneration: number;
  writerToken: string;
  status: 'active' | 'completed' | 'abandoned';
  credited: { FEATHER: number; GAME_STAR: number };
};

const account = { account_id: 'browser-test-account', telegram_user_id: 100000001, created_at: '2026-01-01T00:00:00Z' };
const catalog = {
  catalog_version: 'browser-fixture-v1',
  enabled: true,
  items: [
    { item_type: 'skin', item_id: 'classic', display_name: { en: 'Classic', ru: 'Классика' }, asset_id: 'classic', default: true, available: true, price: null },
    { item_type: 'background', item_id: 'meadow', display_name: { en: 'Meadow', ru: 'Луг' }, asset_id: 'meadow', default: true, available: true, price: null },
  ],
};

async function reply(route: Route, status: number, body?: unknown) {
  await route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
}

/** Provide a deterministic account API for isolated browser suites; gameplay still uses the real client simulation. */
export async function installAccountBackend(target: RouteTarget, options: FixtureOptions = {}) {
  await target.addInitScript(() => {
    (window as typeof window & { Telegram?: { WebApp?: { initData: string; ready(): void } } }).Telegram = {
      WebApp: { initData: 'browser-fixture-init-data', ready() {} },
    };
  });
  let balances = { ...(options.balances ?? { FEATHER: 11, GAME_STAR: 7 }) };
  const settled = new Set<string>();
  let current: FixtureRun | undefined;
  let latest: FixtureRun | undefined;

  await target.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/v1/auth/refresh') return reply(route, 401, { detail: { code: 'account_session_expired' } });
    if (path === '/api/v1/auth/telegram') return reply(route, 200, { access_token: 'browser-fixture-token', token_type: 'Bearer', expires_in: 3600 });
    if (path === '/api/v1/auth/logout') return reply(route, 204);
    if (path === '/api/v1/account') return reply(route, 200, account);
    if (path === '/api/v1/runs/progress') return reply(route, 200, { bestScore: latest?.state.score ?? 0 });
    if (path === '/api/v1/runs/current/abandon' && method === 'POST' && current) {
      current.status = 'abandoned';
      latest = current;
      return reply(route, 200, snapshot(current));
    }
    if (path === '/api/v1/runs/current') {
      return current?.status === 'active' ? reply(route, 200, snapshot(current)) : reply(route, 404, { detail: { code: 'run_not_found' } });
    }
    if (path === '/api/v1/runs/latest') {
      return latest ? reply(route, 200, snapshot(latest)) : reply(route, 404, { detail: { code: 'run_not_found' } });
    }
    if (path === '/api/v1/runs' && method === 'POST') {
      const id = randomUUID();
      const state = createRun(createRunDescriptor({ runId: id, seed: 0 }));
      current = { id, state, checkpointSequence: -1, writerGeneration: 1, writerToken: `writer-${id}`, status: 'active', credited: { FEATHER: 0, GAME_STAR: 0 } };
      return reply(route, 201, snapshot(current));
    }
    if (path === '/api/v1/shop/catalog') return reply(route, 200, catalog);
    if (path === '/api/v1/shop/equipment') return reply(route, 200, { equipment: [
      { item_type: 'skin', item_id: 'classic', revision: 1 },
      { item_type: 'background', item_id: 'meadow', revision: 1 },
    ] });
    if (path === '/api/v1/shop/inventory') return reply(route, 200, { items: [
      { item_type: 'skin', item_id: 'classic' },
      { item_type: 'background', item_id: 'meadow' },
    ], next_cursor: null });
    if (path === '/api/v1/wallets') return reply(route, 200, { balances: [
      { currency: 'FEATHER', balance: String(balances.FEATHER) },
      { currency: 'GAME_STAR', balance: String(balances.GAME_STAR) },
    ] });

    const checkpoint = path.match(/^\/api\/v1\/runs\/([^/]+)\/checkpoints$/);
    const active = current;
    if (checkpoint && method === 'POST' && active && active.id === checkpoint[1]) {
      const input = request.postDataJSON() as { checkpointSequence: number; ticks: readonly (readonly { sequence: number; action: 'FLAP' }[])[] };
      for (const frames of input.ticks) active.state = step(active.state, frames).state;
      active.checkpointSequence = input.checkpointSequence;
      if (active.state.phase === 'DEAD') {
        active.status = 'completed';
        active.credited = { FEATHER: active.state.totals.FEATHER ?? 0, GAME_STAR: active.state.totals.GAME_STAR ?? 0 };
        if (!settled.has(active.id)) {
          balances = { FEATHER: balances.FEATHER + active.credited.FEATHER, GAME_STAR: balances.GAME_STAR + active.credited.GAME_STAR };
          settled.add(active.id);
        }
        latest = active;
      }
      return reply(route, 200, snapshot(active));
    }

    const run = path.match(/^\/api\/v1\/runs\/([^/]+)$/);
    if (run && method === 'GET' && current && current.id === run[1]) return reply(route, 200, snapshot(current));
    if (run && method === 'GET' && latest && latest.id === run[1]) return reply(route, 200, snapshot(latest));
    const completion = path.match(/^\/api\/v1\/completions\/([^/]+)\/0$/);
    const completed = latest;
    if (completion && completed && completed.id === completion[1] && completed.status === 'completed') {
      return reply(route, 200, { status: 'committed', reason: 'credited', credited: {
        FEATHER: String(completed.credited.FEATHER), GAME_STAR: String(completed.credited.GAME_STAR),
      } });
    }
    if (path.endsWith('/abandon') && method === 'POST' && current) {
      current.status = 'abandoned'; latest = current;
      return reply(route, 200, snapshot(current));
    }
    if (path.endsWith('/takeover') && method === 'POST' && current) {
      current.writerGeneration += 1; current.writerToken = `writer-${current.id}-${current.writerGeneration}`;
      return reply(route, 200, snapshot(current));
    }
    if (path.includes('/shop/')) return reply(route, 404, { detail: { code: 'fixture_route_not_supported' } });
    return reply(route, 404, { detail: { code: 'fixture_route_not_found', path, method } });
  });
}

/** Open the server-backed run, leaving the familiar ready screen available for input tests. */
export async function prepareAccountFlight(page: Page) {
  await expect(page.locator('.account-id')).toHaveText('100000001');
  await page.locator('.account-panel .primary-button').click();
  await expect(page.locator('.account-panel')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Привет/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Начать полёт/ })).toBeVisible();
}

function snapshot(run: FixtureRun) {
  const complete = run.status === 'completed';
  return {
    runId: run.id,
    accountId: account.account_id,
    lifeIndex: 0,
    seed: run.state.descriptor.seed,
    simulationVersion: run.state.descriptor.simulationVersion,
    generatorVersion: run.state.descriptor.generatorVersion,
    configId: run.state.descriptor.configId,
    state: run.state,
    status: complete ? 'completed' : run.status,
    verificationStatus: complete ? 'verified' : 'in_progress',
    deliveryStatus: complete ? 'delivered' : 'not_ready',
    checkpointSequence: run.checkpointSequence,
    writerGeneration: run.writerGeneration,
    activeTicks: run.state.tick,
    activeTickLimit: 216_000,
    submissionDeadline: '2099-01-01T00:00:00Z',
    ...(run.status === 'active' ? { writerToken: run.writerToken } : {}),
  };
}
