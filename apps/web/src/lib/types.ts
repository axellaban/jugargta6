// Formas de los JSON que devuelven las funciones SQL (supabase/migrations/001_init.sql).

export type StreamMode = 'SIMULATED' | 'REAL';
export type QueueStatus = 'waiting' | 'offered' | 'playing' | 'done' | 'left' | 'expired' | 'kicked';
export type StreamProvider = 'youtube' | 'kick' | 'twitch' | 'none';

export interface AppSettings {
  id: number;
  stream_mode_override: 'AUTO' | 'SIMULATED';
  stream_provider: StreamProvider;
  stream_source: string;
  stream_title: string;
  turn_seconds: number;
  extension_seconds: number;
  max_extensions: number;
  confirm_seconds: number;
  heartbeat_timeout_seconds: number;
  queue_open: boolean;
  chat_enabled: boolean;
  chat_cooldown_seconds: number;
  announcement: string;
  updated_at: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  stream_mode_override: 'AUTO',
  stream_provider: 'youtube',
  stream_source: '',
  stream_title: 'GTA VI — transmisión 24/7',
  turn_seconds: 600,
  extension_seconds: 300,
  max_extensions: 12,
  confirm_seconds: 25,
  heartbeat_timeout_seconds: 60,
  queue_open: true,
  chat_enabled: true,
  chat_cooldown_seconds: 3,
  announcement: '',
  updated_at: new Date(0).toISOString(),
};

export interface SnapshotPlayer {
  entry_id: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_vip: boolean;
  is_founder: boolean;
}

export interface SnapshotCurrent extends SnapshotPlayer {
  status: 'offered' | 'playing';
  offered_at: string | null;
  offer_expires_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  extensions: number;
}

export interface SnapshotNext extends SnapshotPlayer {
  skipped: boolean;
}

export interface QueueSnapshot {
  current: SnapshotCurrent | null;
  next: SnapshotNext[];
  waiting_count: number;
  games_played: number;
}

export const EMPTY_SNAPSHOT: QueueSnapshot = { current: null, next: [], waiting_count: 0, games_played: 0 };

export interface MyEntry {
  id: number;
  status: QueueStatus;
  priority: number;
  joined_at: string;
  offered_at: string | null;
  offer_expires_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  extensions: number;
}

export interface MyProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: 'user' | 'moderator' | 'admin';
  is_vip: boolean;
  is_founder: boolean;
  bonus_seconds: number;
  priority_credits: number;
  founder_bonus_seconds: number;
  founder_priority_credits: number;
  games_played: number;
  muted_until: string | null;
  banned: boolean;
}

export interface MyQueueStatus {
  authenticated: boolean;
  in_queue: boolean;
  entry: MyEntry | null;
  position: number | null;
  waiting_count: number;
  turn_active: boolean;
  profile: MyProfile | null;
  server_time: string;
}

export interface ChatMessage {
  id: number;
  user_id: string;
  display_name: string;
  role: 'user' | 'moderator' | 'admin';
  is_vip: boolean;
  is_founder: boolean;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

/** Lo que el servidor le pasa a la página (sin secretos). */
export interface PublicConfig {
  siteName: string;
  envStreamMode: StreamMode;
  supabaseConfigured: boolean;
  checkoutProvider: 'mock' | 'mercadopago' | 'stripe';
  currency: string;
}
