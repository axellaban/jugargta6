'use client';

import type { RealtimeChannel, SupabaseClient, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  DEFAULT_SETTINGS,
  EMPTY_SNAPSHOT,
  type AppSettings,
  type ChatMessage,
  type MyQueueStatus,
  type PublicConfig,
  type QueueSnapshot,
  type StreamMode,
} from '@/lib/types';
import { getVisitorId } from '@/lib/visitor';

const HEARTBEAT_MS = 15_000;
const CHAT_LIMIT = 80;

export type TrackName =
  | 'page_view' | 'login_click' | 'join_click' | 'join_success' | 'leave_click' | 'vip_click' | 'extend_click'
  | 'checkout_open' | 'checkout_start' | 'checkout_cancel' | 'mock_confirm' | 'trainer_open'
  | 'turn_offered' | 'turn_confirm' | 'turn_timeout' | 'chat_send' | 'share_click';

export interface LiveRoomValue {
  config: PublicConfig;
  supabase: SupabaseClient | null;
  user: User | null;
  authReady: boolean;
  settings: AppSettings;
  mode: StreamMode;
  snapshot: QueueSnapshot;
  online: number;
  me: MyQueueStatus | null;
  messages: ChatMessage[];
  visitorId: string;
  serverNow: () => number;
  busy: boolean;
  join: () => Promise<boolean>;
  leave: () => Promise<void>;
  confirm: () => Promise<boolean>;
  refreshMe: () => Promise<void>;
  sendChat: (body: string) => Promise<string | null>;
  signInGoogle: () => Promise<void>;
  signInGuest: () => Promise<string | null>;
  signOut: () => Promise<void>;
  track: (name: TrackName, props?: Record<string, unknown>) => void;
  isMine: (userId: string | undefined | null) => boolean;
}

const Ctx = createContext<LiveRoomValue | null>(null);

export function useLiveRoom(): LiveRoomValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLiveRoom fuera de LiveRoomProvider');
  return v;
}

function computeMode(config: PublicConfig, settings: AppSettings): StreamMode {
  if (config.envStreamMode !== 'REAL') return 'SIMULATED';
  return settings.stream_mode_override === 'SIMULATED' ? 'SIMULATED' : 'REAL';
}

export function LiveRoomProvider({
  config,
  initialSettings,
  children,
  onError,
}: {
  config: PublicConfig;
  initialSettings: AppSettings;
  children: React.ReactNode;
  onError: (msg: string) => void;
}) {
  const supabase = useMemo(() => getBrowserSupabase(), []);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [settings, setSettings] = useState<AppSettings>(initialSettings ?? DEFAULT_SETTINGS);
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(EMPTY_SNAPSHOT);
  const [online, setOnline] = useState(0);
  const [me, setMe] = useState<MyQueueStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [visitorId, setVisitorId] = useState('anon-pending');

  const versionRef = useRef(-1);
  const offsetRef = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const syncClock = useCallback((serverTime: string | undefined, sentAt: number) => {
    if (!serverTime) return;
    const t = Date.parse(serverTime);
    if (Number.isNaN(t)) return;
    const mid = (sentAt + Date.now()) / 2;
    offsetRef.current = t - mid;
  }, []);

  useEffect(() => setVisitorId(getVisitorId()), []);

  const track = useCallback(
    (name: TrackName, props: Record<string, unknown> = {}) => {
      if (!supabase) return;
      const vid = getVisitorId();
      void supabase.rpc('track_event', { p_name: name, p_visitor_id: vid, p_props: props }).then(() => undefined);
    },
    [supabase],
  );

  // --- Sesión ---------------------------------------------------------------
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // --- Estado propio ----------------------------------------------------------
  const applyMe = useCallback(
    (data: unknown, sentAt: number) => {
      const s = data as MyQueueStatus | null;
      if (!s) return;
      syncClock(s.server_time, sentAt);
      setMe(s);
    },
    [syncClock],
  );

  const refreshMe = useCallback(async () => {
    if (!supabase) return;
    const sentAt = Date.now();
    const { data, error } = await supabase.rpc('get_my_queue_status');
    if (!error) applyMe(data, sentAt);
  }, [supabase, applyMe]);

  useEffect(() => {
    if (!supabase || !authReady) return;
    void refreshMe();
  }, [supabase, authReady, user?.id, refreshMe]);

  // Heartbeat mientras estoy en la fila (si no late, el servidor me saca a los 60 s).
  const inQueue = Boolean(me?.in_queue);
  useEffect(() => {
    if (!supabase || !user || !inQueue) return;
    const beat = async () => {
      const sentAt = Date.now();
      const { data, error } = await supabase.rpc('queue_heartbeat');
      if (!error) applyMe(data, sentAt);
    };
    const id = window.setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => document.visibilityState === 'visible' && void beat();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [supabase, user, inQueue, applyMe]);

  // --- Carga inicial + Realtime ----------------------------------------------
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    (async () => {
      const sentAt = Date.now();
      const [snap, chat, st] = await Promise.all([
        supabase.rpc('get_queue_snapshot'),
        supabase
          .from('chat_messages')
          .select('id, user_id, display_name, role, is_vip, is_founder, body, created_at, deleted_at')
          .order('id', { ascending: false })
          .limit(50),
        supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
      ]);
      if (cancelled) return;
      const s = snap.data as { version: number; snapshot: QueueSnapshot; server_time: string } | null;
      if (s && s.version > versionRef.current) {
        versionRef.current = s.version;
        setSnapshot(s.snapshot);
        syncClock(s.server_time, sentAt);
      }
      if (chat.data) setMessages((chat.data as ChatMessage[]).reverse());
      if (st.data) setSettings(st.data as AppSettings);
    })();

    const vid = getVisitorId();
    const channel: RealtimeChannel = supabase.channel('lobby', { config: { presence: { key: vid } } });
    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queue_state' }, (payload) => {
        const row = payload.new as { version: number; snapshot: QueueSnapshot };
        if (row.version > versionRef.current) {
          versionRef.current = row.version;
          setSnapshot(row.snapshot);
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const msg = payload.new as ChatMessage;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-CHAT_LIMIT)));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, (payload) => {
        const msg = payload.new as ChatMessage;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings' }, (payload) => {
        setSettings(payload.new as AppSettings);
      })
      .on('presence', { event: 'sync' }, () => {
        setOnline(Object.keys(channel.presenceState()).length);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track({ t: Date.now() });
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, syncClock]);

  // Si estoy en la fila, refresco mi posición cuando cambia el snapshot (máx. cada 3 s).
  const lastRefreshRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  useEffect(() => {
    if (!inQueue) return;
    const wait = Math.max(0, 3000 - (Date.now() - lastRefreshRef.current));
    if (pendingRef.current) window.clearTimeout(pendingRef.current);
    pendingRef.current = window.setTimeout(() => {
      lastRefreshRef.current = Date.now();
      void refreshMe();
    }, wait);
    return () => {
      if (pendingRef.current) window.clearTimeout(pendingRef.current);
    };
  }, [snapshot, inQueue, refreshMe]);

  // --- Fallback de avance: si vence un plazo y nadie lo movió, pedimos un tick -----
  const myId = user?.id;
  useEffect(() => {
    if (!supabase || !myId) return;
    const cur = snapshot.current;
    const deadlineIso = cur ? (cur.status === 'offered' ? cur.offer_expires_at : cur.ends_at) : null;
    if (!deadlineIso) return;
    const near = cur?.user_id === myId || snapshot.next.slice(0, 3).some((n) => n.user_id === myId);
    // Los más interesados tickean enseguida; el resto, como último recurso y con jitter.
    const delay = Date.parse(deadlineIso) - serverNow() + (near ? 1500 : 10_000 + Math.random() * 10_000);
    const id = window.setTimeout(() => void supabase.rpc('queue_tick'), Math.max(500, delay));
    return () => window.clearTimeout(id);
  }, [supabase, myId, snapshot, serverNow]);

  // --- Acciones -------------------------------------------------------------
  const run = useCallback(
    async (fn: string): Promise<boolean> => {
      if (!supabase) return false;
      setBusy(true);
      const sentAt = Date.now();
      const { data, error } = await supabase.rpc(fn);
      setBusy(false);
      if (error) {
        onErrorRef.current(errorMessage(error));
        void refreshMe();
        return false;
      }
      applyMe(data, sentAt);
      return true;
    },
    [supabase, applyMe, refreshMe],
  );

  const join = useCallback(async () => {
    const ok = await run('join_queue');
    if (ok) track('join_success');
    return ok;
  }, [run, track]);
  const leave = useCallback(async () => void (await run('leave_queue')), [run]);
  const confirm = useCallback(async () => {
    const ok = await run('confirm_turn');
    if (ok) track('turn_confirm');
    return ok;
  }, [run, track]);

  const sendChat = useCallback(
    async (body: string) => {
      if (!supabase) return 'not_configured';
      const { error } = await supabase.rpc('send_chat_message', { p_body: body });
      if (error) return errorMessage(error);
      track('chat_send');
      return null;
    },
    [supabase, track],
  );

  const signInGoogle = useCallback(async () => {
    if (!supabase) return;
    track('login_click', { provider: 'google' });
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`;
    // Si ya es invitado, se vincula la cuenta de Google y conserva su lugar en la fila.
    const current = (await supabase.auth.getUser()).data.user;
    if (current?.is_anonymous) {
      const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } });
      if (!error) return;
    }
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) onErrorRef.current(errorMessage(error));
  }, [supabase, track]);

  const signInGuest = useCallback(async () => {
    if (!supabase) return 'not_configured';
    track('login_click', { provider: 'guest' });
    const { error } = await supabase.auth.signInAnonymously();
    return error ? errorMessage(error) : null;
  }, [supabase, track]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setMe(null);
  }, [supabase]);

  const isMine = useCallback((id: string | undefined | null) => Boolean(myId && id === myId), [myId]);

  const value: LiveRoomValue = {
    config,
    supabase,
    user,
    authReady,
    settings,
    mode: computeMode(config, settings),
    snapshot,
    online,
    me,
    messages,
    visitorId,
    serverNow,
    busy,
    join,
    leave,
    confirm,
    refreshMe,
    sendChat,
    signInGoogle,
    signInGuest,
    signOut,
    track,
    isMine,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
