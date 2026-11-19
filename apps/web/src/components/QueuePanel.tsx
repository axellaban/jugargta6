'use client';

import { Clock, Crown, Gamepad2, ListOrdered, LogOut, Plus, Rocket, Sparkles, Timer, Zap } from 'lucide-react';
import { approxMinutes, mmss } from '@/lib/format';
import type { ProductCode } from '@/lib/products';
import { useNow } from '@/hooks/useNow';
import { useLiveRoom } from './LiveRoom';
import { Avatar, Badge, Button, Panel } from './ui';

export function QueueActions({ onJoin, onBuy }: { onJoin: () => void; onBuy: (code: ProductCode) => void }) {
  const { me, busy, leave, settings, snapshot, serverNow, mode, track } = useLiveRoom();
  const now = useNow(serverNow, 500);
  const entry = me?.entry;
  const turnMin = Math.round(settings.turn_seconds / 60);

  let main: React.ReactNode;
  if (!entry) {
    main = (
      <Button variant="brand" size="lg" className="w-full glow" onClick={onJoin} disabled={busy || !settings.queue_open}>
        <Gamepad2 className="size-5" /> {settings.queue_open ? 'Entrar a la fila gratis' : 'Fila cerrada'}
      </Button>
    );
  } else if (entry.status === 'waiting') {
    const curRemaining = snapshot.current?.ends_at ? Math.max(0, Date.parse(snapshot.current.ends_at) - now) : snapshot.current ? settings.confirm_seconds * 1000 : 0;
    const eta = curRemaining + Math.max(0, (me?.position ?? 1) - 1) * settings.turn_seconds * 1000;
    main = (
      <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 p-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand text-lg font-black tabular">#{me?.position ?? '…'}</div>
        <div className="min-w-0 flex-1">
          <div className="font-bold">Estás en la fila</div>
          <div className="flex items-center gap-1 text-sm text-muted">
            <Clock className="size-3.5" /> Tu turno en {approxMinutes(eta)} · no cierres esta pestaña
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { track('leave_click'); void leave(); }} disabled={busy} title="Salir de la fila">
          <LogOut className="size-4" />
        </Button>
      </div>
    );
  } else if (entry.status === 'playing') {
    const left = entry.ends_at ? Date.parse(entry.ends_at) - now : 0;
    main = (
      <div className="flex items-center gap-3 rounded-xl border border-ok/40 bg-ok/10 p-3">
        <Timer className="size-6 shrink-0 text-ok" />
        <div className="flex-1">
          <div className="font-bold">{mode === 'REAL' ? '¡Estás jugando!' : 'Tu turno de práctica'}</div>
          <div className="tabular text-sm text-muted">Quedan {mmss(left)}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void leave()} disabled={busy}>
          Terminar
        </Button>
      </div>
    );
  } else {
    main = (
      <div className="rounded-xl border border-vip/40 bg-vip/10 p-3 text-center font-bold text-vip">¡Es tu turno! Confirmá en la ventana.</div>
    );
  }

  return (
    <div className="space-y-3">
      {main}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="vip" className="whitespace-nowrap px-2" onClick={() => { track('vip_click', { product: 'skip_queue' }); onBuy('skip_queue'); }}>
          <Rocket className="size-4" /> {mode === 'REAL' ? 'Saltar la fila' : 'Pase Fundador'}
        </Button>
        <Button variant="outline" className="whitespace-nowrap px-2" onClick={() => { track('extend_click', { product: 'extend_10' }); onBuy('extend_10'); }}>
          <Plus className="size-4" /> Sumar +10 min
        </Button>
      </div>
      <p className="text-center text-xs text-faint">
        Turnos de {turnMin} min{settings.extension_seconds > 0 ? ` · +${Math.round(settings.extension_seconds / 60)} min si la fila está vacía` : ''} · {settings.confirm_seconds} s para confirmar
      </p>
    </div>
  );
}

export function QueueList() {
  const { snapshot, isMine, serverNow, mode } = useLiveRoom();
  const now = useNow(serverNow, 500);
  const cur = snapshot.current;
  const rest = Math.max(0, snapshot.waiting_count - snapshot.next.length);

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <ListOrdered className="size-4 text-accent" /> Fila
        </h3>
        <span className="text-xs text-muted tabular">{snapshot.waiting_count} esperando</span>
      </div>

      {cur ? (
        <div className="flex items-center gap-3 border-b border-border bg-panel-2 px-4 py-3">
          <Avatar name={cur.display_name} url={cur.avatar_url} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{cur.display_name}</span>
              {isMine(cur.user_id) && <Badge tone="accent">vos</Badge>}
              {cur.is_vip && <Crown className="size-3.5 text-vip" />}
            </div>
            <div className="text-xs text-muted">
              {cur.status === 'offered' ? 'Confirmando turno…' : mode === 'REAL' ? 'Jugando ahora' : 'Turno de práctica'}
            </div>
          </div>
          {cur.status === 'playing' && cur.ends_at && (
            <span className="tabular rounded-lg bg-ok/15 px-2 py-1 text-xs font-bold text-ok">{mmss(Date.parse(cur.ends_at) - now)}</span>
          )}
          {cur.status === 'offered' && cur.offer_expires_at && (
            <span className="tabular rounded-lg bg-vip/15 px-2 py-1 text-xs font-bold text-vip">{mmss(Date.parse(cur.offer_expires_at) - now)}</span>
          )}
        </div>
      ) : (
        <div className="border-b border-border px-4 py-3 text-sm text-muted">Nadie jugando. ¡Entrá y el turno es tuyo!</div>
      )}

      <ol className="max-h-[340px] divide-y divide-border/60 overflow-y-auto scrollbar-thin">
        {snapshot.next.map((p, i) => (
          <li key={p.entry_id} className={`flex items-center gap-3 px-4 py-2 ${isMine(p.user_id) ? 'bg-accent/10' : ''}`}>
            <span className="w-6 text-right text-xs font-bold text-faint tabular">{i + 1}</span>
            <Avatar name={p.display_name} url={p.avatar_url} size={24} />
            <span className="min-w-0 flex-1 truncate text-sm">{p.display_name}</span>
            {isMine(p.user_id) && <Badge tone="accent">vos</Badge>}
            {p.skipped && (
              <Badge tone="vip">
                <Zap className="size-3" /> vip
              </Badge>
            )}
            {p.is_founder && !p.skipped && (
              <Badge tone="founder">
                <Sparkles className="size-3" />
              </Badge>
            )}
          </li>
        ))}
        {snapshot.next.length === 0 && <li className="px-4 py-6 text-center text-sm text-faint">La fila está vacía</li>}
      </ol>
      {rest > 0 && <div className="border-t border-border px-4 py-2 text-center text-xs text-muted">y {rest} más…</div>}
    </Panel>
  );
}
