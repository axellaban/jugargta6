'use client';

import { Crown, MessageSquare, Send, Sparkles, Trash, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { useLiveRoom } from './LiveRoom';
import { useToast } from './Toasts';
import { Badge, Button, Panel } from './ui';

export function ChatPanel({ onLogin, className = '' }: { onLogin: () => void; className?: string }) {
  const { messages, user, me, sendChat, settings, supabase } = useLiveRoom();
  const toast = useToast();
  const [text, setText] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [, force] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const isMod = me?.profile?.role === 'admin' || me?.profile?.role === 'moderator';

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => force((n) => n + 1), 250);
    const t = window.setTimeout(() => window.clearInterval(id), cooldownUntil - Date.now() + 300);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(t);
    };
  }, [cooldownUntil]);

  const cooling = cooldownUntil > Date.now();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || cooling) return;
    const err = await sendChat(body);
    if (err) {
      toast(err, 'error');
      return;
    }
    setText('');
    if (!isMod) setCooldownUntil(Date.now() + settings.chat_cooldown_seconds * 1000);
  }

  async function moderate(fn: 'mod_delete_message' | 'mod_mute_user', args: Record<string, unknown>) {
    if (!supabase) return;
    const { error } = await supabase.rpc(fn, args);
    toast(error ? errorMessage(error) : fn === 'mod_delete_message' ? 'Mensaje eliminado' : 'Usuario silenciado 10 min', error ? 'error' : 'ok');
  }

  return (
    <Panel className={`flex min-h-0 flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <MessageSquare className="size-4 text-accent" /> Chat en vivo
        </h3>
        {!settings.chat_enabled && <Badge>pausado</Badge>}
      </div>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-sm scrollbar-thin"
      >
        {messages.length === 0 && <p className="py-6 text-center text-faint">Todavía no hay mensajes. ¡Saludá!</p>}
        {messages.map((m) => (
          <div key={m.id} className={`group leading-snug ${m.deleted_at ? 'italic text-faint' : ''}`}>
            {m.role === 'admin' && <Badge tone="live" className="mr-1">admin</Badge>}
            {m.role === 'moderator' && <Badge tone="info" className="mr-1">mod</Badge>}
            {m.is_vip && <Crown className="mr-1 inline size-3.5 -translate-y-px text-vip" aria-label="VIP" />}
            {m.is_founder && <Sparkles className="mr-1 inline size-3.5 -translate-y-px text-accent" aria-label="Fundador" />}
            <span className={`font-semibold ${m.is_vip ? 'text-vip' : 'text-accent-2'}`}>{m.display_name}</span>
            <span className="text-faint">: </span>
            <span className="break-words text-text/90">{m.body}</span>
            {isMod && !m.deleted_at && (
              <span className="ml-2 hidden gap-1 align-middle group-hover:inline-flex">
                <button className="text-faint hover:text-live" title="Eliminar" onClick={() => void moderate('mod_delete_message', { p_id: m.id })}>
                  <Trash className="size-3.5" />
                </button>
                {m.role === 'user' && (
                  <button className="text-faint hover:text-vip" title="Silenciar 10 min" onClick={() => void moderate('mod_mute_user', { p_user_id: m.user_id, p_minutes: 10 })}>
                    <VolumeX className="size-3.5" />
                  </button>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
      {user ? (
        <form onSubmit={submit} className="flex gap-2 border-t border-border p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 280))}
            placeholder={settings.chat_enabled ? 'Escribí un mensaje…' : 'Chat pausado'}
            disabled={!settings.chat_enabled}
            maxLength={280}
            className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-panel-2 px-3 text-sm outline-none placeholder:text-faint focus:border-accent/60"
            aria-label="Mensaje"
          />
          <Button type="submit" variant="brand" disabled={!text.trim() || cooling || !settings.chat_enabled} aria-label="Enviar">
            {cooling ? <span className="tabular w-4 text-center">{Math.ceil((cooldownUntil - Date.now()) / 1000)}</span> : <Send className="size-4" />}
          </Button>
        </form>
      ) : (
        <div className="border-t border-border p-3">
          <Button variant="outline" className="w-full" onClick={onLogin}>
            Entrá para chatear
          </Button>
        </div>
      )}
    </Panel>
  );
}
