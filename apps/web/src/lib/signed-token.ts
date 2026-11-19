// Tokens HMAC-SHA256 compactos, compartidos con bridge/jugar_bridge/tokens.py.
// Formato: base64url(json) "." base64url(hmac_sha256(secret, base64url(json)))
import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenAudience = 'bridge' | 'bridge-admin' | 'stream';

export interface TokenPayload {
  sub: string;
  turn: number;
  aud: TokenAudience;
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

export function signToken(payload: TokenPayload, secret: string): string {
  if (!secret || secret.length < 32) throw new Error('secret_too_short');
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string, secret: string, audience: TokenAudience, nowSeconds = Date.now() / 1000): TokenPayload | null {
  if (!secret || secret.length < 32 || typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac('sha256', secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (payload.aud !== audience) return null;
    if (typeof payload.exp !== 'number' || payload.exp + 5 < nowSeconds) return null;
    if (typeof payload.sub !== 'string' || typeof payload.turn !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Credenciales efímeras de coturn (TURN REST API, use-auth-secret). */
export function turnCredentials(userId: string, secret: string, ttlSeconds = 3600) {
  const username = `${Math.floor(Date.now() / 1000) + ttlSeconds}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}
