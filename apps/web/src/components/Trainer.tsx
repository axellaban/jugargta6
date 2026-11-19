'use client';

import { BUTTON_LABELS, DEFAULT_KEYMAP, FILTER_PROFILES, keyLabel, pressedButtons } from '@jugargta/protocol';
import { Gamepad2, Keyboard, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useControllerInput } from '@/hooks/useControllerInput';
import { GamepadVisual } from './GamepadVisual';
import { TouchControls } from './TouchControls';
import { Badge, Modal } from './ui';

function describeTarget(code: string): string {
  const t = DEFAULT_KEYMAP[code];
  if (t.kind === 'button') return BUTTON_LABELS[t.button].xbox;
  if (t.kind === 'trigger') return t.trigger.toUpperCase();
  const names = { lx: 'Stick izq.', ly: 'Stick izq.', rx: 'Stick der.', ry: 'Stick der.' } as const;
  const dir = t.axis.endsWith('x') ? (t.direction > 0 ? '→' : '←') : t.direction > 0 ? '↑' : '↓';
  return `${names[t.axis]} ${dir}`;
}

export function Trainer({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: 'ps5' | 'xbox' }) {
  const input = useControllerInput(open);
  const [tab, setTab] = useState<'pad' | 'keys' | 'touch'>('pad');
  useEffect(() => {
    if (open && window.matchMedia('(pointer: coarse)').matches) setTab('touch');
  }, [open]);
  const family = input.gamepad?.family ?? (profile === 'ps5' ? 'ps' : 'xbox');
  const fam = family === 'ps' ? 'ps' : 'xbox';
  const blocked = FILTER_PROFILES[profile].always;
  const pressed = pressedButtons(input.state.buttons);

  return (
    <Modal open={open} onClose={onClose} title="Probá tu mando mientras esperás" width="max-w-3xl">
      <div className="mb-4 flex gap-2">
        {(
          [
            ['pad', <Gamepad2 key="i" className="size-4" />, 'Joystick'],
            ['keys', <Keyboard key="i" className="size-4" />, 'Teclado y mouse'],
            ['touch', <Smartphone key="i" className="size-4" />, 'Táctil'],
          ] as const
        ).map(([id, icon, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${tab === id ? 'bg-brand text-white' : 'bg-panel-2 text-muted hover:text-text'}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-border bg-panel-2 p-4">
        <GamepadVisual state={input.state} family={family} blocked={blocked} className="mx-auto w-full max-w-md" />
        <div className="mt-3 flex min-h-6 flex-wrap justify-center gap-1.5">
          {pressed.map((b) => (
            <Badge key={b} tone={blocked.includes(b as never) ? 'live' : 'accent'}>
              {BUTTON_LABELS[b][fam]}
              {blocked.includes(b as never) && ' · bloqueado'}
            </Badge>
          ))}
          {(input.state.lt > 0 || input.state.rt > 0) && (
            <Badge tone="info">
              {fam === 'ps' ? 'L2' : 'LT'} {Math.round((input.state.lt / 255) * 100)}% · {fam === 'ps' ? 'R2' : 'RT'} {Math.round((input.state.rt / 255) * 100)}%
            </Badge>
          )}
        </div>
        {tab === 'touch' && (
          <div className="relative mt-4 h-56 overflow-hidden rounded-xl border border-border bg-black/40">
            <TouchControls onChange={input.setTouchState} family={family} />
          </div>
        )}
      </div>

      {tab === 'pad' && (
        <div className="mt-4 space-y-2 text-sm">
          {input.gamepad ? (
            <p className="flex items-center gap-2 text-ok">
              <Gamepad2 className="size-4" /> Detectado: <span className="truncate font-mono text-xs">{input.gamepad.id}</span>
              {!input.gamepad.standard && <Badge>mapeo no estándar</Badge>}
            </p>
          ) : (
            <p className="text-muted">
              Conectá tu joystick por USB o Bluetooth y <b>apretá cualquier botón</b> para que el navegador lo detecte.
              Funcionan mandos de Xbox, PlayStation y la mayoría de los genéricos.
            </p>
          )}
        </div>
      )}

      {tab === 'keys' && (
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {Object.keys(DEFAULT_KEYMAP).map((code) => (
            <div key={code} className="flex items-center justify-between gap-2 border-b border-border/50 py-1">
              <kbd className="rounded-md border border-border bg-panel-3 px-1.5 py-0.5 font-mono text-xs">{keyLabel(code)}</kbd>
              <span className="text-muted">{describeTarget(code)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 rounded-xl bg-panel-2 p-3 text-xs text-muted">
        Para que nadie arruine la partida, los botones de sistema ({blocked.map((b) => BUTTON_LABELS[b][fam]).join(', ')}) no llegan a la
        consola, y {BUTTON_LABELS.Start[fam]} solo funciona con un toque corto.
      </p>
    </Modal>
  );
}
