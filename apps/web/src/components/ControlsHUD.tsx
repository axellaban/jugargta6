'use client';

import { FILTER_PROFILES, pressedButtons, BUTTON_LABELS, type GamepadState } from '@jugargta/protocol';
import { Gamepad2, Info, Timer, Wifi } from 'lucide-react';
import { mmss } from '@/lib/format';
import type { ControllerInfo } from '@/hooks/useControllerInput';
import type { RealSession } from '@/hooks/useRealSession';
import { GamepadVisual } from './GamepadVisual';
import { TouchControls } from './TouchControls';
import { Badge } from './ui';

const STATUS: Record<string, string> = {
  idle: '—',
  connecting: 'conectando…',
  ready: 'conectado',
  reconnecting: 'reconectando…',
  error: 'error',
  kicked: 'desconectado',
};

export function ControlsHUD({
  mode,
  state,
  gamepad,
  remainingMs,
  touch,
  onTouch,
  real,
  profile,
}: {
  mode: 'SIMULATED' | 'REAL';
  state: GamepadState;
  gamepad: ControllerInfo | null;
  remainingMs: number;
  touch: boolean;
  onTouch: (s: GamepadState) => void;
  real: RealSession | null;
  profile: 'ps5' | 'xbox';
}) {
  const family = gamepad?.family ?? (profile === 'ps5' ? 'ps' : 'xbox');
  const blocked = FILTER_PROFILES[profile].always;
  const pressed = pressedButtons(state.buttons);
  const fam = family === 'ps' ? 'ps' : 'xbox';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {mode === 'SIMULATED' ? (
        <div className="absolute inset-x-3 top-3 flex justify-center">
          <div className="flex max-w-xl items-start gap-2 rounded-xl border border-info/40 bg-black/75 px-3 py-2 text-xs text-white backdrop-blur">
            <Info className="mt-0.5 size-4 shrink-0 text-info" />
            <span>
              <b>Modo práctica:</b> la consola todavía no está conectada. Tus inputs se registran acá para que pruebes el mando,
              pero no controlan esta transmisión.
            </span>
          </div>
        </div>
      ) : (
        <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-1.5 rounded-lg bg-black/75 p-1 backdrop-blur">
          <Badge tone={real?.bridge === 'ready' ? 'ok' : 'muted'}>
            <Gamepad2 className="size-3" /> control {STATUS[real?.bridge ?? 'idle']}
          </Badge>
          <Badge tone={real?.video === 'ready' ? 'ok' : 'muted'}>video {STATUS[real?.video ?? 'idle']}</Badge>
          {real?.inputRttMs != null && (
            <Badge tone="ok">
              <Wifi className="size-3" /> input {real.inputRttMs} ms
            </Badge>
          )}
        </div>
      )}

      {touch ? (
        <TouchControls onChange={onTouch} family={family} />
      ) : (
        <div className="absolute bottom-3 right-3 w-44 rounded-xl border border-white/10 bg-black/60 p-2 backdrop-blur sm:w-56">
          <GamepadVisual state={state} family={family} blocked={blocked} className="w-full" />
          <div className="mt-1 flex min-h-5 flex-wrap gap-1">
            {pressed.length === 0 && <span className="text-[10px] text-white/50">{gamepad ? gamepad.id.slice(0, 32) : 'Teclado: WASD + flechas · Espacio = A'}</span>}
            {pressed.map((b) => (
              <Badge key={b} tone={blocked.includes(b as never) ? 'live' : 'accent'}>
                {BUTTON_LABELS[b][fam]}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-1.5 rounded-xl bg-black/70 px-3 py-1.5 text-sm font-bold tabular text-white backdrop-blur sm:flex">
        <Timer className="size-4 text-ok" /> {mmss(remainingMs)}
      </div>
    </div>
  );
}
