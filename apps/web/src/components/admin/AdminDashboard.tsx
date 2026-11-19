'use client';

import { Ban, ChartBar, Check, CircleCheck, Gamepad2, Power, RefreshCw, Save, Sparkles, Trash, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { mmss } from '@/lib/format';
import { formatMoney } from '@/lib/products';
import { buildEmbed } from '@/lib/stream';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import type { AppSettings, QueueSnapshot, StreamMode } from '@/lib/types';
import { Badge, Button, Panel } from '../ui';
import { ToastProvider, useToast } from '../Toasts';
import { FunnelMeters, MiniColumns, type DailyPoint } from './charts';

interface Status {
  supabase: boolean;
  serviceRole: boolean;
  checkoutProvider: 'mock' | 'mercadopago' | 'stripe';
  mercadopago: boolean;
  mercadopagoWebhookSecret: boolean;
  stripe: boolean;
  stripeWebhookSecret: boolean;
  envStreamMode: StreamMode;
  bridge: boolean;
  whep: boolean;
  streamPublishSecret: boolean;
  turn: boolean;
  appUrl: string;
}

interface Metrics {
  unique_visitors: number;
  unique_users: number;
  signups: number;
  page_views: number;
  join_clicks: number;
  queue_joins: number;
  turns_offered: number;
  turns_played: number;
  trainer_opens: number;
  vip_clicks: number;
  vip_clickers: number;
  checkout_opens: number;
  intents_by_status: Record<string, number>;
  revenue: Record<string, number>;
  paying_users: number;
  mock_users: number;
  by_product: Array<{ product_code: string; clicks: number; checkouts: number; approved: number; mock_completed: number; revenue: number }>;
  daily: DailyPoint[];
  founders: number;
  founder_credits_pending: number;
  generated_at: string;
}

interface IntentRow {
  id: string;
  user_id: string | null;
  product_code: string;
  provider: string;
  mode: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

interface QueueRow {
  id: number;
  user_id: string;
  status: string;
  priority: number;
  joined_at: string;
}

export function AdminDashboard(props: { siteName: string; initialSettings: AppSettings; effectiveMode: StreamMode; status: Status }) {
  return (
    <ToastProvider>
      <Dashboard {...props} />
    </ToastProvider>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel-2 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-1 text-2xl font-bold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

const n = (v: number | undefined) => new Intl.NumberFormat('es-AR').format(v ?? 0);
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');

function Dashboard({ siteName, initialSettings, effectiveMode, status }: { siteName: string; initialSettings: AppSettings; effectiveMode: StreamMode; status: Status }) {
  const supabase = useMemo(() => getBrowserSupabase()!, []);
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [form, setForm] = useState<AppSettings>(initialSettings);
  const [savedOverride, setSavedOverride] = useState(effectiveMode === 'SIMULATED' && initialSettings.stream_mode_override === 'SIMULATED' ? 'SIMULATED' : initialSettings.stream_mode_override);
  const [saving, setSaving] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Mismo cálculo que el servidor (lib/env.ts): env es el techo, el override solo puede forzar SIMULATED.
  // El modo mostrado es el guardado, no el del formulario sin guardar.
  const mode: StreamMode = status.envStreamMode === 'REAL' && savedOverride !== 'SIMULATED' ? 'REAL' : 'SIMULATED';

  const loadNames = useCallback(
    async (ids: string[]) => {
      const missing = [...new Set(ids)].filter((id) => id && !(id in names));
      if (!missing.length) return;
      const { data } = await supabase.from('profiles').select('id, display_name').in('id', missing);
      if (data) setNames((prev) => ({ ...prev, ...Object.fromEntries(data.map((p) => [p.id, p.display_name])) }));
    },
    [supabase, names],
  );

  const load = useCallback(async () => {
    const [m, pi, q, s] = await Promise.all([
      supabase.rpc('admin_metrics', { p_days: days }),
      supabase.from('payment_intents').select('id, user_id, product_code, provider, mode, amount, currency, status, created_at').order('created_at', { ascending: false }).limit(50),
      supabase.from('queue_entries').select('id, user_id, status, priority, joined_at').in('status', ['waiting', 'offered', 'playing']).order('priority', { ascending: false }).order('joined_at').limit(100),
      supabase.rpc('get_queue_snapshot'),
    ]);
    if (m.error) toast(errorMessage(m.error), 'error');
    else setMetrics(m.data as Metrics);
    if (pi.data) setIntents(pi.data as IntentRow[]);
    if (q.data) setQueue(q.data as QueueRow[]);
    if (s.data) setSnapshot((s.data as { snapshot: QueueSnapshot }).snapshot);
    void loadNames([...((pi.data as IntentRow[]) ?? []).map((r) => r.user_id ?? ''), ...((q.data as QueueRow[]) ?? []).map((r) => r.user_id)]);
  }, [supabase, days, toast, loadNames]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('admin-queue')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queue_state' }, (p) => setSnapshot((p.new as { snapshot: QueueSnapshot }).snapshot))
      .subscribe();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      void supabase.removeChannel(ch);
      window.clearInterval(t);
    };
  }, [supabase]);

  async function save() {
    setSaving(true);
    const { id: _id, updated_at: _u, ...patch } = form as AppSettings & { updated_by?: string };
    delete (patch as { updated_by?: string }).updated_by;
    const { data, error } = await supabase.from('app_settings').update(patch).eq('id', 1).select('*').maybeSingle();
    setSaving(false);
    if (error) return toast(errorMessage(error), 'error');
    if (data) {
      setForm(data as AppSettings);
      setSavedOverride((data as AppSettings).stream_mode_override);
    }
    toast('Configuración guardada. Ya se ve en vivo.', 'ok');
  }

  async function action(fn: () => Promise<{ error: unknown } | Response>, ok: string) {
    const r = await fn();
    const failed = r instanceof Response ? !r.ok : Boolean(r.error);
    if (failed) toast(r instanceof Response ? errorMessage((await r.json().catch(() => ({}))).error) : errorMessage(r.error), 'error');
    else toast(ok, 'ok');
    void load();
  }

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const embed = buildEmbed(form.stream_provider, form.stream_source, 'localhost');
  const cur = snapshot?.current;
  const st = metrics?.intents_by_status ?? {};
  const checkouts = Object.entries(st).filter(([k]) => k !== 'clicked').reduce((a, [, v]) => a + v, 0);
  const revenue = Object.entries(metrics?.revenue ?? {});

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
          <a href="/" className="font-black">
            <span className="text-brand">{siteName}</span> <span className="text-muted">· admin</span>
          </a>
          <Badge tone={mode === 'REAL' ? 'live' : 'info'}>modo {mode}</Badge>
          <div className="ml-auto flex items-center gap-2">
            {[1, 7, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${days === d ? 'bg-brand text-white' : 'bg-panel-2 text-muted hover:text-text'}`}>
                {d === 1 ? 'Hoy' : `${d} días`}
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Actualizar">
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          {/* KPIs de validación */}
          <Panel className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold">
              <ChartBar className="size-4 text-accent" /> ¿La gente paga? (KPI para comprar la consola)
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Visitantes únicos" value={n(metrics?.unique_visitors)} hint={`${n(metrics?.page_views)} visitas`} />
              <Tile label="Clics en “Entrar a la fila”" value={n(metrics?.join_clicks)} hint={`${n(metrics?.queue_joins)} entradas reales`} />
              <Tile label="Clics en pagos (VIP / +10)" value={n(metrics?.vip_clicks)} hint={`${n(metrics?.vip_clickers)} visitantes · ${pct(metrics?.vip_clickers ?? 0, metrics?.unique_visitors ?? 0)}`} />
              <Tile label="Checkouts iniciados" value={n(checkouts)} hint={`${n(st.clicked)} quedaron en el clic`} />
              <Tile label="Pagos aprobados" value={n(st.approved)} hint={`${n(metrics?.paying_users)} personas`} />
              <Tile label="Ingresos" value={revenue.length ? revenue.map(([c, v]) => formatMoney(Number(v), c)).join(' · ') : '—'} hint={`${n(st.refunded)} reembolsados`} />
              <Tile label="Lista de fundadores (mock)" value={n(metrics?.mock_users)} hint="dijeron “anotame” sin pagar" />
              <Tile label="Turnos jugados" value={n(metrics?.turns_played)} hint={`confirmación ${pct(metrics?.turns_played ?? 0, metrics?.turns_offered ?? 0)}`} />
            </div>
          </Panel>

          <Panel className="p-4">
            <h2 className="mb-3 font-bold">Embudo</h2>
            <FunnelMeters
              steps={[
                { label: 'Visitantes únicos', value: metrics?.unique_visitors ?? 0 },
                { label: 'Clic en entrar a la fila', value: metrics?.join_clicks ?? 0 },
                { label: 'Clic en un pago', value: metrics?.vip_clicks ?? 0 },
                { label: 'Checkout iniciado', value: checkouts },
                { label: 'Pagó (o se anotó en mock)', value: (st.approved ?? 0) + (st.mock_completed ?? 0) },
              ]}
            />
          </Panel>

          <Panel className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Por día</h2>
              <button className="text-xs font-semibold text-accent hover:underline" onClick={() => setShowTable((v) => !v)}>
                {showTable ? 'Ver gráficos' : 'Ver tabla'}
              </button>
            </div>
            {showTable ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-1.5">Día</th>
                      <th>Visitantes</th>
                      <th>Entradas a la fila</th>
                      <th>Clics en pagos</th>
                      <th>Pagos aprobados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(metrics?.daily ?? []).map((d) => (
                      <tr key={String(d.day)} className="border-t border-border/60">
                        <td className="py-1.5">{String(d.day)}</td>
                        <td>{n(Number(d.visitors))}</td>
                        <td>{n(Number(d.joins))}</td>
                        <td>{n(Number(d.vip_clicks))}</td>
                        <td>{n(Number(d.approved))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <MiniColumns title="Visitantes únicos" data={metrics?.daily ?? []} field="visitors" />
                <MiniColumns title="Entradas a la fila" data={metrics?.daily ?? []} field="joins" />
                <MiniColumns title="Clics en pagos" data={metrics?.daily ?? []} field="vip_clicks" />
                <MiniColumns title="Pagos aprobados" data={metrics?.daily ?? []} field="approved" />
              </div>
            )}
          </Panel>

          <Panel className="overflow-hidden">
            <h2 className="border-b border-border px-4 py-3 font-bold">Por producto</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2">Producto</th>
                    <th>Clics</th>
                    <th>Checkouts</th>
                    <th>Aprobados</th>
                    <th>Mock “anotame”</th>
                    <th className="pr-4">Ingresos</th>
                  </tr>
                </thead>
                <tbody>
                  {(metrics?.by_product ?? []).map((p) => (
                    <tr key={p.product_code} className="border-t border-border/60">
                      <td className="px-4 py-2 font-mono text-xs">{p.product_code}</td>
                      <td>{n(p.clicks)}</td>
                      <td>{n(p.checkouts)}</td>
                      <td>{n(p.approved)}</td>
                      <td>{n(p.mock_completed)}</td>
                      <td className="pr-4">{n(Number(p.revenue))}</td>
                    </tr>
                  ))}
                  {!metrics?.by_product?.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-faint">
                        Todavía no hay intentos de pago en este período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <h2 className="border-b border-border px-4 py-3 font-bold">Últimos payment_intents</h2>
            <div className="max-h-[420px] overflow-auto scrollbar-thin">
              <table className="w-full text-xs tabular">
                <thead className="sticky top-0 bg-panel text-left text-muted">
                  <tr>
                    <th className="px-4 py-2">Fecha</th>
                    <th>Usuario</th>
                    <th>Producto</th>
                    <th>Proveedor</th>
                    <th>Modo</th>
                    <th>Monto</th>
                    <th className="pr-4">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {intents.map((r) => (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="px-4 py-1.5">{new Date(r.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' })}</td>
                      <td className="max-w-[140px] truncate">{(r.user_id && names[r.user_id]) || '—'}</td>
                      <td className="font-mono">{r.product_code}</td>
                      <td>{r.provider}</td>
                      <td>{r.mode}</td>
                      <td>{formatMoney(Number(r.amount), r.currency)}</td>
                      <td className="pr-4">
                        <Badge tone={r.status === 'approved' ? 'ok' : r.status === 'mock_completed' ? 'founder' : r.status === 'rejected' || r.status === 'refunded' ? 'live' : 'muted'}>{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          {/* Control en vivo */}
          <Panel className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold">
              <Gamepad2 className="size-4 text-accent" /> Turno actual
            </h2>
            {cur ? (
              <div className="mb-3 rounded-xl bg-panel-2 p-3">
                <div className="font-semibold">{cur.display_name}</div>
                <div className="tabular text-sm text-muted">
                  {cur.status === 'offered' ? `confirmando · ${mmss(Date.parse(cur.offer_expires_at ?? '') - now)}` : `jugando · ${mmss(Date.parse(cur.ends_at ?? '') - now)} · ${cur.extensions} ext.`}
                </div>
              </div>
            ) : (
              <p className="mb-3 text-sm text-muted">Nadie jugando.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="danger"
                disabled={!cur}
                onClick={() =>
                  confirm('¿Patear al jugador actual y pasar al siguiente?') &&
                  void action(() => fetch('/api/admin/kick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), 'Jugador pateado')
                }
              >
                <Power className="size-4" /> Kill-switch
              </Button>
              <Button
                variant="outline"
                onClick={() => confirm('¿Vaciar la fila de espera?') && void action(async () => await supabase.rpc('admin_clear_queue'), 'Fila vaciada')}
              >
                <Trash className="size-4" /> Vaciar fila
              </Button>
            </div>
            <ol className="mt-3 max-h-64 divide-y divide-border/60 overflow-y-auto text-sm scrollbar-thin">
              {queue
                .filter((q) => q.status === 'waiting')
                .map((q, i) => (
                  <li key={q.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-6 text-right text-xs text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{names[q.user_id] ?? q.user_id.slice(0, 8)}</span>
                    {q.priority > 0 && <Badge tone="vip">vip</Badge>}
                    <button title="Sacar de la fila" className="text-faint hover:text-live" onClick={() => void action(async () => await supabase.rpc('admin_remove_entry', { p_entry_id: q.id }), 'Sacado de la fila')}>
                      <X className="size-4" />
                    </button>
                    <button title="Banear" className="text-faint hover:text-live" onClick={() => confirm('¿Banear a este usuario?') && void action(async () => await supabase.rpc('admin_set_banned', { p_user_id: q.user_id, p_banned: true }), 'Usuario baneado')}>
                      <Ban className="size-4" />
                    </button>
                  </li>
                ))}
            </ol>
          </Panel>

          {/* Settings en caliente */}
          <Panel className="space-y-4 p-4">
            <h2 className="font-bold">Configuración en vivo</h2>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Modo</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['AUTO', 'SIMULATED'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => set('stream_mode_override', v)}
                    className={`rounded-xl border p-2 text-left text-xs ${form.stream_mode_override === v ? 'border-accent bg-accent/10' : 'border-border bg-panel-2'}`}
                  >
                    <div className="font-bold">{v === 'AUTO' ? `AUTO (env: ${status.envStreamMode})` : 'Forzar SIMULATED'}</div>
                    <div className="text-muted">{v === 'AUTO' ? 'Sigue STREAM_MODE del deploy' : 'Fallback si se cae la consola'}</div>
                  </button>
                ))}
              </div>
              {status.envStreamMode !== 'REAL' && <p className="text-xs text-faint">Para pasar a REAL: STREAM_MODE=REAL + variables de Fase 2 en Vercel y redeploy.</p>}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Stream 24/7 (espectadores)</legend>
              <div className="flex gap-2">
                {(['youtube', 'kick', 'twitch', 'none'] as const).map((p) => (
                  <button key={p} onClick={() => set('stream_provider', p)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${form.stream_provider === p ? 'bg-brand text-white' : 'bg-panel-2 text-muted'}`}>
                    {p}
                  </button>
                ))}
              </div>
              <input
                value={form.stream_source}
                onChange={(e) => set('stream_source', e.target.value)}
                placeholder={form.stream_provider === 'youtube' ? 'URL del video en vivo, ID o ID de canal (UC…)' : 'URL o nombre del canal'}
                className="h-10 w-full rounded-xl border border-border bg-panel-2 px-3 text-sm outline-none focus:border-accent/60"
              />
              <p className={`flex items-center gap-1 text-xs ${embed.src || form.stream_provider === 'none' ? 'text-ok' : 'text-vip'}`}>
                {embed.src ? <CircleCheck className="size-3.5" /> : <X className="size-3.5" />}
                {embed.src ? `Reconocido: ${embed.sourceUrl}` : form.stream_provider === 'none' ? 'Sin stream' : 'No se reconoce el canal/video'}
              </p>
              <input
                value={form.stream_title}
                onChange={(e) => set('stream_title', e.target.value.slice(0, 80))}
                placeholder="Título"
                className="h-10 w-full rounded-xl border border-border bg-panel-2 px-3 text-sm outline-none focus:border-accent/60"
              />
              <p className="text-xs text-faint">Usá transmisiones propias o con permiso del creador. El reproductor se muestra con la atribución del canal.</p>
            </fieldset>

            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="col-span-2 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Turnos</legend>
              {(
                [
                  ['turn_seconds', 'Turno (s)'],
                  ['extension_seconds', 'Extensión si fila vacía (s)'],
                  ['max_extensions', 'Máx. extensiones'],
                  ['confirm_seconds', 'Confirmación (s)'],
                  ['heartbeat_timeout_seconds', 'Timeout sin heartbeat (s)'],
                  ['chat_cooldown_seconds', 'Cooldown chat (s)'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="text-xs text-muted">
                  {label}
                  <input
                    type="number"
                    value={form[k]}
                    onChange={(e) => set(k, Number(e.target.value))}
                    className="mt-1 h-9 w-full rounded-lg border border-border bg-panel-2 px-2 text-sm text-text outline-none focus:border-accent/60"
                  />
                </label>
              ))}
            </fieldset>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.queue_open} onChange={(e) => set('queue_open', e.target.checked)} /> Fila abierta
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.chat_enabled} onChange={(e) => set('chat_enabled', e.target.checked)} /> Chat habilitado
              </label>
            </div>

            <label className="block text-xs text-muted">
              Anuncio (banner)
              <input
                value={form.announcement}
                onChange={(e) => set('announcement', e.target.value.slice(0, 280))}
                className="mt-1 h-10 w-full rounded-xl border border-border bg-panel-2 px-3 text-sm text-text outline-none focus:border-accent/60"
              />
            </label>

            <Button variant="brand" className="w-full" disabled={saving} onClick={() => void save()}>
              <Save className="size-4" /> Guardar y publicar
            </Button>
          </Panel>

          {/* Fase 2 */}
          <Panel className="space-y-3 p-4">
            <h2 className="font-bold">Fase 2: checklist de consola</h2>
            <ul className="space-y-1.5 text-sm">
              {(
                [
                  ['Service role (pagos/webhooks)', status.serviceRole],
                  [`Checkout: ${status.checkoutProvider}`, status.checkoutProvider === 'mock' || (status.checkoutProvider === 'mercadopago' ? status.mercadopago : status.stripe)],
                  ['Firma de webhooks', status.checkoutProvider === 'mock' || (status.checkoutProvider === 'mercadopago' ? status.mercadopagoWebhookSecret : status.stripeWebhookSecret)],
                  ['Bridge (BRIDGE_PUBLIC_URL + secreto)', status.bridge],
                  ['Video WHEP (WHEP_URL)', status.whep],
                  ['Secreto de publicación OBS', status.streamPublishSecret],
                  ['TURN (coturn)', status.turn],
                  ['STREAM_MODE=REAL', status.envStreamMode === 'REAL'],
                ] as const
              ).map(([label, ok]) => (
                <li key={label} className="flex items-center gap-2">
                  {ok ? <Check className="size-4 text-ok" /> : <X className="size-4 text-faint" />}
                  <span className={ok ? '' : 'text-muted'}>{label}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-xl bg-panel-2 p-3 text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <Sparkles className="size-4 text-accent" /> Fundadores: {n(metrics?.founders)} · con créditos pendientes: {n(metrics?.founder_credits_pending)}
              </div>
              <p className="mt-1 text-xs text-muted">Al encender la consola, convertí las reservas en créditos activos (salto de fila / minutos).</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={mode !== 'REAL'}
                onClick={() =>
                  confirm('¿Activar los créditos de todos los fundadores?') &&
                  void action(async () => await supabase.rpc('admin_activate_founder_credits'), 'Créditos activados')
                }
              >
                Activar créditos de fundadores
              </Button>
            </div>
          </Panel>
        </aside>
      </main>
    </div>
  );
}
