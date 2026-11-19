'use client';

import { Gamepad2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { mmss } from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import { useLiveRoom } from './LiveRoom';
import { Button, Modal } from './ui';

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175, 1568].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
    window.setTimeout(() => void ctx.close(), 1200);
  } catch {
    // sin audio (política de autoplay): queda el título parpadeando
  }
}

/** "¡ES TU TURNO!" con countdown. Aparece cuando mi entrada pasa a 'offered'. */
export function TurnModal() {
  const { me, confirm, leave, busy, serverNow, settings, mode, track } = useLiveRoom();
  const entry = me?.entry;
  const open = entry?.status === 'offered';
  const now = useNow(serverNow, 200, open);
  const expires = entry?.offer_expires_at ? Date.parse(entry.offer_expires_at) : 0;
  const left = Math.max(0, expires - now);
  const total = settings.confirm_seconds * 1000;
  const notifiedRef = useRef<number | null>(null);

  const entryId = entry?.id;
  useEffect(() => {
    if (!open || !entryId) return;
    if (notifiedRef.current !== entryId) {
      notifiedRef.current = entryId;
      chime();
      navigator.vibrate?.([200, 100, 200]);
      track('turn_offered');
    }
    const original = document.title;
    let on = false;
    const id = window.setInterval(() => {
      on = !on;
      document.title = on ? '🔴 ¡ES TU TURNO!' : original;
    }, 700);
    return () => {
      window.clearInterval(id);
      document.title = original;
    };
  }, [open, entryId, track]);

  useEffect(() => {
    if (open && left === 0 && expires > 0) track('turn_timeout');
  }, [open, left, expires, track]);

  const pct = total ? Math.min(100, (left / total) * 100) : 0;

  return (
    <Modal open={open} onClose={() => undefined} dismissable={false} width="max-w-md">
      <div className="text-center">
        <div className="relative mx-auto mb-4 grid size-28 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
            <circle cx="50" cy="50" r="44" fill="none" stroke="var(--color-panel-3)" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="url(#turnGrad)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 276.5} 276.5`}
            />
            <defs>
              <linearGradient id="turnGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ff3d8b" />
                <stop offset="1" stopColor="#ff9f43" />
              </linearGradient>
            </defs>
          </svg>
          <span className="tabular text-3xl font-black">{Math.ceil(left / 1000)}</span>
        </div>
        <h2 className="text-brand text-3xl font-black">¡ES TU TURNO!</h2>
        <p className="mt-2 text-muted">
          Confirmá en {mmss(left)} o el turno pasa al siguiente.
          {mode === 'SIMULATED' && ' (Turno de práctica: la consola todavía no está conectada.)'}
        </p>
        <Button variant="brand" size="lg" className="mt-6 w-full glow" disabled={busy || left === 0} onClick={() => void confirm()}>
          <Gamepad2 className="size-5" /> Tomar el control
        </Button>
        <button className="mt-3 text-sm text-faint hover:text-muted" onClick={() => void leave()} disabled={busy}>
          Pasar mi turno
        </button>
      </div>
    </Modal>
  );
}
