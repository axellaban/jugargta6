'use client';

import { Gamepad2, ListOrdered, LogIn, LogOut, Settings, Trophy, Users } from 'lucide-react';
import { compact } from '@/lib/format';
import { useLiveRoom } from './LiveRoom';
import { Avatar, Badge, Button } from './ui';

function Stat({ icon, value, label, live }: { icon: React.ReactNode; value: string; label: string; live?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-panel-2 px-2 py-1.5 sm:gap-2 sm:px-3">
      <span className={live ? 'text-ok' : 'text-muted'}>{icon}</span>
      <span className="tabular text-sm font-bold">{value}</span>
      <span className="hidden text-xs text-muted sm:inline">{label}</span>
    </div>
  );
}

export function Header({ onLogin, onTrainer }: { onLogin: () => void; onTrainer: () => void }) {
  const { config, online, snapshot, user, me, signOut } = useLiveRoom();
  const profile = me?.profile;
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3">
        <a href="/" className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-brand shadow-lg shadow-accent/30">
            <Gamepad2 className="size-5 text-white" />
          </span>
          <span className="hidden text-lg font-black tracking-tight sm:block">
            <span className="text-brand">{config.siteName}</span>
          </span>
        </a>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2 md:ml-6">
          <Stat icon={<Users className="size-4" />} value={compact(online)} label="online" live />
          <Stat icon={<ListOrdered className="size-4" />} value={compact(snapshot.waiting_count)} label="en fila" />
          <Stat icon={<Trophy className="size-4" />} value={compact(snapshot.games_played)} label="partidas" />
        </div>

        <div className="flex items-center gap-2 md:ml-auto">
          <span className="hidden lg:block">
            <Button variant="outline" size="sm" onClick={onTrainer}>
              <Gamepad2 className="size-4" /> Probar mi mando
            </Button>
          </span>
          {user ? (
            <div className="flex items-center gap-2">
              {profile?.role === 'admin' && (
                <a href="/admin" className="rounded-lg p-2 text-muted hover:bg-panel-3 hover:text-text" title="Admin">
                  <Settings className="size-4" />
                </a>
              )}
              <div className="hidden items-center gap-2 sm:flex">
                <Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} />
                <div className="leading-tight">
                  <div className="max-w-[120px] truncate text-sm font-semibold">{profile?.display_name ?? '…'}</div>
                  <div className="flex gap-1">
                    {user.is_anonymous && <Badge>invitado</Badge>}
                    {profile?.is_founder && <Badge tone="founder">fundador</Badge>}
                    {profile?.is_vip && <Badge tone="vip">vip</Badge>}
                  </div>
                </div>
              </div>
              <button onClick={() => void signOut()} className="rounded-lg p-2 text-muted hover:bg-panel-3 hover:text-text" title="Salir">
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <Button variant="brand" size="sm" onClick={onLogin}>
              <LogIn className="size-4" /> Entrar
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
