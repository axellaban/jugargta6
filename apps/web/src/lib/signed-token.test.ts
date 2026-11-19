import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signToken, verifyToken, turnCredentials } from './signed-token.ts';
import { createHmac } from 'node:crypto';

const SECRET = 'k'.repeat(40);

test('firma y verifica', () => {
  const now = Math.floor(Date.now() / 1000);
  const tok = signToken({ sub: 'u1', turn: 3, aud: 'bridge', iat: now, exp: now + 60 }, SECRET);
  assert.equal(verifyToken(tok, SECRET, 'bridge')?.turn, 3);
  assert.equal(verifyToken(tok, SECRET, 'stream'), null, 'audiencia distinta');
  assert.equal(verifyToken(tok, 'x'.repeat(40), 'bridge'), null, 'otro secreto');
  assert.equal(verifyToken(tok.slice(0, -2) + 'AA', SECRET, 'bridge'), null, 'firma alterada');
  assert.equal(verifyToken(tok, SECRET, 'bridge', now + 3600), null, 'vencido');
});

test('rechaza secretos cortos', () => {
  assert.throws(() => signToken({ sub: 'u', turn: 1, aud: 'bridge', iat: 0, exp: 1 }, 'corto'));
});

test('vectores compartidos con el bridge (Python)', () => {
  const data = JSON.parse(readFileSync(new URL('../../../../packages/protocol/test-vectors.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(data.tokens) && data.tokens.length > 0);
  for (const v of data.tokens) {
    assert.equal(signToken(v.payload, v.secret), v.token);
    assert.deepEqual(verifyToken(v.token, v.secret, v.payload.aud, v.payload.iat), v.payload);
  }
});

test('credenciales TURN con el formato de coturn', () => {
  const { username, credential } = turnCredentials('user-1', 'turn-secret');
  assert.match(username, /^\d+:user-1$/);
  assert.equal(credential, createHmac('sha1', 'turn-secret').update(username).digest('base64'));
});
