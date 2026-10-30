import { createPublicKey, verify } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64url = /^[A-Za-z0-9_-]+$/;

/** Verify the platform-issued Core token; do not accept unverified browser identity. */
export function verifyAccessToken(token: string, keys: Readonly<Record<string, string>>, now = Math.floor(Date.now() / 1000)): string {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part, index) => !part || part.length > [4096, 8192, 256][index]! || !base64url.test(part))) throw new Error('invalid token');
  const decode = (value: string): Buffer => {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('invalid encoding');
    return decoded;
  };
  const header = JSON.parse(decode(parts[0]!).toString('utf8')) as unknown;
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('invalid header');
  const { alg, kid } = header as Record<string, unknown>;
  if (alg !== 'EdDSA' || typeof kid !== 'string' || !Object.hasOwn(keys, kid)) throw new Error('invalid header');
  const key = decode(keys[kid]!);
  const signature = decode(parts[2]!);
  if (key.length !== 32 || signature.length !== 64) throw new Error('invalid signature');
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, signature)) throw new Error('invalid signature');
  const payload = JSON.parse(decode(parts[1]!).toString('utf8')) as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid claims');
  const claims = payload as Record<string, unknown>;
  if (Object.keys(claims).sort().join(',') !== 'aud,exp,iat,iss,jti,scope,sub' || claims.iss !== 'doofy-platform' || claims.aud !== 'doofy-core' ||
      typeof claims.sub !== 'string' || !uuid.test(claims.sub) || typeof claims.jti !== 'string' || !uuid.test(claims.jti) ||
      !Array.isArray(claims.scope) || claims.scope.length !== 1 || claims.scope[0] !== 'run:write' ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) throw new Error('invalid claims');
  const iat = claims.iat as number;
  const exp = claims.exp as number;
  if (exp <= now || iat > now + 30 || exp <= iat || exp - iat > 600) throw new Error('invalid lifetime');
  return claims.sub.toLowerCase();
}
