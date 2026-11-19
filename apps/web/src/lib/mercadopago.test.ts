import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature, mapPaymentStatus } from './mercadopago.ts';

test('firma de webhook de Mercado Pago', () => {
  const secret = 'mp-secret';
  const ts = '1790000000';
  const manifest = `id:123456;request-id:req-1;ts:${ts};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  const base = { secret, requestId: 'req-1', dataId: '123456', nowSeconds: 1790000100 };
  assert.equal(verifyWebhookSignature({ ...base, signatureHeader: `ts=${ts},v1=${v1}` }), true);
  assert.equal(verifyWebhookSignature({ ...base, signatureHeader: `ts=${ts},v1=${'0'.repeat(64)}` }), false);
  assert.equal(verifyWebhookSignature({ ...base, dataId: '999', signatureHeader: `ts=${ts},v1=${v1}` }), false);
  assert.equal(verifyWebhookSignature({ ...base, nowSeconds: 1790009999, signatureHeader: `ts=${ts},v1=${v1}` }), false, 'replay viejo');
  assert.equal(verifyWebhookSignature({ ...base, signatureHeader: null }), false);
});

test('estados de pago', () => {
  assert.equal(mapPaymentStatus('approved'), 'approved');
  assert.equal(mapPaymentStatus('in_process'), 'pending');
  assert.equal(mapPaymentStatus('charged_back'), 'refunded');
});
