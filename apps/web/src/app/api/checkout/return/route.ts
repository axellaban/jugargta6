import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { isUuid } from '@/lib/http';
import { getPayment, mapPaymentStatus } from '@/lib/mercadopago';
import { applyPaymentUpdate } from '@/lib/payments';
import { fromMinorUnits, getStripe } from '@/lib/stripe';
import { getAdminSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Vuelta desde Mercado Pago / Stripe. Además de redirigir, consulta el pago al proveedor
 * (por si el webhook todavía no llegó, o en local donde no hay webhooks).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const provider = q.get('provider');
  const intentId = q.get('intent');
  let result: 'approved' | 'pending' | 'failure' | 'cancel' = q.get('status') === 'cancel' ? 'cancel' : 'pending';
  const admin = getAdminSupabase();

  try {
    if (admin && isUuid(intentId)) {
      if (provider === 'mercadopago' && env.mpAccessToken) {
        const paymentId = q.get('payment_id') ?? q.get('collection_id');
        if (paymentId && /^\d+$/.test(paymentId)) {
          const p = await getPayment(env.mpAccessToken, paymentId);
          if (p.external_reference === intentId) {
            const status = mapPaymentStatus(p.status);
            await applyPaymentUpdate(admin, {
              intentId,
              status,
              providerPaymentId: String(p.id),
              amount: p.transaction_amount,
              currency: p.currency_id,
            });
            result = status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : 'failure';
          }
        } else if (q.get('status') === 'failure') {
          result = 'failure';
        }
      }
      if (provider === 'stripe') {
        const stripe = getStripe();
        const sessionId = q.get('session_id');
        if (stripe && sessionId) {
          const s = await stripe.checkout.sessions.retrieve(sessionId);
          if (s.client_reference_id === intentId && s.payment_status === 'paid') {
            await applyPaymentUpdate(admin, {
              intentId,
              status: 'approved',
              providerPaymentId: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null),
              amount: s.amount_total != null ? fromMinorUnits(s.amount_total, s.currency ?? 'usd') : null,
              currency: s.currency?.toUpperCase() ?? null,
            });
            result = 'approved';
          }
        }
        if (result === 'cancel') {
          await admin
            .from('payment_intents')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', intentId)
            .in('status', ['clicked', 'checkout_created']);
        }
      }
    }
  } catch (e) {
    console.error('checkout return', e);
  }

  const to = new URL('/', env.appUrl.startsWith('http') ? env.appUrl : req.nextUrl.origin);
  to.searchParams.set('checkout', result);
  return NextResponse.redirect(to, 303);
}
