'use client';

import { Gamepad2, Megaphone, Sparkles, TriangleExclamationPoint } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ProductCode, ProductView } from '@/lib/products';
import type { AppSettings, PublicConfig, StreamMode } from '@/lib/types';
import { useControllerInput } from '@/hooks/useControllerInput';
import { useNow } from '@/hooks/useNow';
import { useRealSession } from '@/hooks/useRealSession';
import { AuthModal } from './AuthModal';
import { ChatPanel } from './ChatPanel';
import { CheckoutModal } from './CheckoutModal';
import { ControlsHUD } from './ControlsHUD';
import { Header } from './Header';
import { LiveRoomProvider, useLiveRoom } from './LiveRoom';
import { OnboardingModal } from './OnboardingModal';
import { Player } from './Player';
import { QueueActions, QueueList } from './QueuePanel';
import { ToastProvider, useToast } from './Toasts';
import { Trainer } from './Trainer';
import { TurnModal } from './TurnModal';
import { Button, Panel } from './ui';

interface HomeProps {
  config: PublicConfig;
  initialSettings: AppSettings;
  initialMode: StreamMode;
  products: Record<StreamMode, ProductView[]>;
  consoleProfile: 'ps5' | 'xbox';
}

export function Home(props: HomeProps) {
  return (
    <ToastProvider>
      <WithRoom {...props} />
    </ToastProvider>
  );
}

function WithRoom({ config, initialSettings, products, consoleProfile }: HomeProps) {
  const toast = useToast();
  return (
    <LiveRoomProvider config={config} initialSettings={initialSettings} onError={(m) => toast(m, 'error')}>
      <Room products={products} consoleProfile={consoleProfile} />
    </LiveRoomProvider>
  );
}

const PENDING_JOIN = 'jg_pending_join';

function Room({ products, consoleProfile }: { products: HomeProps['products']; consoleProfile: 'ps5' | 'xbox' }) {
  const room = useLiveRoom();
  const toast = useToast();
  const [authOpen, setAuthOpen] = useState(false);
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutProduct, setCheckoutProduct] = useState<ProductCode | null>(null);
  const [touch, setTouch] = useState(false);

  const entry = room.me?.entry;
  const playing = entry?.status === 'playing';
  const input = useControllerInput(playing && !trainerOpen);
  const real = useRealSession(playing && room.mode === 'REAL', input.read);
  const now = useNow(room.serverNow, 500, playing);
  const remaining = playing && entry?.ends_at ? Date.parse(entry.ends_at) - now : 0;

  useEffect(() => setTouch(window.matchMedia('(pointer: coarse)').matches), []);

  // Métrica de visita (una vez por carga).
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current || !room.supabase || room.visitorId === 'anon-pending') return;
    viewedRef.current = true;
    room.track('page_view', { ref: document.referrer.slice(0, 200), touch: window.matchMedia('(pointer: coarse)').matches });
  }, [room, room.visitorId]);

  // Vuelta del checkout / login.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get('checkout');
    const msgs: Record<string, [string, 'ok' | 'info' | 'error']> = {
      approved: ['¡Pago aprobado! Ya quedó acreditado en tu cuenta.', 'ok'],
      pending: ['Tu pago está pendiente. Te lo acreditamos apenas se confirme.', 'info'],
      failure: ['El pago no se pudo completar.', 'error'],
      cancel: ['Cancelaste el checkout.', 'info'],
    };
    if (c && msgs[c]) toast(...msgs[c]);
    if (q.get('auth') === 'error') toast('No pudimos iniciar sesión. Probá de nuevo.', 'error');
    if (c || q.get('auth')) window.history.replaceState(null, '', window.location.pathname);
  }, [toast]);

  // Si tocó "Entrar a la fila" sin sesión, entra solo al volver del login.
  const { user, me, join } = room;
  useEffect(() => {
    if (!user || !me?.authenticated) return;
    let pending = false;
    try {
      pending = window.sessionStorage.getItem(PENDING_JOIN) === '1';
      window.sessionStorage.removeItem(PENDING_JOIN);
    } catch {
      // storage bloqueado
    }
    if (pending && !me.in_queue) void join();
  }, [user, me?.authenticated, me?.in_queue, join]);

  const onJoin = () => {
    room.track('join_click');
    if (!room.user) {
      try {
        window.sessionStorage.setItem(PENDING_JOIN, '1');
      } catch {
        // storage bloqueado
      }
      setAuthOpen(true);
      return;
    }
    void room.join();
  };

  const onBuy = (code: ProductCode) => {
    setCheckoutProduct(code);
    setCheckoutOpen(true);
  };

  const openTrainer = () => {
    room.track('trainer_open');
    setTrainerOpen(true);
  };

  return (
    <>
      <Header onLogin={() => setAuthOpen(true)} onTrainer={openTrainer} />

      {!room.config.supabaseConfigured && (
        <div className="border-b border-vip/30 bg-vip/10">
          <p className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2 text-sm text-vip">
            <TriangleExclamationPoint className="size-4 shrink-0" /> Vista previa sin backend: configurá las variables de Supabase (ver README) para activar la
            fila, el chat y los pagos.
          </p>
        </div>
      )}
      {room.mode === 'SIMULATED' && room.config.supabaseConfigured && (
        <div className="border-b border-info/20 bg-info/5">
          <p className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2 text-xs text-info sm:text-sm">
            <Sparkles className="size-4 shrink-0" /> Beta: la consola propia se conecta pronto. Hoy podés hacer fila de práctica, probar tu mando y
            reservar tu Pase Fundador.
          </p>
        </div>
      )}
      {room.settings.announcement && (
        <div className="border-b border-accent/30 bg-accent/10">
          <p className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2 text-sm">
            <Megaphone className="size-4 shrink-0 text-accent" /> {room.settings.announcement}
          </p>
        </div>
      )}

      <main className="mx-auto grid max-w-[1500px] gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Player
            realSession={room.mode === 'REAL' ? real : null}
            mouseTargetRef={input.bindMouseTarget}
            overlay={
              playing ? (
                <ControlsHUD
                  mode={room.mode}
                  state={input.state}
                  gamepad={input.gamepad}
                  remainingMs={remaining}
                  touch={touch}
                  onTouch={input.setTouchState}
                  real={room.mode === 'REAL' ? real : null}
                  profile={consoleProfile}
                />
              ) : null
            }
          />

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px]">
            <Panel className="order-2 p-5 md:order-1">
              <h1 className="text-xl font-black leading-tight sm:text-2xl">
                Jugá <span className="text-brand">GTA VI</span> desde el navegador
              </h1>
              <p className="mt-1 text-sm text-muted">{room.settings.stream_title}</p>
              <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                {[
                  ['1', 'Entrá a la fila', 'Gratis, con Google o como invitado.'],
                  ['2', 'Confirmá tu turno', `Tenés ${room.settings.confirm_seconds} s cuando te toque.`],
                  ['3', 'Tomá el control', 'Joystick, teclado o el celular.'],
                ].map(([n, t, d]) => (
                  <li key={n} className="rounded-xl border border-border bg-panel-2 p-3">
                    <span className="mb-1 grid size-6 place-items-center rounded-lg bg-brand text-xs font-black">{n}</span>
                    <div className="font-semibold">{t}</div>
                    <div className="text-xs text-muted">{d}</div>
                  </li>
                ))}
              </ol>
              <Button variant="outline" className="mt-4" onClick={openTrainer}>
                <Gamepad2 className="size-4" /> Probar mi joystick / teclado
              </Button>
            </Panel>
            <Panel className="order-1 p-4 md:order-2">
              <QueueActions onJoin={onJoin} onBuy={onBuy} />
            </Panel>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start">
          <QueueList />
          <ChatPanel onLogin={() => setAuthOpen(true)} className="h-[380px] lg:h-auto lg:min-h-[320px] lg:flex-1" />
        </aside>
      </main>

      <footer className="mx-auto max-w-[1500px] px-4 pb-8 pt-2 text-xs text-faint">
        Proyecto independiente de la comunidad. No afiliado a Rockstar Games ni a Take-Two Interactive; las marcas mencionadas pertenecen a sus
        dueños.
      </footer>

      <OnboardingModal />
      <TurnModal />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      <Trainer open={trainerOpen} onClose={() => setTrainerOpen(false)} profile={consoleProfile} />
      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        initial={checkoutProduct}
        products={products}
        onNeedLogin={() => setAuthOpen(true)}
      />
    </>
  );
}

