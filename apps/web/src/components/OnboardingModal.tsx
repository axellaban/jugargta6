'use client';

import { Ban, Clock, Gamepad2, ShieldBan, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { readFlag, writeFlag } from '@/lib/visitor';
import { useLiveRoom } from './LiveRoom';
import { Button, Modal } from './ui';

const KEY = 'jg_onboarded_v1';

export function OnboardingModal() {
  const { settings, mode, config } = useLiveRoom();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(!readFlag(KEY)), []);
  const close = () => {
    writeFlag(KEY);
    setOpen(false);
  };
  const rules = [
    [<Clock key="i" className="size-5 text-accent" />, `Hacé fila gratis. Cada turno dura ${Math.round(settings.turn_seconds / 60)} min${settings.extension_seconds ? ` (+${Math.round(settings.extension_seconds / 60)} si no hay nadie esperando)` : ''}.`],
    [<Timer key="i" className="size-5 text-accent" />, `Cuando llegue tu turno tenés ${settings.confirm_seconds} segundos para confirmar. No cierres la pestaña.`],
    [<Gamepad2 key="i" className="size-5 text-accent" />, 'Jugá con joystick, teclado y mouse, o con los controles táctiles del celular.'],
    [<ShieldBan key="i" className="size-5 text-accent" />, 'Los botones de sistema de la consola están bloqueados. Trolls: kick y ban.'],
  ] as const;
  return (
    <Modal open={open} onClose={close} title={`Bienvenido a ${config.siteName}`} width="max-w-md">
      <ul className="space-y-3">
        {rules.map(([icon, text], i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {text}
          </li>
        ))}
      </ul>
      {mode === 'SIMULATED' && (
        <p className="mt-4 rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
          <b>Beta:</b> la consola propia todavía no está conectada. Por ahora mostramos una transmisión de referencia y los turnos son de
          práctica para probar tus controles.
        </p>
      )}
      <p className="mt-4 flex items-center gap-2 text-xs text-faint">
        <Ban className="size-4" /> Contenido para mayores de 18 años.
      </p>
      <Button variant="brand" size="lg" className="mt-4 w-full" onClick={close}>
        Tengo +18, entrar
      </Button>
    </Modal>
  );
}
