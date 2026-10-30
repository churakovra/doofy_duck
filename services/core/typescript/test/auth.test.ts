import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAccessToken } from '../src/auth.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
const account = 'f1251566-65c7-4273-988f-30c3303e3640';
const valid = { iss: 'doofy-platform', aud: 'doofy-core', sub: account, jti: account, iat: 1000, exp: 1600, scope: ['run:write'] };
function token(claims: object, header = { alg: 'EdDSA', kid: 'key' }): string {
  const input = [header, claims].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}
describe('Core access tokens', () => {
  it('accepts a valid signed account token', () => expect(verifyAccessToken(token(valid), { key }, 1000)).toBe(account));
  it('rejects invalid signatures, audience, scope, lifetime and extra claims', () => {
    expect(() => verifyAccessToken(token(valid), { key: Buffer.alloc(32).toString('base64url') }, 1000)).toThrow();
    for (const claims of [{ ...valid, aud: 'other' }, { ...valid, scope: ['admin'] }, { ...valid, exp: 1601 }, { ...valid, admin: true }]) {
      expect(() => verifyAccessToken(token(claims), { key }, 1000)).toThrow();
    }
    expect(() => verifyAccessToken(token(valid), { key }, 1600)).toThrow();
    expect(() => verifyAccessToken(token(valid, { alg: 'none', kid: 'key' }), { key }, 1000)).toThrow();
  });
});
