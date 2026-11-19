'use client';

import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { useLiveRoom } from './LiveRoom';
import { useToast } from './Toasts';
import { Button, Modal } from './ui';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signInGoogle, signInGuest, config } = useLiveRoom();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Entrá para hacer fila" width="max-w-sm">
      {!config.supabaseConfigured ? (
        <p className="text-sm text-muted">Falta configurar Supabase (ver README).</p>
      ) : (
        <div className="space-y-3">
          <Button variant="solid" size="lg" className="w-full bg-white text-black hover:bg-white/90" disabled={loading} onClick={() => { setLoading(true); void signInGoogle(); }}>
            <GoogleIcon /> Continuar con Google
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              const err = await signInGuest();
              setLoading(false);
              if (err) toast(err, 'error');
              else onClose();
            }}
          >
            <UserRound className="size-5" /> Entrar como invitado
          </Button>
          <p className="text-xs text-faint">
            Como invitado, tu lugar y tus pases quedan guardados solo en este navegador. Podés vincular Google después sin perderlos.
          </p>
        </div>
      )}
    </Modal>
  );
}
