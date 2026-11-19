// Mercado Pago vía REST (sin SDK): preferencias de Checkout Pro, consulta de pagos y firma de webhooks.
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.mercadopago.com';

export interface MpPreferenceInput {
  accessToken: string;
  intentId: string;
  title: string;
  amount: number;
  currency: string;
  appUrl: string;
  payerEmail?: string;
}

export async function createPreference(input: MpPreferenceInput): Promise<{ id: string; url: string }> {
  const back = (status: string) =>
    `${input.appUrl}/api/checkout/return?provider=mercadopago&intent=${input.intentId}&status=${status}`;
  const body = {
    items: [
      {
        id: input.intentId,
        title: input.title,
        quantity: 1,
        unit_price: input.amount,
        currency_id: input.currency,
      },
    ],
    external_reference: input.intentId,
    metadata: { intent_id: input.intentId },
    back_urls: { success: back('success'), failure: back('failure'), pending: back('pending') },
    auto_return: 'approved',
    notification_url: `${input.appUrl}/api/webhooks/mercadopago`,
    ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
  };
  const res = await fetch(`${API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': input.intentId,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`mercadopago_preference_${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { id: string; init_point: string };
  return { id: json.id, url: json.init_point };
}

export interface MpPayment {
  id: number;
  status: 'pending' | 'approved' | 'authorized' | 'in_process' | 'in_mediation' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back';
  status_detail?: string;
  external_reference: string | null;
  transaction_amount: number;
  currency_id: string;
}

export async function getPayment(accessToken: string, paymentId: string): Promise<MpPayment> {
  const res = await fetch(`${API}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`mercadopago_payment_${res.status}`);
  return (await res.json()) as MpPayment;
}

/**
 * Verifica `x-signature` (ts=...,v1=...) según la documentación de webhooks de Mercado Pago:
 * manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};" firmado con HMAC-SHA256.
 */
export function verifyWebhookSignature(opts: {
  secret: string;
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const { secret, signatureHeader, requestId, dataId } = opts;
  if (!signatureHeader || !dataId) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const [k, ...rest] = kv.trim().split('=');
      return [k, rest.join('=')];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const tolerance = opts.toleranceSeconds ?? 600;
  const now = opts.nowSeconds ?? Date.now() / 1000;
  const tsSeconds = Number(ts) > 1e11 ? Number(ts) / 1000 : Number(ts);
  if (!Number.isFinite(tsSeconds) || Math.abs(now - tsSeconds) > tolerance) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mapPaymentStatus(s: MpPayment['status']): 'approved' | 'pending' | 'rejected' | 'cancelled' | 'refunded' {
  switch (s) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    case 'refunded':
    case 'charged_back':
      return 'refunded';
    default:
      return 'pending';
  }
}
