-- =============================================================================
-- 001_init.sql — Cloud gaming comunitario por turnos
--
-- Contenido:
--   1. Tablas: profiles, app_settings, queue_entries, queue_state,
--              chat_messages, payment_intents, events
--   2. Fila como máquina de estados (funciones SECURITY DEFINER)
--   3. Chat con anti-spam, moderación
--   4. Pagos: acreditación idempotente según modo (SIMULATED / REAL)
--   5. Métricas para /admin
--   6. RLS + grants mínimos, Realtime, pg_cron
--
-- Regla general: los clientes (anon / authenticated) NUNCA escriben tablas de
-- la fila, el chat ni los pagos directamente. Todo pasa por funciones que
-- validan. El servidor Next.js usa service_role solo para pagos y webhooks.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.queue_status as enum
    ('waiting', 'offered', 'playing', 'done', 'left', 'expired', 'kicked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum
    ('clicked', 'checkout_created', 'pending', 'approved', 'rejected',
     'cancelled', 'refunded', 'mock_completed');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                        uuid primary key references auth.users (id) on delete cascade,
  display_name              text not null check (char_length(display_name) between 2 and 24),
  avatar_url                text,
  role                      text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  is_vip                    boolean not null default false,   -- pagó al menos una vez (badge)
  is_founder                boolean not null default false,   -- reservó en Fase 1
  -- créditos activos: se consumen en la fila (solo se cargan en modo REAL)
  bonus_seconds             integer not null default 0 check (bonus_seconds >= 0),
  priority_credits          integer not null default 0 check (priority_credits >= 0),
  -- créditos de fundador: inertes hasta admin_activate_founder_credits()
  founder_bonus_seconds     integer not null default 0 check (founder_bonus_seconds >= 0),
  founder_priority_credits  integer not null default 0 check (founder_priority_credits >= 0),
  games_played              integer not null default 0,
  muted_until               timestamptz,
  banned                    boolean not null default false,
  created_at                timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- app_settings (fila única, editable en caliente desde /admin)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                         integer primary key default 1 check (id = 1),
  -- AUTO: sigue la env STREAM_MODE del deploy. SIMULATED: fuerza el fallback.
  stream_mode_override       text not null default 'AUTO' check (stream_mode_override in ('AUTO', 'SIMULATED')),
  stream_provider            text not null default 'youtube' check (stream_provider in ('youtube', 'kick', 'twitch', 'none')),
  stream_source              text not null default '' check (char_length(stream_source) <= 300),
  stream_title               text not null default 'GTA VI — transmisión 24/7' check (char_length(stream_title) <= 80),
  turn_seconds               integer not null default 600 check (turn_seconds between 30 and 3600),
  extension_seconds          integer not null default 300 check (extension_seconds between 0 and 3600),
  max_extensions             integer not null default 12 check (max_extensions between 0 and 100),
  confirm_seconds            integer not null default 25 check (confirm_seconds between 5 and 120),
  heartbeat_timeout_seconds  integer not null default 60 check (heartbeat_timeout_seconds between 15 and 600),
  queue_open                 boolean not null default true,
  chat_enabled               boolean not null default true,
  chat_cooldown_seconds      integer not null default 3 check (chat_cooldown_seconds between 0 and 60),
  announcement               text not null default '' check (char_length(announcement) <= 280),
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- queue_entries
-- -----------------------------------------------------------------------------
create table if not exists public.queue_entries (
  id                     bigint generated always as identity primary key,
  user_id                uuid not null references public.profiles (id) on delete cascade,
  status                 public.queue_status not null default 'waiting',
  priority               integer not null default 0,
  joined_at              timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  offered_at             timestamptz,
  offer_expires_at       timestamptz,
  started_at             timestamptz,
  ends_at                timestamptz,
  ended_at               timestamptz,
  extensions             integer not null default 0,
  bonus_applied_seconds  integer not null default 0,
  end_reason             text
);

-- Una entrada activa por usuario.
create unique index if not exists queue_entries_one_active_per_user
  on public.queue_entries (user_id)
  where status in ('waiting', 'offered', 'playing');

-- Un solo turno activo (una consola).
create unique index if not exists queue_entries_single_turn
  on public.queue_entries ((true))
  where status in ('offered', 'playing');

create index if not exists queue_entries_waiting_order
  on public.queue_entries (priority desc, joined_at asc, id asc)
  where status = 'waiting';

create index if not exists queue_entries_started_at on public.queue_entries (started_at);
create index if not exists queue_entries_joined_at on public.queue_entries (joined_at);

-- -----------------------------------------------------------------------------
-- queue_state: snapshot público que se difunde por Realtime (una fila)
-- -----------------------------------------------------------------------------
create table if not exists public.queue_state (
  id            integer primary key default 1 check (id = 1),
  version       bigint not null default 0,
  snapshot      jsonb not null default '{"current": null, "next": [], "waiting_count": 0, "games_played": 0}'::jsonb,
  games_played  bigint not null default 0,
  updated_at    timestamptz not null default now()
);

insert into public.queue_state (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- chat_messages
-- -----------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  display_name  text not null,
  role          text not null default 'user',
  is_vip        boolean not null default false,
  is_founder    boolean not null default false,
  body          text not null check (char_length(body) between 1 and 280),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists chat_messages_user_recent on public.chat_messages (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- payment_intents: cada clic en un botón pago, el checkout y su resultado
-- -----------------------------------------------------------------------------
create table if not exists public.payment_intents (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references public.profiles (id) on delete set null,
  visitor_id           text check (char_length(visitor_id) <= 64),
  product_code         text not null,
  provider             text not null check (provider in ('mock', 'mercadopago', 'stripe')),
  mode                 text not null check (mode in ('SIMULATED', 'REAL')),
  amount               numeric(12, 2) not null check (amount >= 0),
  currency             text not null,
  status               public.payment_status not null default 'clicked',
  provider_ref         text,      -- id de preferencia (MP) / checkout session (Stripe)
  provider_payment_id  text,      -- id del pago (MP) / payment_intent (Stripe)
  checkout_url         text,
  failure_reason       text,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  approved_at          timestamptz,
  fulfilled_at         timestamptz
);

create index if not exists payment_intents_user on public.payment_intents (user_id, created_at desc);
create index if not exists payment_intents_created on public.payment_intents (created_at);
create unique index if not exists payment_intents_provider_payment
  on public.payment_intents (provider, provider_payment_id)
  where provider_payment_id is not null;

-- -----------------------------------------------------------------------------
-- events: embudo de producto (visitas, clics) para /admin
-- -----------------------------------------------------------------------------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  visitor_id  text not null check (char_length(visitor_id) between 8 and 64),
  user_id     uuid,
  name        text not null,
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_name_created on public.events (name, created_at);
create index if not exists events_visitor_created on public.events (visitor_id, created_at);

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_moderator()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'moderator'));
$$;

-- Nombre público por defecto: "Nombre A." (nunca el email).
create or replace function public._default_display_name(p_id uuid, p_meta jsonb, p_is_anonymous boolean)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_full  text := nullif(trim(coalesce(p_meta ->> 'full_name', p_meta ->> 'name', '')), '');
  v_parts text[];
  v_name  text;
begin
  if v_full is not null then
    v_full := regexp_replace(v_full, '\s+', ' ', 'g');
    v_parts := string_to_array(v_full, ' ');
    v_name := v_parts[1];
    if array_length(v_parts, 1) > 1 then
      v_name := v_name || ' ' || left(v_parts[array_length(v_parts, 1)], 1) || '.';
    end if;
  end if;
  if v_name is null or char_length(v_name) < 2 then
    v_name := case when coalesce(p_is_anonymous, false) then 'Invitado-' else 'Jugador-' end
              || upper(substr(replace(p_id::text, '-', ''), 1, 4));
  end if;
  return left(v_name, 24);
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    public._default_display_name(new.id, coalesce(new.raw_user_meta_data, '{}'::jsonb), new.is_anonymous),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Para usuarios creados antes de la migración.
create or replace function public._ensure_profile(p_uid uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  select u.id,
         public._default_display_name(u.id, coalesce(u.raw_user_meta_data, '{}'::jsonb), u.is_anonymous),
         nullif(u.raw_user_meta_data ->> 'avatar_url', '')
  from auth.users u
  where u.id = p_uid
  on conflict (id) do nothing;
end;
$$;

create or replace function public._touch_settings()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.id := 1;
  return new;
end;
$$;

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public._touch_settings();

-- =============================================================================
-- Fila: núcleo
-- =============================================================================

-- Mutex global de la fila: toda mutación toma el lock de queue_state.
create or replace function public._queue_lock(p_wait boolean default true)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_wait then
    perform 1 from public.queue_state where id = 1 for update;
    return true;
  end if;
  perform 1 from public.queue_state where id = 1 for update skip locked;
  return found;
end;
$$;

-- Reconstruye el snapshot público. Solo escribe (y dispara Realtime) si cambió.
create or replace function public.refresh_queue_snapshot()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_current jsonb;
  v_next    jsonb;
  v_waiting integer;
  v_games   bigint;
  v_snap    jsonb;
begin
  select jsonb_build_object(
           'entry_id', q.id,
           'user_id', q.user_id,
           'display_name', p.display_name,
           'avatar_url', p.avatar_url,
           'is_vip', p.is_vip,
           'is_founder', p.is_founder,
           'status', q.status,
           'offered_at', q.offered_at,
           'offer_expires_at', q.offer_expires_at,
           'started_at', q.started_at,
           'ends_at', q.ends_at,
           'extensions', q.extensions)
    into v_current
  from public.queue_entries q
  join public.profiles p on p.id = q.user_id
  where q.status in ('offered', 'playing')
  limit 1;

  select coalesce(jsonb_agg(x.obj order by x.priority desc, x.joined_at asc, x.id asc), '[]'::jsonb)
    into v_next
  from (
    select q.id, q.priority, q.joined_at,
           jsonb_build_object(
             'entry_id', q.id,
             'user_id', q.user_id,
             'display_name', p.display_name,
             'avatar_url', p.avatar_url,
             'is_vip', p.is_vip,
             'is_founder', p.is_founder,
             'skipped', q.priority > 0) as obj
    from public.queue_entries q
    join public.profiles p on p.id = q.user_id
    where q.status = 'waiting'
    order by q.priority desc, q.joined_at asc, q.id asc
    limit 12
  ) x;

  select count(*) into v_waiting from public.queue_entries where status = 'waiting';
  select games_played into v_games from public.queue_state where id = 1;

  v_snap := jsonb_build_object(
    'current', v_current,
    'next', v_next,
    'waiting_count', v_waiting,
    'games_played', coalesce(v_games, 0));

  update public.queue_state
     set snapshot = v_snap,
         version = version + 1,
         updated_at = now()
   where id = 1
     and snapshot is distinct from v_snap;
end;
$$;

-- Avanza la máquina de estados. Asume el lock tomado. Devuelve true si cambió algo.
create or replace function public._queue_advance()
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  s          public.app_settings;
  v_cur      public.queue_entries;
  v_has_cur  boolean;
  v_next_id  bigint;
  v_waiting  integer;
  v_changed  boolean := false;
  v_rows     integer;
begin
  select * into s from public.app_settings where id = 1;

  -- 1. Pestañas cerradas: sin heartbeat → fuera de la fila.
  update public.queue_entries
     set status = 'left', ended_at = now(), end_reason = 'heartbeat_timeout'
   where status = 'waiting'
     and last_seen_at < now() - make_interval(secs => s.heartbeat_timeout_seconds);
  get diagnostics v_rows = row_count;
  if v_rows > 0 then v_changed := true; end if;

  -- 2. Turno actual.
  select * into v_cur from public.queue_entries
   where status in ('offered', 'playing')
   for update;
  v_has_cur := found;

  if v_has_cur then
    if v_cur.status = 'offered' and v_cur.offer_expires_at <= now() then
      update public.queue_entries
         set status = 'expired', ended_at = now(), end_reason = 'not_confirmed'
       where id = v_cur.id;
      v_has_cur := false;
      v_changed := true;

    elsif v_cur.status = 'playing'
          and v_cur.last_seen_at < now() - make_interval(secs => s.heartbeat_timeout_seconds) then
      update public.queue_entries
         set status = 'done', ended_at = now(), end_reason = 'disconnected'
       where id = v_cur.id;
      v_has_cur := false;
      v_changed := true;

    elsif v_cur.status = 'playing' and v_cur.ends_at <= now() then
      select count(*) into v_waiting from public.queue_entries where status = 'waiting';
      if v_waiting = 0 and s.extension_seconds > 0 and v_cur.extensions < s.max_extensions then
        -- Regla "+5 min si la fila está vacía".
        update public.queue_entries
           set ends_at = greatest(v_cur.ends_at, now()) + make_interval(secs => s.extension_seconds),
               extensions = extensions + 1
         where id = v_cur.id;
      else
        update public.queue_entries
           set status = 'done', ended_at = now(), end_reason = 'time_up'
         where id = v_cur.id;
        v_has_cur := false;
      end if;
      v_changed := true;
    end if;
  end if;

  -- 3. Sin turno activo → ofrecer al siguiente.
  if not v_has_cur then
    select id into v_next_id from public.queue_entries
     where status = 'waiting'
     order by priority desc, joined_at asc, id asc
     limit 1
     for update;
    if found then
      update public.queue_entries
         set status = 'offered',
             offered_at = now(),
             offer_expires_at = now() + make_interval(secs => s.confirm_seconds)
       where id = v_next_id;
      v_changed := true;
    end if;
  end if;

  return v_changed;
end;
$$;

-- Estado del usuario actual (posición, créditos, hora del servidor).
create or replace function public.get_my_queue_status()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_entry    public.queue_entries;
  v_profile  public.profiles;
  v_ahead    integer := null;
  v_waiting  integer;
  v_active   boolean;
begin
  select count(*) into v_waiting from public.queue_entries where status = 'waiting';
  select exists (select 1 from public.queue_entries where status in ('offered', 'playing')) into v_active;

  if v_uid is null then
    return jsonb_build_object(
      'authenticated', false, 'in_queue', false, 'entry', null, 'position', null,
      'waiting_count', v_waiting, 'turn_active', v_active, 'profile', null,
      'server_time', now());
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  select * into v_entry from public.queue_entries
   where user_id = v_uid and status in ('waiting', 'offered', 'playing');

  if found and v_entry.status = 'waiting' then
    select count(*) into v_ahead from public.queue_entries q
     where q.status = 'waiting'
       and (q.priority > v_entry.priority
            or (q.priority = v_entry.priority and q.joined_at < v_entry.joined_at)
            or (q.priority = v_entry.priority and q.joined_at = v_entry.joined_at and q.id < v_entry.id));
  end if;

  return jsonb_build_object(
    'authenticated', true,
    'in_queue', v_entry.id is not null,
    'entry', case when v_entry.id is null then null else jsonb_build_object(
      'id', v_entry.id,
      'status', v_entry.status,
      'priority', v_entry.priority,
      'joined_at', v_entry.joined_at,
      'offered_at', v_entry.offered_at,
      'offer_expires_at', v_entry.offer_expires_at,
      'started_at', v_entry.started_at,
      'ends_at', v_entry.ends_at,
      'extensions', v_entry.extensions) end,
    'position', case when v_ahead is null then null else v_ahead + 1 end,
    'waiting_count', v_waiting,
    'turn_active', v_active,
    'profile', case when v_profile.id is null then null else jsonb_build_object(
      'id', v_profile.id,
      'display_name', v_profile.display_name,
      'avatar_url', v_profile.avatar_url,
      'role', v_profile.role,
      'is_vip', v_profile.is_vip,
      'is_founder', v_profile.is_founder,
      'bonus_seconds', v_profile.bonus_seconds,
      'priority_credits', v_profile.priority_credits,
      'founder_bonus_seconds', v_profile.founder_bonus_seconds,
      'founder_priority_credits', v_profile.founder_priority_credits,
      'games_played', v_profile.games_played,
      'muted_until', v_profile.muted_until,
      'banned', v_profile.banned) end,
    'server_time', now());
end;
$$;

-- =============================================================================
-- Fila: RPC públicas
-- =============================================================================

create or replace function public.join_queue()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  s          public.app_settings;
  v_profile  public.profiles;
  v_priority integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  perform public._ensure_profile(v_uid);
  perform public._queue_lock(true);

  select * into s from public.app_settings where id = 1;
  if not s.queue_open then
    raise exception 'queue_closed' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if v_profile.banned then
    raise exception 'banned' using errcode = '42501';
  end if;

  if exists (select 1 from public.queue_entries
             where user_id = v_uid and status in ('waiting', 'offered', 'playing')) then
    update public.queue_entries set last_seen_at = now()
     where user_id = v_uid and status in ('waiting', 'offered', 'playing');
    return public.get_my_queue_status();
  end if;

  -- Crédito de prioridad activo (pagado en modo REAL) → entra adelante.
  if v_profile.priority_credits > 0 then
    v_priority := 100;
    update public.profiles set priority_credits = priority_credits - 1 where id = v_uid;
  end if;

  insert into public.queue_entries (user_id, priority) values (v_uid, v_priority);

  perform public._queue_advance();
  perform public.refresh_queue_snapshot();
  return public.get_my_queue_status();
end;
$$;

-- Salir de la fila o terminar el turno propio.
create or replace function public.leave_queue()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform public._queue_lock(true);

  update public.queue_entries
     set status = case when status = 'playing' then 'done'::public.queue_status else 'left'::public.queue_status end,
         ended_at = now(),
         end_reason = case when status = 'playing' then 'ended_by_player'
                           when status = 'offered' then 'declined'
                           else 'left' end
   where user_id = v_uid and status in ('waiting', 'offered', 'playing');

  perform public._queue_advance();
  perform public.refresh_queue_snapshot();
  return public.get_my_queue_status();
end;
$$;

-- Confirmar el turno ofrecido ("¡ES TU TURNO!").
create or replace function public.confirm_turn()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  s        public.app_settings;
  v_entry  public.queue_entries;
  v_bonus  integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform public._queue_lock(true);
  select * into s from public.app_settings where id = 1;

  select * into v_entry from public.queue_entries
   where user_id = v_uid and status = 'offered'
   for update;
  if not found then
    raise exception 'no_offer' using errcode = 'P0001';
  end if;
  if v_entry.offer_expires_at <= now() then
    raise exception 'offer_expired' using errcode = 'P0001';
  end if;

  select bonus_seconds into v_bonus from public.profiles where id = v_uid for update;
  update public.profiles
     set bonus_seconds = 0, games_played = games_played + 1
   where id = v_uid;

  update public.queue_entries
     set status = 'playing',
         started_at = now(),
         ends_at = now() + make_interval(secs => s.turn_seconds + coalesce(v_bonus, 0)),
         bonus_applied_seconds = coalesce(v_bonus, 0),
         last_seen_at = now()
   where id = v_entry.id;

  update public.queue_state set games_played = games_played + 1 where id = 1;

  perform public.refresh_queue_snapshot();
  return public.get_my_queue_status();
end;
$$;

-- Latido cada ~15 s mientras la pestaña está abierta. Devuelve el estado propio.
create or replace function public.queue_heartbeat()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.queue_entries
     set last_seen_at = now()
   where user_id = v_uid and status in ('waiting', 'offered', 'playing');
  return public.get_my_queue_status();
end;
$$;

-- Idempotente. La llaman pg_cron (cada 5 s) y los clientes que ven vencido un plazo.
create or replace function public.queue_tick()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_changed boolean;
begin
  if not public._queue_lock(false) then
    return jsonb_build_object('skipped', true);
  end if;
  v_changed := public._queue_advance();
  if v_changed then
    perform public.refresh_queue_snapshot();
  end if;
  return jsonb_build_object('skipped', false, 'changed', v_changed);
end;
$$;

create or replace function public.get_queue_snapshot()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('version', version, 'snapshot', snapshot, 'server_time', now())
  from public.queue_state where id = 1;
$$;

create or replace function public.update_my_display_name(p_name text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 24 then
    raise exception 'invalid_name_length' using errcode = '22023';
  end if;
  if v_name ~ '[<>[:cntrl:]]' then
    raise exception 'invalid_name_chars' using errcode = '22023';
  end if;
  if not public.is_moderator() and v_name ~* '(admin|moderador|moderator|staff|soporte)' then
    raise exception 'reserved_name' using errcode = '22023';
  end if;

  perform public._ensure_profile(v_uid);
  -- Orden de locks consistente con la fila: primero queue_state, después el perfil.
  perform public._queue_lock(true);
  update public.profiles set display_name = v_name where id = v_uid;
  perform public.refresh_queue_snapshot();
  return public.get_my_queue_status();
end;
$$;

-- =============================================================================
-- Chat
-- =============================================================================

create or replace function public.send_chat_message(p_body text)
returns public.chat_messages
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  s          public.app_settings;
  v_profile  public.profiles;
  v_body     text := regexp_replace(trim(coalesce(p_body, '')), '\s+', ' ', 'g');
  v_last     public.chat_messages;
  v_msg      public.chat_messages;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into s from public.app_settings where id = 1;
  if not s.chat_enabled then
    raise exception 'chat_disabled' using errcode = 'P0001';
  end if;

  perform public._ensure_profile(v_uid);
  select * into v_profile from public.profiles where id = v_uid for update;  -- serializa por usuario

  if v_profile.banned then
    raise exception 'banned' using errcode = '42501';
  end if;
  if v_profile.muted_until is not null and v_profile.muted_until > now() then
    raise exception 'muted' using errcode = '42501';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 280 then
    raise exception 'invalid_length' using errcode = '22023';
  end if;

  select * into v_last from public.chat_messages
   where user_id = v_uid
   order by created_at desc, id desc
   limit 1;

  if found and v_profile.role = 'user'
     and v_last.created_at > now() - make_interval(secs => s.chat_cooldown_seconds) then
    raise exception 'cooldown' using errcode = 'P0001';
  end if;
  if found and lower(v_last.body) = lower(v_body) and v_last.created_at > now() - interval '30 seconds' then
    raise exception 'duplicate' using errcode = 'P0001';
  end if;
  if v_profile.role = 'user' and not v_profile.is_vip
     and v_body ~* '(https?://|www\.|discord\.gg|[a-z0-9-]+\.(com|net|org|gg|io|xyz|ly|me|tv)\y)' then
    raise exception 'links_not_allowed' using errcode = 'P0001';
  end if;

  insert into public.chat_messages (user_id, display_name, role, is_vip, is_founder, body)
  values (v_uid, v_profile.display_name, v_profile.role, v_profile.is_vip, v_profile.is_founder, v_body)
  returning * into v_msg;
  return v_msg;
end;
$$;

create or replace function public.mod_delete_message(p_id bigint)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_moderator() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.chat_messages
     set deleted_at = now(), body = '[mensaje eliminado]'
   where id = p_id and deleted_at is null;
end;
$$;

create or replace function public.mod_mute_user(p_user_id uuid, p_minutes integer)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_moderator() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.profiles
     set muted_until = case when coalesce(p_minutes, 0) <= 0 then null
                            else now() + make_interval(mins => least(p_minutes, 60 * 24 * 30)) end
   where id = p_user_id and role = 'user';
end;
$$;

-- =============================================================================
-- Eventos de producto (embudo)
-- =============================================================================

create or replace function public.track_event(p_name text, p_visitor_id text, p_props jsonb default '{}'::jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_recent integer;
begin
  if p_name not in (
    'page_view', 'login_click', 'join_click', 'join_success', 'leave_click',
    'vip_click', 'extend_click', 'checkout_open', 'checkout_start', 'checkout_cancel',
    'mock_confirm', 'trainer_open', 'turn_offered', 'turn_confirm', 'turn_timeout',
    'chat_send', 'share_click') then
    return;
  end if;
  if p_visitor_id is null or char_length(p_visitor_id) not between 8 and 64 then
    return;
  end if;
  if p_props is not null and pg_column_size(p_props) > 2048 then
    p_props := '{}'::jsonb;
  end if;

  select count(*) into v_recent from public.events
   where visitor_id = p_visitor_id and created_at > now() - interval '1 minute';
  if v_recent >= 120 then
    return;
  end if;

  insert into public.events (visitor_id, user_id, name, props)
  values (p_visitor_id, auth.uid(), p_name, coalesce(p_props, '{}'::jsonb));
end;
$$;

-- =============================================================================
-- Pagos (solo service_role: webhooks y API de checkout)
-- =============================================================================

-- Acredita un pago aprobado. Idempotente por fulfilled_at.
--   REAL:      skip_queue → prioridad ya; extend_10 → +10 min al turno o crédito.
--   SIMULATED: todo queda como crédito de fundador (inerte hasta activar).
create or replace function public.fulfill_payment_intent(p_intent_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pi        public.payment_intents;
  v_entry     public.queue_entries;
  v_has_entry boolean;
  v_skip      integer := 0;
  v_seconds   integer := 0;
  v_result    text := 'credited';
begin
  select * into v_pi from public.payment_intents where id = p_intent_id for update;
  if not found then
    raise exception 'intent_not_found' using errcode = 'P0002';
  end if;
  if v_pi.status <> 'approved' then
    raise exception 'intent_not_approved' using errcode = 'P0001';
  end if;
  if v_pi.fulfilled_at is not null then
    return jsonb_build_object('fulfilled', true, 'already', true);
  end if;
  if v_pi.user_id is null then
    raise exception 'intent_without_user' using errcode = 'P0001';
  end if;

  case v_pi.product_code
    when 'skip_queue' then v_skip := 1;
    when 'extend_10'  then v_seconds := 600;
    when 'vip_turn'   then v_skip := 1; v_seconds := 600;
    else raise exception 'unknown_product' using errcode = '22023';
  end case;

  perform public._ensure_profile(v_pi.user_id);

  if v_pi.mode = 'SIMULATED' then
    update public.profiles
       set is_vip = true,
           is_founder = true,
           founder_priority_credits = founder_priority_credits + v_skip,
           founder_bonus_seconds = founder_bonus_seconds + v_seconds
     where id = v_pi.user_id;
    v_result := 'founder_credit';
  else
    perform public._queue_lock(true);
    update public.profiles set is_vip = true where id = v_pi.user_id;

    select * into v_entry from public.queue_entries
     where user_id = v_pi.user_id and status in ('waiting', 'offered', 'playing')
     for update;
    v_has_entry := found;

    if v_skip > 0 then
      if v_has_entry and v_entry.status = 'waiting' then
        update public.queue_entries set priority = greatest(priority, 100) where id = v_entry.id;
        v_result := 'priority_applied';
      else
        update public.profiles set priority_credits = priority_credits + v_skip where id = v_pi.user_id;
      end if;
    end if;

    if v_seconds > 0 then
      if v_has_entry and v_entry.status = 'playing' then
        update public.queue_entries
           set ends_at = ends_at + make_interval(secs => v_seconds),
               bonus_applied_seconds = bonus_applied_seconds + v_seconds
         where id = v_entry.id;
        v_result := 'time_applied';
      else
        update public.profiles set bonus_seconds = bonus_seconds + v_seconds where id = v_pi.user_id;
      end if;
    end if;

    perform public.refresh_queue_snapshot();
  end if;

  update public.payment_intents
     set fulfilled_at = now(), updated_at = now(),
         metadata = metadata || jsonb_build_object('fulfillment', v_result)
   where id = v_pi.id;

  return jsonb_build_object('fulfilled', true, 'already', false, 'result', v_result);
end;
$$;

-- Revierte créditos no consumidos de un pago reembolsado (best effort).
create or replace function public.refund_payment_intent(p_intent_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_pi      public.payment_intents;
  v_skip    integer := 0;
  v_seconds integer := 0;
begin
  select * into v_pi from public.payment_intents where id = p_intent_id for update;
  if not found or v_pi.status = 'refunded' then
    return;
  end if;
  if v_pi.fulfilled_at is not null and v_pi.user_id is not null then
    case v_pi.product_code
      when 'skip_queue' then v_skip := 1;
      when 'extend_10'  then v_seconds := 600;
      when 'vip_turn'   then v_skip := 1; v_seconds := 600;
      else null;
    end case;
    if v_pi.mode = 'SIMULATED' then
      update public.profiles
         set founder_priority_credits = greatest(0, founder_priority_credits - v_skip),
             founder_bonus_seconds = greatest(0, founder_bonus_seconds - v_seconds)
       where id = v_pi.user_id;
    else
      update public.profiles
         set priority_credits = greatest(0, priority_credits - v_skip),
             bonus_seconds = greatest(0, bonus_seconds - v_seconds)
       where id = v_pi.user_id;
    end if;
  end if;
  update public.payment_intents set status = 'refunded', updated_at = now() where id = v_pi.id;
end;
$$;

-- =============================================================================
-- Admin
-- =============================================================================

create or replace function public.admin_kick_current(p_reason text default 'kicked_by_admin')
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.queue_entries;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public._queue_lock(true);

  update public.queue_entries
     set status = 'kicked', ended_at = now(), end_reason = left(coalesce(p_reason, 'kicked_by_admin'), 120)
   where status in ('offered', 'playing')
   returning * into v_entry;

  perform public._queue_advance();
  perform public.refresh_queue_snapshot();
  return jsonb_build_object('kicked_entry_id', v_entry.id, 'kicked_user_id', v_entry.user_id);
end;
$$;

create or replace function public.admin_remove_entry(p_entry_id bigint)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public._queue_lock(true);
  update public.queue_entries
     set status = 'kicked', ended_at = now(), end_reason = 'removed_by_admin'
   where id = p_entry_id and status in ('waiting', 'offered', 'playing');
  perform public._queue_advance();
  perform public.refresh_queue_snapshot();
end;
$$;

create or replace function public.admin_clear_queue()
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public._queue_lock(true);
  update public.queue_entries
     set status = 'kicked', ended_at = now(), end_reason = 'queue_cleared'
   where status = 'waiting';
  get diagnostics v_rows = row_count;
  perform public.refresh_queue_snapshot();
  return v_rows;
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('user', 'moderator', 'admin') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

create or replace function public.admin_set_banned(p_user_id uuid, p_banned boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public._queue_lock(true);
  update public.profiles set banned = coalesce(p_banned, false) where id = p_user_id and role <> 'admin';
  if coalesce(p_banned, false) then
    update public.queue_entries
       set status = 'kicked', ended_at = now(), end_reason = 'banned'
     where user_id = p_user_id and status in ('waiting', 'offered', 'playing');
    perform public._queue_advance();
    perform public.refresh_queue_snapshot();
  end if;
end;
$$;

-- Al encender la consola: convierte los créditos de fundador en créditos activos.
create or replace function public.admin_activate_founder_credits()
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.profiles
     set priority_credits = priority_credits + founder_priority_credits,
         bonus_seconds = bonus_seconds + founder_bonus_seconds,
         founder_priority_credits = 0,
         founder_bonus_seconds = 0
   where founder_priority_credits > 0 or founder_bonus_seconds > 0;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.admin_metrics(p_days integer default 7)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 7), 90));
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'since', v_since,
    'days', v_days,
    'unique_visitors', (select count(distinct visitor_id) from public.events where created_at >= v_since),
    'unique_users', (select count(distinct user_id) from public.events where created_at >= v_since and user_id is not null),
    'signups', (select count(*) from public.profiles where created_at >= v_since),
    'page_views', (select count(*) from public.events where name = 'page_view' and created_at >= v_since),
    'join_clicks', (select count(*) from public.events where name = 'join_click' and created_at >= v_since),
    'queue_joins', (select count(*) from public.queue_entries where joined_at >= v_since),
    'turns_offered', (select count(*) from public.queue_entries where offered_at >= v_since),
    'turns_played', (select count(*) from public.queue_entries where started_at >= v_since),
    'trainer_opens', (select count(*) from public.events where name = 'trainer_open' and created_at >= v_since),
    'vip_clicks', (select count(*) from public.events where name in ('vip_click', 'extend_click') and created_at >= v_since),
    'vip_clickers', (select count(distinct visitor_id) from public.events where name in ('vip_click', 'extend_click') and created_at >= v_since),
    'checkout_opens', (select count(*) from public.events where name = 'checkout_open' and created_at >= v_since),
    'intents_by_status', coalesce((
      select jsonb_object_agg(status, c)
      from (select status::text, count(*) c from public.payment_intents
            where created_at >= v_since group by status) t), '{}'::jsonb),
    'revenue', coalesce((
      select jsonb_object_agg(currency, total)
      from (select currency, sum(amount) total from public.payment_intents
            where status = 'approved' and created_at >= v_since group by currency) t), '{}'::jsonb),
    'paying_users', (select count(distinct user_id) from public.payment_intents
                     where status = 'approved' and created_at >= v_since),
    'mock_users', (select count(distinct coalesce(user_id::text, visitor_id)) from public.payment_intents
                   where status = 'mock_completed' and created_at >= v_since),
    'by_product', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_code', product_code,
               'clicks', clicks, 'checkouts', checkouts, 'approved', approved,
               'mock_completed', mock_completed, 'revenue', revenue) order by clicks desc)
      from (select product_code,
                   count(*) clicks,
                   count(*) filter (where status not in ('clicked')) checkouts,
                   count(*) filter (where status = 'approved') approved,
                   count(*) filter (where status = 'mock_completed') mock_completed,
                   coalesce(sum(amount) filter (where status = 'approved'), 0) revenue
            from public.payment_intents where created_at >= v_since
            group by product_code) t), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', to_char(d.day, 'YYYY-MM-DD'),
               'visitors', (select count(distinct visitor_id) from public.events e
                            where e.created_at >= d.day and e.created_at < d.day + interval '1 day'),
               'joins', (select count(*) from public.queue_entries q
                         where q.joined_at >= d.day and q.joined_at < d.day + interval '1 day'),
               'vip_clicks', (select count(*) from public.events e
                              where e.name in ('vip_click', 'extend_click')
                                and e.created_at >= d.day and e.created_at < d.day + interval '1 day'),
               'approved', (select count(*) from public.payment_intents p
                            where p.status = 'approved'
                              and p.created_at >= d.day and p.created_at < d.day + interval '1 day'))
             order by d.day)
      from generate_series(v_since, date_trunc('day', now()), interval '1 day') as d(day)), '[]'::jsonb),
    'founders', (select count(*) from public.profiles where is_founder),
    'founder_credits_pending', (select count(*) from public.profiles
                                where founder_priority_credits > 0 or founder_bonus_seconds > 0),
    'queue_now', (select snapshot -> 'waiting_count' from public.queue_state where id = 1),
    'generated_at', now());
end;
$$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.profiles        enable row level security;
alter table public.app_settings    enable row level security;
alter table public.queue_entries   enable row level security;
alter table public.queue_state     enable row level security;
alter table public.chat_messages   enable row level security;
alter table public.payment_intents enable row level security;
alter table public.events          enable row level security;

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles for select using (true);

drop policy if exists settings_public_read on public.app_settings;
create policy settings_public_read on public.app_settings for select using (true);

drop policy if exists settings_admin_update on public.app_settings;
create policy settings_admin_update on public.app_settings for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists queue_public_read on public.queue_entries;
create policy queue_public_read on public.queue_entries for select using (true);

drop policy if exists queue_state_public_read on public.queue_state;
create policy queue_state_public_read on public.queue_state for select using (true);

drop policy if exists chat_public_read on public.chat_messages;
create policy chat_public_read on public.chat_messages for select using (true);

drop policy if exists payments_own_or_admin on public.payment_intents;
create policy payments_own_or_admin on public.payment_intents for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists events_admin_read on public.events;
create policy events_admin_read on public.events for select using (public.is_admin());

-- =============================================================================
-- Grants (mínimos). Supabase da ALL por defecto a anon/authenticated: lo quitamos.
-- =============================================================================

revoke all on public.profiles, public.app_settings, public.queue_entries, public.queue_state,
              public.chat_messages, public.payment_intents, public.events
  from anon, authenticated;

-- Perfiles: columnas públicas solamente (créditos, bans y mutes van por get_my_queue_status).
grant select (id, display_name, avatar_url, role, is_vip, is_founder, games_played, created_at)
  on public.profiles to anon, authenticated;

grant select on public.app_settings to anon, authenticated;
grant update (stream_mode_override, stream_provider, stream_source, stream_title,
              turn_seconds, extension_seconds, max_extensions, confirm_seconds,
              heartbeat_timeout_seconds, queue_open, chat_enabled, chat_cooldown_seconds,
              announcement)
  on public.app_settings to authenticated;

grant select (id, user_id, status, priority, joined_at, offered_at, offer_expires_at, started_at, ends_at, ended_at, extensions, end_reason)
  on public.queue_entries to anon, authenticated;
grant select on public.queue_state to anon, authenticated;
grant select on public.chat_messages to anon, authenticated;
grant select on public.payment_intents to authenticated;
grant select on public.events to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Funciones: nada ejecutable por defecto.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin()                         to anon, authenticated;
grant execute on function public.is_moderator()                     to anon, authenticated;
grant execute on function public.get_queue_snapshot()               to anon, authenticated;
grant execute on function public.get_my_queue_status()              to anon, authenticated;
grant execute on function public.track_event(text, text, jsonb)     to anon, authenticated;

grant execute on function public.join_queue()                       to authenticated;
grant execute on function public.leave_queue()                      to authenticated;
grant execute on function public.confirm_turn()                     to authenticated;
grant execute on function public.queue_heartbeat()                  to authenticated;
grant execute on function public.queue_tick()                       to authenticated;
grant execute on function public.update_my_display_name(text)       to authenticated;
grant execute on function public.send_chat_message(text)            to authenticated;
grant execute on function public.mod_delete_message(bigint)         to authenticated;
grant execute on function public.mod_mute_user(uuid, integer)       to authenticated;
grant execute on function public.admin_kick_current(text)           to authenticated;
grant execute on function public.admin_remove_entry(bigint)         to authenticated;
grant execute on function public.admin_clear_queue()                to authenticated;
grant execute on function public.admin_set_role(uuid, text)         to authenticated;
grant execute on function public.admin_set_banned(uuid, boolean)    to authenticated;
grant execute on function public.admin_activate_founder_credits()   to authenticated;
grant execute on function public.admin_metrics(integer)             to authenticated;

grant execute on all functions in schema public to service_role;

-- =============================================================================
-- Realtime
-- =============================================================================
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['queue_state', 'chat_messages', 'app_settings'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- =============================================================================
-- pg_cron: avanza la fila cada 5 segundos (si la extensión está disponible).
-- Si no lo está, la fila igual avanza: join/leave/confirm la mueven y los
-- clientes cercanos al frente llaman queue_tick() al vencer un plazo.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('queue-tick', '5 seconds', 'select public.queue_tick()');
  else
    raise notice 'pg_cron no disponible: la fila avanza por eventos y clientes';
  end if;
exception when others then
  raise notice 'No se pudo programar pg_cron (%). La fila avanza por eventos y clientes.', sqlerrm;
end $$;
