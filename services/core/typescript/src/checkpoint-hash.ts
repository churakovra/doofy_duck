import { createHash } from 'node:crypto';
import type { InputFrame } from '@doofy-duck/game-sim';

export interface CheckpointRequest {
  checkpointSequence: number;
  writerGeneration: number;
  writerToken: string;
  idempotencyKey: string;
  ticks: readonly (readonly InputFrame[])[];
}

/** Match Go encoding/json's struct field order and HTML-safe string encoding. */
export function checkpointHash(request: CheckpointRequest): Buffer {
  const value = {
    checkpointSequence: request.checkpointSequence,
    writerGeneration: request.writerGeneration,
    writerToken: request.writerToken,
    idempotencyKey: request.idempotencyKey,
    ticks: request.ticks.map(tick => tick.map(input => ({ sequence: input.sequence, action: input.action }))),
  };
  const encoded = JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return createHash('sha256').update(encoded).digest();
}
