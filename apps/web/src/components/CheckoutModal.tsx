'use client';

import { Check, CreditCard, Lock, Rocket, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { FOUNDER_TERMS, formatMoney, type ProductCode, type ProductView } from '@/lib/products';
import type { StreamMode } from '@/lib/types';
import { useLiveRoom } from './LiveRoom';
import { useToast } from './Toasts';
import { Badge, Button, Modal } from './ui';

type Step = 'plans' | 'redirecting' | 'mock' | 'thanks';

export function CheckoutModal({
  open,
  onClose,
  initial,
  products,
  onNeedLogin,
}: {
  open: boolean;
  onClose: () => void;
  initial: ProductCode | null;
  products: Record<StreamMode, ProductView[]>;
  onNeedLogin: () => void;
}) {
  const { mode, user, config, track, visitorId, refreshMe } = useLiveRoom();
  const toast = useToast();
  const list = products[mode];
  const [selected, setSelected] = useState<ProductCode>(initial ?? 'vip_turn');
  const [step, setStep] = useState<Step>('plans');
  const [accepted, setAccepted] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const founder = mode === 'SIMULATED';

  useEffect(() => {
    if (!open) return;
    setSelected(initial ?? 'vip_turn');
    setStep('plans');
    setAccepted(false);
    setIntentId(null);
    track('checkout_open', { product: initial, mode });
  }, [open, initial, mode, track]);

  const product = list.find((p) => p.code === selected) ?? list[0];
  const needsTerms = founder && config.checkoutProvider !== 'mock';

  async function pay() {
    if (!user) {
      onClose();
      onNeedLogin();
      return;
    }
    setLoading(true);
    track('checkout_start', { product: selected, provider: config.checkoutProvider, mode });
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_code: selected, visitor_id: visitorId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'checkout_failed');
      setIntentId(body.intentId);
      if (body.provider === 'mock') {
        setStep('mock');
      } else if (body.url) {
        setStep('redirecting');
        window.location.href = body.url;
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function update(action: 'mock_confirm' | 'cancel') {
    if (!intentId) return;
    setLoading(true);
    await fetch('/api/checkout/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intentId, action }),
    }).catch(() => undefined);
    setLoading(false);
    if (action === 'mock_confirm') {
      track('mock_confirm', { product: selected });
      setStep('thanks');
      void refreshMe();
    } else {
      track('checkout_cancel', { product: selected });
      onClose();
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (step === 'mock') void update('cancel');
        else onClose();
      }}
      title={founder ? 'Pase Fundador' : 'Pases VIP'}
      width="max-w-xl"
    >
      {step === 'plans' && (
        <div className="space-y-4">
          {founder && (
            <div className="flex gap-3 rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-info" />
              <p>
                <b>Estamos en beta.</b> {FOUNDER_TERMS}
              </p>
            </div>
          )}
          <div className="grid gap-2">
            {list.map((p) => (
              <button
                key={p.code}
                onClick={() => setSelected(p.code)}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${
                  selected === p.code ? 'border-accent bg-accent/10' : 'border-border bg-panel-2 hover:border-accent/50'
                }`}
              >
                <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${selected === p.code ? 'border-accent bg-accent' : 'border-border'}`}>
                  {selected === p.code && <Check className="size-4 text-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-bold">
                    {p.title} {p.highlight && <Badge tone="vip">popular</Badge>}
                  </span>
                  <span className="block text-sm text-muted">{p.description}</span>
                </span>
                <span className="tabular text-lg font-black">{p.price != null ? formatMoney(p.price, p.currency) : '—'}</span>
              </button>
            ))}
          </div>

          {needsTerms && (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-muted">
              <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              Entiendo que es una reserva: se acredita cuando la consola esté online y puedo pedir el reembolso antes de usarla.
            </label>
          )}

          <Button variant="brand" size="lg" className="w-full" disabled={loading || !product?.price || (needsTerms && !accepted)} onClick={() => void pay()}>
            {founder ? <Rocket className="size-5" /> : <CreditCard className="size-5" />}
            {user ? `${founder ? 'Reservar' : 'Pagar'} ${product?.price != null ? formatMoney(product.price, product.currency) : ''}` : 'Entrá para continuar'}
          </Button>
          <p className="flex items-center justify-center gap-1 text-xs text-faint">
            <Lock className="size-3" />
            {config.checkoutProvider === 'mercadopago'
              ? 'Pago seguro con Mercado Pago'
              : config.checkoutProvider === 'stripe'
                ? 'Pago seguro con Stripe'
                : 'Sin cobro: modo de validación'}
          </p>
        </div>
      )}

      {step === 'redirecting' && <p className="py-8 text-center text-muted">Te llevamos al checkout…</p>}

      {step === 'mock' && (
        <div className="space-y-4 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand">
            <Sparkles className="size-7 text-white" />
          </div>
          <h3 className="text-xl font-black">¡Gracias por querer sumarte!</h3>
          <p className="text-muted">
            Todavía <b className="text-text">no estamos cobrando</b>: estamos midiendo cuánta gente quiere {product?.title.toLowerCase()} antes de
            encender la consola. No se te cobró nada.
          </p>
          <p className="text-muted">¿Te anotamos en la lista de fundadores para avisarte primero cuando lancemos?</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="brand" className="flex-1" disabled={loading} onClick={() => void update('mock_confirm')}>
              Sí, anotame
            </Button>
            <Button variant="ghost" className="flex-1" disabled={loading} onClick={() => void update('cancel')}>
              No, gracias
            </Button>
          </div>
        </div>
      )}

      {step === 'thanks' && (
        <div className="space-y-4 py-4 text-center">
          <Check className="mx-auto size-12 text-ok" />
          <h3 className="text-xl font-black">¡Listo, estás en la lista!</h3>
          <p className="text-muted">Te avisamos apenas la consola esté online. Mientras tanto, la fila de práctica es gratis.</p>
          <Button variant="outline" onClick={onClose}>
            Volver
          </Button>
        </div>
      )}
    </Modal>
  );
}
