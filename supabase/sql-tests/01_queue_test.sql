-- Tests de la migración 001 sobre Postgres vanilla + 00_supabase_stub.sql
-- Uso: supabase/sql-tests/run.sh
\set ON_ERROR_STOP on
\set QUIET on

create schema if not exists t;
create or replace function t.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
end $$;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'ASSERT FAILED: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;
-- Ejecuta SQL y verifica que falle con un mensaje que contiene p_expect.
create or replace function t.fails(p_sql text, p_expect text, msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_expect in sqlerrm) > 0 then
      raise notice 'ok - % (%)', msg, sqlerrm;
      return;
    end if;
    raise exception 'ASSERT FAILED: % — error inesperado: %', msg, sqlerrm;
  end;
  raise exception 'ASSERT FAILED: % — no falló', msg;
end $$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- Usuarios -------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@example.com', '{"full_name":"Ana María Pérez"}', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', null, '{}', true),
  ('cccccccc-0000-0000-0000-000000000003', 'c@example.com', '{"name":"Carla"}', false),
  ('dddddddd-0000-0000-0000-000000000004', 'd@example.com', '{}', false),
  ('eeeeeeee-0000-0000-0000-000000000005', 'e@example.com', '{"full_name":"Enzo"}', false),
  ('ffffffff-0000-0000-0000-000000000006', 'f@example.com', '{"full_name":"Fede"}', false),
  ('99999999-0000-0000-0000-000000000007', 'g@example.com', '{"full_name":"Gabi"}', false);
update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

do $$ begin
  perform t.ok((select display_name from profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'Ana P.', 'nombre corto desde full_name');
  perform t.ok((select display_name from profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002') = 'Invitado-BBBB', 'nombre de invitado');
  perform t.ok((select display_name from profiles where id = 'dddddddd-0000-0000-0000-000000000004') = 'Jugador-DDDD', 'sin nombre no usa el email');
end $$;

-- Permisos de tablas -----------------------------------------------------------
set role anon;
do $$ begin
  perform t.ok((select count(*) from profiles) = 7, 'anon lee columnas públicas de profiles');
  perform t.fails('select bonus_seconds from profiles', 'permission denied', 'anon no lee créditos');
  perform t.fails('select * from payment_intents', 'permission denied', 'anon no lee pagos');
  perform t.fails('select join_queue()', 'permission denied', 'anon no puede entrar a la fila');
  perform t.ok((select count(*) from queue_state) = 1, 'anon lee queue_state');
  perform track_event('page_view', 'visitor-anon-1', '{"path":"/"}');
  perform track_event('evento_no_permitido', 'visitor-anon-1', '{}');
end $$;
reset role;
do $$ begin
  perform t.ok((select count(*) from events) = 1, 'track_event filtra nombres');
end $$;

select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$ begin
  perform t.fails($q$insert into queue_entries (user_id) values ('bbbbbbbb-0000-0000-0000-000000000002')$q$, 'permission denied', 'no se inserta en la fila directo');
end $$;
reset role;

do $$ begin
  perform t.ok((select turn_seconds from app_settings) = 600, 'settings intactos');
end $$;

-- Flujo de fila ----------------------------------------------------------------
-- B entra con la fila vacía → oferta inmediata.
select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$
declare r jsonb;
begin
  r := join_queue();
  perform t.ok(r -> 'entry' ->> 'status' = 'offered', 'fila vacía: el primero recibe oferta');
  r := join_queue();
  perform t.ok(r -> 'entry' ->> 'status' = 'offered', 'join es idempotente');
end $$;
reset role;

select t.as_user('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
do $$
declare r jsonb;
begin
  r := join_queue();
  perform t.ok(r -> 'entry' ->> 'status' = 'waiting' and (r ->> 'position')::int = 1, 'C espera en posición 1');
  perform t.fails('select confirm_turn()', 'no_offer', 'C no puede confirmar sin oferta');
end $$;
reset role;

select t.as_user('dddddddd-0000-0000-0000-000000000004');
set role authenticated;
do $$
declare r jsonb;
begin
  r := join_queue();
  perform t.ok((r ->> 'position')::int = 2, 'D en posición 2');
end $$;
reset role;

do $$
declare s jsonb := (select snapshot from queue_state);
begin
  perform t.ok(s -> 'current' ->> 'display_name' = 'Invitado-BBBB', 'snapshot: turno actual');
  perform t.ok(jsonb_array_length(s -> 'next') = 2 and (s ->> 'waiting_count')::int = 2, 'snapshot: próximos y conteo');
  perform t.ok(s -> 'next' -> 0 ->> 'display_name' = 'Carla', 'snapshot: orden de llegada');
end $$;

-- B confirma.
select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
do $$
declare r jsonb;
begin
  r := confirm_turn();
  perform t.ok(r -> 'entry' ->> 'status' = 'playing', 'B confirma y juega');
  perform t.ok((r -> 'entry' ->> 'ends_at')::timestamptz between now() + interval '599 seconds' and now() + interval '601 seconds', 'turno de 10 min');
end $$;
reset role;

do $$ begin
  perform t.ok((select games_played from queue_state) = 1, 'partidas jugadas = 1');
  perform t.ok((select games_played from profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002') = 1, 'contador por perfil');
end $$;

-- Tick sin cambios no reescribe el snapshot.
do $$
declare v0 bigint := (select version from queue_state); r jsonb;
begin
  r := queue_tick();
  perform t.ok((r ->> 'changed')::boolean = false, 'tick sin vencimientos no cambia nada');
  perform t.ok((select version from queue_state) = v0, 'versión del snapshot estable');
end $$;

-- Se vence el turno de B con gente esperando → termina y se ofrece a C.
update queue_entries set ends_at = now() - interval '1 second'
 where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and status = 'playing';
select queue_tick();
do $$ begin
  perform t.ok((select status from queue_entries where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' order by id desc limit 1) = 'done', 'turno vencido termina');
  perform t.ok((select status from queue_entries where user_id = 'cccccccc-0000-0000-0000-000000000003' order by id desc limit 1) = 'offered', 'siguiente recibe oferta');
end $$;

-- C no confirma a tiempo → expira y pasa a D.
update queue_entries set offer_expires_at = now() - interval '1 second'
 where user_id = 'cccccccc-0000-0000-0000-000000000003' and status = 'offered';
select t.as_user('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
do $$ begin
  perform t.fails('select confirm_turn()', 'offer_expired', 'no se confirma una oferta vencida');
end $$;
reset role;
select queue_tick();
do $$ begin
  perform t.ok((select end_reason from queue_entries where user_id = 'cccccccc-0000-0000-0000-000000000003' order by id desc limit 1) = 'not_confirmed', 'oferta vencida → expired');
  perform t.ok((select status from queue_entries where user_id = 'dddddddd-0000-0000-0000-000000000004' order by id desc limit 1) = 'offered', 'D recibe oferta');
end $$;

-- D confirma; vence con la fila vacía → +5 min.
select t.as_user('dddddddd-0000-0000-0000-000000000004');
set role authenticated;
select confirm_turn() is not null as confirmed;
reset role;
update queue_entries set ends_at = now() - interval '1 second'
 where user_id = 'dddddddd-0000-0000-0000-000000000004' and status = 'playing';
select queue_tick();
do $$
declare e queue_entries;
begin
  select * into e from queue_entries where user_id = 'dddddddd-0000-0000-0000-000000000004' order by id desc limit 1;
  perform t.ok(e.status = 'playing' and e.extensions = 1, 'fila vacía → se extiende el turno');
  perform t.ok(e.ends_at between now() + interval '299 seconds' and now() + interval '301 seconds', 'extensión de 5 min');
end $$;

-- E entra y cierra la pestaña: sin heartbeat → sale.
select t.as_user('eeeeeeee-0000-0000-0000-000000000005');
set role authenticated;
select (join_queue() -> 'entry' ->> 'status') as e_status;
reset role;
update queue_entries set last_seen_at = now() - interval '5 minutes'
 where user_id = 'eeeeeeee-0000-0000-0000-000000000005' and status = 'waiting';
select queue_tick();
do $$ begin
  perform t.ok((select end_reason from queue_entries where user_id = 'eeeeeeee-0000-0000-0000-000000000005' order by id desc limit 1) = 'heartbeat_timeout', 'sin heartbeat sale de la fila');
end $$;

-- Prioridad paga (modo REAL) ----------------------------------------------------
select t.as_user('ffffffff-0000-0000-0000-000000000006');
set role authenticated;
select (join_queue() ->> 'position') as f_position;
reset role;
select t.as_user('99999999-0000-0000-0000-000000000007');
set role authenticated;
select (join_queue() ->> 'position') as g_position;
reset role;

insert into payment_intents (id, user_id, product_code, provider, mode, amount, currency, status)
values ('11111111-1111-1111-1111-111111111111', '99999999-0000-0000-0000-000000000007', 'skip_queue', 'stripe', 'REAL', 3, 'USD', 'approved');
set role service_role;
select fulfill_payment_intent('11111111-1111-1111-1111-111111111111');
select (fulfill_payment_intent('11111111-1111-1111-1111-111111111111') ->> 'already') as second_call_already;
reset role;
do $$ begin
  perform t.ok((select snapshot -> 'next' -> 0 ->> 'display_name' from queue_state) = 'Gabi', 'skip_queue REAL: G pasa adelante');
  perform t.ok((select snapshot -> 'next' -> 0 ->> 'skipped' from queue_state)::boolean, 'snapshot marca el salto');
  perform t.ok((select is_vip from profiles where id = '99999999-0000-0000-0000-000000000007'), 'pagador queda VIP');
  perform t.ok((select priority from queue_entries where user_id = '99999999-0000-0000-0000-000000000007' and status = 'waiting') = 100, 'prioridad aplicada una vez');
end $$;

-- +10 min mientras juega (REAL).
insert into payment_intents (id, user_id, product_code, provider, mode, amount, currency, status)
values ('22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000004', 'vip_turn', 'mercadopago', 'REAL', 5000, 'ARS', 'approved');
do $$
declare before timestamptz := (select ends_at from queue_entries where user_id = 'dddddddd-0000-0000-0000-000000000004' and status = 'playing');
begin
  perform fulfill_payment_intent('22222222-2222-2222-2222-222222222222');
  perform t.ok((select ends_at from queue_entries where user_id = 'dddddddd-0000-0000-0000-000000000004' and status = 'playing') = before + interval '600 seconds', 'vip_turn suma 10 min al turno en curso');
  perform t.ok((select priority_credits from profiles where id = 'dddddddd-0000-0000-0000-000000000004') = 1, 'el salto queda como crédito si ya está jugando');
end $$;

-- Pago en modo SIMULATED → crédito de fundador, sin tocar la fila.
insert into payment_intents (id, user_id, product_code, provider, mode, amount, currency, status)
values ('33333333-3333-3333-3333-333333333333', 'ffffffff-0000-0000-0000-000000000006', 'vip_turn', 'mercadopago', 'SIMULATED', 5000, 'ARS', 'approved');
select fulfill_payment_intent('33333333-3333-3333-3333-333333333333');
do $$
declare p profiles;
begin
  select * into p from profiles where id = 'ffffffff-0000-0000-0000-000000000006';
  perform t.ok(p.is_founder and p.founder_priority_credits = 1 and p.founder_bonus_seconds = 600, 'SIMULATED: créditos de fundador');
  perform t.ok(p.priority_credits = 0 and p.bonus_seconds = 0, 'SIMULATED: créditos activos intactos');
  perform t.ok((select priority from queue_entries where user_id = 'ffffffff-0000-0000-0000-000000000006' and status = 'waiting') = 0, 'SIMULATED: no adelanta en la fila');
end $$;

-- Pago no aprobado no se acredita.
insert into payment_intents (id, user_id, product_code, provider, mode, amount, currency, status)
values ('44444444-4444-4444-4444-444444444444', 'ffffffff-0000-0000-0000-000000000006', 'skip_queue', 'stripe', 'REAL', 3, 'USD', 'pending');
do $$ begin
  perform t.fails($q$select fulfill_payment_intent('44444444-4444-4444-4444-444444444444')$q$, 'intent_not_approved', 'pendiente no se acredita');
end $$;
set role authenticated;
do $$ begin
  perform t.fails($q$select fulfill_payment_intent('33333333-3333-3333-3333-333333333333')$q$, 'permission denied', 'clientes no acreditan pagos');
end $$;
reset role;

-- Reembolso revierte créditos no consumidos.
select refund_payment_intent('33333333-3333-3333-3333-333333333333');
do $$ begin
  perform t.ok((select founder_priority_credits + founder_bonus_seconds from profiles where id = 'ffffffff-0000-0000-0000-000000000006') = 0, 'reembolso revierte créditos');
end $$;

-- Admin --------------------------------------------------------------------------
select t.as_user('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
do $$ begin
  perform t.fails('select admin_kick_current()', 'forbidden', 'no-admin no patea');
  perform t.fails('select admin_metrics(7)', 'forbidden', 'no-admin no ve métricas');
  update app_settings set turn_seconds = 30;  -- RLS: 0 filas
  perform t.ok((select turn_seconds from app_settings) = 600, 'no-admin no cambia settings (RLS)');
end $$;
reset role;

select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
do $$
declare r jsonb; m jsonb;
begin
  update app_settings set turn_seconds = 300, stream_provider = 'kick', stream_source = 'canal-demo';
  perform t.ok((select turn_seconds from app_settings) = 300, 'admin cambia settings en caliente');
  perform t.ok((select updated_by from app_settings) = 'aaaaaaaa-0000-0000-0000-000000000001', 'updated_by registrado');
  r := admin_kick_current('test');
  perform t.ok((r ->> 'kicked_user_id')::uuid = 'dddddddd-0000-0000-0000-000000000004', 'kill-switch patea al jugador actual');
  m := admin_metrics(7);
  perform t.ok((m ->> 'turns_played')::int = 2, 'métricas: turnos jugados');
  perform t.ok((m -> 'revenue' ->> 'USD')::numeric = 3, 'métricas: ingresos por moneda');
  perform t.ok(jsonb_array_length(m -> 'daily') = 7, 'métricas: serie diaria');
end $$;
reset role;
do $$ begin
  perform t.ok((select snapshot -> 'current' ->> 'display_name' from queue_state) = 'Gabi', 'tras el kick se ofrece al siguiente (G con prioridad)');
end $$;

-- Activación de créditos de fundador.
update profiles set founder_priority_credits = 1, founder_bonus_seconds = 600, is_founder = true
 where id = 'eeeeeeee-0000-0000-0000-000000000005';
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select admin_activate_founder_credits() as activated;
reset role;
select t.as_user('eeeeeeee-0000-0000-0000-000000000005');
set role authenticated;
do $$
declare r jsonb;
begin
  r := join_queue();
  perform t.ok((r -> 'entry' ->> 'priority')::int = 100, 'crédito activado se consume al entrar');
  perform t.ok((r ->> 'position')::int = 1, 'fundador entra primero');
  perform t.ok((r -> 'profile' ->> 'priority_credits')::int = 0, 'crédito consumido');
  perform t.ok((r -> 'profile' ->> 'bonus_seconds')::int = 600, 'bonus pendiente para el turno');
end $$;
reset role;

-- Leave mientras juega → pasa al siguiente.
select t.as_user('99999999-0000-0000-0000-000000000007');
set role authenticated;
select (confirm_turn() -> 'entry' ->> 'status') as g_status;
select (leave_queue() ->> 'in_queue') as g_in_queue;
reset role;
do $$ begin
  perform t.ok((select end_reason from queue_entries where user_id = '99999999-0000-0000-0000-000000000007' order by id desc limit 1) = 'ended_by_player', 'terminar turno propio');
  perform t.ok((select snapshot -> 'current' ->> 'display_name' from queue_state) = 'Enzo', 'siguiente: fundador con prioridad');
end $$;

select t.as_user('eeeeeeee-0000-0000-0000-000000000005');
set role authenticated;
do $$
declare r jsonb;
begin
  r := confirm_turn();
  perform t.ok((r -> 'entry' ->> 'ends_at')::timestamptz between now() + interval '899 seconds' and now() + interval '901 seconds', 'bonus de 10 min aplicado al confirmar (300 + 600)');
end $$;
reset role;

-- Chat ----------------------------------------------------------------------------
select t.as_user('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
do $$
declare m chat_messages;
begin
  m := send_chat_message('  hola   fila  ');
  perform t.ok(m.body = 'hola fila' and m.display_name = 'Carla', 'mensaje normalizado y con nombre del servidor');
  perform t.fails($q$select send_chat_message('otro')$q$, 'cooldown', 'cooldown de 3 s');
end $$;
reset role;
update chat_messages set created_at = now() - interval '10 seconds' where user_id = 'cccccccc-0000-0000-0000-000000000003';
select t.as_user('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
do $$ begin
  perform t.fails($q$select send_chat_message('HOLA FILA')$q$, 'duplicate', 'anti-duplicado');
  perform t.fails($q$select send_chat_message('entren a miweb.com ya')$q$, 'links_not_allowed', 'links bloqueados');
  perform t.fails($q$select send_chat_message(repeat('x', 281))$q$, 'invalid_length', 'largo máximo');
  perform t.fails($q$insert into chat_messages (user_id, display_name, body) values (auth.uid(), 'ADMIN', 'fake')$q$, 'permission denied', 'no se inserta chat directo');
  perform t.fails($q$select update_my_display_name('Admin Oficial')$q$, 'reserved_name', 'nombres reservados');
  perform t.ok((update_my_display_name('Carla G') -> 'profile' ->> 'display_name') = 'Carla G', 'cambiar nombre');
end $$;
reset role;

select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select mod_mute_user('cccccccc-0000-0000-0000-000000000003', 10);
reset role;
update chat_messages set created_at = now() - interval '60 seconds' where user_id = 'cccccccc-0000-0000-0000-000000000003';
select t.as_user('cccccccc-0000-0000-0000-000000000003');
set role authenticated;
do $$ begin
  perform t.fails($q$select send_chat_message('ya puedo?')$q$, 'muted', 'usuario silenciado');
end $$;
reset role;

-- Ban saca de la fila.
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select admin_set_banned('ffffffff-0000-0000-0000-000000000006', true);
reset role;
do $$ begin
  perform t.ok(not exists (select 1 from queue_entries where user_id = 'ffffffff-0000-0000-0000-000000000006' and status in ('waiting','offered','playing')), 'ban saca de la fila');
end $$;
select t.as_user('ffffffff-0000-0000-0000-000000000006');
set role authenticated;
do $$ begin
  perform t.fails('select join_queue()', 'banned', 'baneado no entra');
end $$;
reset role;

-- Invariante: un solo turno activo.
do $$ begin
  perform t.ok((select count(*) from queue_entries where status in ('offered','playing')) <= 1, 'invariante: un turno activo');
  perform t.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime') = 3, 'tablas en Realtime');
end $$;

\echo 'ALL SQL TESTS PASSED'
