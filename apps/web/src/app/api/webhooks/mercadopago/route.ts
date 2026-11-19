import { type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { isUuid, json, readJson } from '@/lib/http';
import { getPayment, mapPaymentStatus, verifyWebhookSignature } from '@/lib/mercadopago';
import { applyPaymentUpdate } from '@/lib/payments';
import { getAdminSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const admin = getAdminSupabase();
  if (!admin || !env.mpAccessToken) return json({ error: 'not_configured' }, 503);

  const q = req.nextUrl.searchParams;
  const body = await readJson<{ type: string; topic: string; data: { id: string | number } }>(req);
  const type = body.type ?? q.get('type') ?? q.get('topic');
  const dataId = String(body.data?.id ?? q.get('data.id') ?? q.get('id') ?? '');

  if (env.mpWebhookSecret) {
    const ok = verifyWebhookSignature({
      secret: env.mpWebhookSecret,
      signatureHeader: req.headers.get('x-signature'),
      requestId: req.headers.get('x-request-id'),
      dataId: q.get('data.id') ?? dataId,
    });
    if (!ok) return json({ error: 'bad_signature' }, 401);
  }

  if (type !== 'payment' || !/^\d+$/.test(dataId)) return json({ ignored: true });

  try {
    // La fuente de verdad es la API de MP, no el cuerpo de la notificación.
    const p = await getPayment(env.mpAccessToken, dataId);
    if (!isUuid(p.external_reference)) return json({ ignored: true, reason: 'no_intent' });
    const r = await applyPaymentUpdate(admin, {
      intentId: p.external_reference,
      status: mapPaymentStatus(p.status),
      providerPaymentId: String(p.id),
      amount: p.transaction_amount,
      currency: p.currency_id,
      reason: p.status_detail ?? null,
    });
    return json(r);
  } catch (e) {
    console.error('mercadopago webhook', e);
    return json({ error: 'processing_failed' }, 500); // MP reintenta
  }
}
