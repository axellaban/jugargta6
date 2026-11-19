import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type IntentStatus = 'approved' | 'pending' | 'rejected' | 'cancelled' | 'refunded';

export interface PaymentUpdate {
  intentId: string;
  status: IntentStatus;
  providerPaymentId?: string | null;
  amount?: number | null;
  currency?: string | null;
  reason?: string | null;
}

/**
 * Aplica el resultado de un pago a payment_intents y acredita si corresponde.
 * Idempotente: se puede llamar desde el webhook y desde la URL de retorno.
 */
export async function applyPaymentUpdate(admin: SupabaseClient, u: PaymentUpdate) {
  const { data: intent, error } = await admin
    .from('payment_intents')
    .select('id, status, amount, currency, fulfilled_at')
    .eq('id', u.intentId)
    .maybeSingle();
  if (error) throw error;
  if (!intent) return { ok: false, reason: 'intent_not_found' };

  // Nunca aceptar un pago aprobado por menos de lo que vale el producto.
  if (u.status === 'approved') {
    const mismatch =
      (u.currency && u.currency.toUpperCase() !== String(intent.currency).toUpperCase()) ||
      (typeof u.amount === 'number' && u.amount + 0.001 < Number(intent.amount));
    if (mismatch) {
      await admin
        .from('payment_intents')
        .update({ status: 'rejected', failure_reason: 'amount_mismatch', updated_at: new Date().toISOString() })
        .eq('id', u.intentId);
      return { ok: false, reason: 'amount_mismatch' };
    }
  }

  if (u.status === 'refunded') {
    await admin.rpc('refund_payment_intent', { p_intent_id: u.intentId });
    return { ok: true, status: 'refunded' };
  }

  // No retroceder un pago ya aprobado por notificaciones viejas.
  if (intent.status === 'approved' && u.status !== 'approved') return { ok: true, status: 'approved' };

  const patch: Record<string, unknown> = { status: u.status, updated_at: new Date().toISOString() };
  if (u.providerPaymentId) patch.provider_payment_id = u.providerPaymentId;
  if (u.reason) patch.failure_reason = u.reason;
  if (u.status === 'approved' && intent.status !== 'approved') patch.approved_at = new Date().toISOString();
  const { error: upErr } = await admin.from('payment_intents').update(patch).eq('id', u.intentId);
  if (upErr) throw upErr;

  if (u.status === 'approved' && !intent.fulfilled_at) {
    const { data, error: fErr } = await admin.rpc('fulfill_payment_intent', { p_intent_id: u.intentId });
    if (fErr) throw fErr;
    return { ok: true, status: 'approved', fulfillment: data };
  }
  return { ok: true, status: u.status };
}
