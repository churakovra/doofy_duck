import { expect, it } from 'vitest';
import { checkpointHash } from '../src/checkpoint-hash.js';

it('matches Go encoding/json and SHA-256 for persisted checkpoint evidence', () => {
  expect(checkpointHash({ checkpointSequence: 0, writerGeneration: 1, writerToken: 'token<&', idempotencyKey: 'hello-key', ticks: [[{ sequence: 0, action: 'FLAP' }], []] }).toString('hex'))
    .toBe('194f9ba61ece48fa32da65c87459574f3829c677dc78883bd780b0f7bf4d765a');
});
