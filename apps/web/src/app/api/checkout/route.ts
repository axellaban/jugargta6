import { env, currencyFor, effectiveStreamMode } from '@/lib/env';
import { json, readJson, requireUser } from '@/lib/http';
import { createPreference } from '@/lib/mercadopago';
import { isProductCode, productView } from '@/lib/products';
import { getStripe, toMinorUnits } from '@/lib/stripe';
import { getAdminSupabase, loadSettings } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Crea un payment_intent (registro del clic) y, según el proveedor, el checkout real. */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const admin = getAdminSupabase();
  if (!admin) return json({ error: 'not_configured', detail: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, 503);

  const body = await readJson<{ product_code: string; visitor_id: string }>(req);
  if (!isProductCode(body.product_code)) return json({ error: 'invalid_product' }, 400);
  const visitorId = typeof body.visitor_id === 'string' ? body.visitor_id.slice(0, 64) : null;

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from('payment_intents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since);
  if ((count ?? 0) >= 10) return json({ error: 'rate_limited' }, 429);

  const settings = await loadSettings(admin);
  const mode = effectiveStreamMode(settings);
  const provider = env.checkoutProvider;
  const currency = currencyFor(provider);
  const view = productView(body.product_code, mode, currency, env.productPricesJson);
  if (view.price == null) return json({ error: 'price_not_configured', detail: `Sin precio en ${currency}` }, 500);

  const { data: intent, error } = await admin
    .from('payment_intents')
    .insert({
      user_id: user.id,
      visitor_id: visitorId,
      product_code: view.code,
      provider,
      mode,
      amount: view.price,
      currency,
      status: 'clicked',
      metadata: { title: view.title, guest: Boolean(user.is_anonymous) },
    })
    .select('id')
    .single();
  if (error || !intent) return json({ error: 'db_error', detail: error?.message }, 500);

  const fail = async (reason: string, status = 502) => {
    await admin.from('payment_intents').update({ status: 'rejected', failure_reason: reason.slice(0, 300) }).eq('id', intent.id);
    return json({ error: 'checkout_failed', detail: reason }, status);
  };

  if (provider === 'mock') {
    return json({ intentId: intent.id, provider, mode, product: view });
  }

  if (provider === 'mercadopago') {
    if (!env.mpAccessToken) return fail('not_configured: MERCADOPAGO_ACCESS_TOKEN', 503);
    try {
      const pref = await createPreference({
        accessToken: env.mpAccessToken,
        intentId: intent.id,
        title: view.title,
        amount: view.price,
        currency,
        appUrl: env.appUrl,
        payerEmail: user.is_anonymous ? undefined : (user.email ?? undefined),
      });
      await admin
        .from('payment_intents')
        .update({ status: 'checkout_created', provider_ref: pref.id, checkout_url: pref.url, updated_at: new Date().toISOString() })
        .eq('id', intent.id);
      return json({ intentId: intent.id, provider, mode, url: pref.url });
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'mercadopago_error');
    }
  }

  const stripe = getStripe();
  if (!stripe) return fail('not_configured: STRIPE_SECRET_KEY', 503);
  try {
    const back = `${env.appUrl}/api/checkout/return?provider=stripe&intent=${intent.id}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: intent.id,
      metadata: { intent_id: intent.id },
      payment_intent_data: { metadata: { intent_id: intent.id } },
      customer_email: user.is_anonymous ? undefined : (user.email ?? undefined),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: toMinorUnits(view.price, currency),
            product_data: { name: view.title, description: view.description },
          },
        },
      ],
      success_url: `${back}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}&status=cancel`,
    });
    await admin
      .from('payment_intents')
      .update({ status: 'checkout_created', provider_ref: session.id, checkout_url: session.url, updated_at: new Date().toISOString() })
      .eq('id', intent.id);
    return json({ intentId: intent.id, provider, mode, url: session.url });
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'stripe_error');
  }
}
