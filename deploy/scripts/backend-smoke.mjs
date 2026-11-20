import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRun, makeInput, step } from '../../packages/game-sim/dist/index.js';

const origin = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8080';

async function request(path, expectedStatus, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, origin), {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  assert.ok([expectedStatus].flat().includes(response.status), `${path}: HTTP ${response.status}`);
  return response.json();
}

function signIn(telegramUserId) {
  return request('/api/v1/auth/dev', 200, { body: { telegram_user_id: telegramUserId } });
}

function shortFlight(descriptor) {
  let state = createRun(descriptor);
  const ticks = [[makeInput(0, 'FLAP')]];
  state = step(state, ticks[0]).state;
  // One flap and then coast into the floor before the first obstacle.
  while (state.phase !== 'DEAD' && ticks.length < 120) {
    ticks.push([]);
    state = step(state, []).state;
  }
  assert.equal(state.phase, 'DEAD');
  return { ticks, state };
}

async function waitForSettlement(path, token) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const completion = await request(path, [200, 404], { token });
    if (completion.status === 'committed') return completion;
    assert.notEqual(completion.status, 'actionable_failure', 'completion settlement failed');
    assert.notEqual(completion.status, 'ineligible', 'completion was ineligible');
    await delay(200);
  }
  assert.fail('completion did not settle within 15 seconds');
}

const telegramUserId = randomInt(1, 2 ** 46);
const { access_token: token } = await signIn(telegramUserId);
const account = await request('/api/v1/account', 200, { token });
const run = await request('/api/v1/runs', 201, { token, body: {} });
const runPath = `/api/v1/runs/${run.runId}`;
const { access_token: otherToken } = await signIn(telegramUserId + 2 ** 46);
await request(runPath, 404, { token: otherToken });

const { ticks, state } = shortFlight(run);
const verified = await request(`${runPath}/checkpoints`, 200, {
  token,
  body: {
    checkpointSequence: 0,
    writerGeneration: run.writerGeneration,
    writerToken: run.writerToken,
    idempotencyKey: `smoke-${run.runId}`,
    ticks,
  },
});
assert.equal(verified.verificationStatus, 'verified');
assert.equal(verified.status, 'completed');
assert.equal(verified.state.tick, state.tick);
assert.deepEqual(verified.state.totals, state.totals);

const completion = await waitForSettlement(`/api/v1/completions/${run.runId}/0`, token);
assert.equal(completion.credited.FEATHER, '0');
assert.equal(completion.credited.GAME_STAR, '0');

const catalog = await request('/api/v1/shop/catalog', 200, { token });
assert.equal(catalog.enabled, true);
const equipment = await request('/api/v1/shop/equipment', 200, { token });
assert.ok(equipment.equipment.some(({ item_type, item_id }) => item_type === 'skin' && item_id === 'classic'));

const { access_token: restoredToken } = await signIn(telegramUserId);
const restored = await request('/api/v1/account', 200, { token: restoredToken });
assert.equal(restored.account_id, account.account_id);
console.log('Backend smoke passed: account isolation, deterministic replay, completion settlement and shop reads.');
