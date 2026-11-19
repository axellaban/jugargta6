import { isUuid, json, readJson, requireUser } from '@/lib/http';
import { getAdminSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Acciones del usuario sobre su propio intent:
 *  - mock_confirm: en CHECKOUT_PROVIDER=mock, acepta anotarse como fundador (no se cobra nada).
 *  - cancel: cerró el checkout sin pagar.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const admin = getAdminSupabase();
  if (!admin) return json({ error: 'not_configured' }, 503);

  const body = await readJson<{ intentId: string; action: string }>(req);
  if (!isUuid(body.intentId)) return json({ error: 'invalid_intent' }, 400);

  const { data: intent } = await admin
    .from('payment_intents')
    .select('id, user_id, provider, status')
    .eq('id', body.intentId)
    .maybeSingle();
  if (!intent || intent.user_id !== auth.user.id) return json({ error: 'not_found' }, 404);

  if (body.action === 'mock_confirm') {
    if (intent.provider !== 'mock' || intent.status !== 'clicked') return json({ error: 'invalid_state' }, 409);
    await admin.from('payment_intents').update({ status: 'mock_completed', updated_at: new Date().toISOString() }).eq('id', intent.id);
    return json({ ok: true, status: 'mock_completed' });
  }
  if (body.action === 'cancel') {
    if (!['clicked', 'checkout_created'].includes(intent.status)) return json({ ok: true, status: intent.status });
    await admin.from('payment_intents').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', intent.id);
    return json({ ok: true, status: 'cancelled' });
  }
  return json({ error: 'invalid_action' }, 400);
}
