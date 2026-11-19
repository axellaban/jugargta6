import type Stripe from 'stripe';
import { env } from '@/lib/env';
import { isUuid, json } from '@/lib/http';
import { applyPaymentUpdate, type IntentStatus } from '@/lib/payments';
import { fromMinorUnits, getStripe } from '@/lib/stripe';
import { getAdminSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const stripe = getStripe();
  const admin = getAdminSupabase();
  if (!stripe || !admin || !env.stripeWebhookSecret) return json({ error: 'not_configured' }, 503);

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, req.headers.get('stripe-signature') ?? '', env.stripeWebhookSecret);
  } catch {
    return json({ error: 'bad_signature' }, 400);
  }

  try {
    if (event.type.startsWith('checkout.session.')) {
      const s = event.data.object as Stripe.Checkout.Session;
      const intentId = s.client_reference_id ?? s.metadata?.intent_id;
      if (!isUuid(intentId)) return json({ ignored: true });
      let status: IntentStatus | null = null;
      if (event.type === 'checkout.session.completed') status = s.payment_status === 'paid' ? 'approved' : 'pending';
      if (event.type === 'checkout.session.async_payment_succeeded') status = 'approved';
      if (event.type === 'checkout.session.async_payment_failed') status = 'rejected';
      if (event.type === 'checkout.session.expired') status = 'cancelled';
      if (!status) return json({ ignored: true });
      const r = await applyPaymentUpdate(admin, {
        intentId,
        status,
        providerPaymentId: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null),
        amount: s.amount_total != null ? fromMinorUnits(s.amount_total, s.currency ?? 'usd') : null,
        currency: s.currency?.toUpperCase() ?? null,
      });
      return json(r);
    }
    if (event.type === 'charge.refunded') {
      const c = event.data.object as Stripe.Charge;
      const pi = typeof c.payment_intent === 'string' ? c.payment_intent : c.payment_intent?.id;
      if (!pi) return json({ ignored: true });
      const { data: intent } = await admin
        .from('payment_intents')
        .select('id')
        .eq('provider', 'stripe')
        .eq('provider_payment_id', pi)
        .maybeSingle();
      if (!intent) return json({ ignored: true });
      return json(await applyPaymentUpdate(admin, { intentId: intent.id, status: 'refunded' }));
    }
    return json({ ignored: true });
  } catch (e) {
    console.error('stripe webhook', e);
    return json({ error: 'processing_failed' }, 500);
  }
}
