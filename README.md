# JugarGTA6 — juego comunitario por turnos en la nube

Plataforma web donde la gente mira una transmisión en vivo, hace fila y toma el control de una consola
desde el navegador (joystick, teclado/mouse o pantalla táctil). Monorepo listo para **Vercel + Supabase**.

Se valida en dos fases:

| Fase | Qué funciona | Cómo se activa |
| --- | --- | --- |
| **1 · Smoke test** (sin consola) | Stream 24/7 de referencia, fila real con turnos de práctica, entrenador de controles, chat, embudo de pagos con medición en `payment_intents`, `/admin` con KPIs | `STREAM_MODE=SIMULATED` (default) |
| **2 · Consola real** | Video WebRTC (WHEP) de baja latencia para el jugador activo, inputs al mando virtual vía `bridge/`, anti-troll, kill-switch | `STREAM_MODE=REAL` + variables de Fase 2 |

> **Transparencia en Fase 1.** El sitio no simula una consola que no existe: el stream se muestra como
> "transmisión de referencia" con la atribución del canal, los turnos dicen "modo práctica", los contadores son
> reales (sin bots) y los botones pagos venden un **Pase Fundador** (reserva reembolsable que se acredita al
> encender la consola) o, con `CHECKOUT_PROVIDER=mock`, no cobran nada y muestran "todavía no estamos cobrando".
> Medís exactamente lo mismo (clic → checkout → pago) sin contracargos ni reclamos. Ver
> [`docs/ARCHITECTURE_RESEARCH.md`](docs/ARCHITECTURE_RESEARCH.md) §3.

## Estructura

```
├── apps/web/              Next.js 16 (App Router) + Tailwind 4 + Supabase + Gamepad API
├── packages/protocol/     Frame binario de 16 bytes para inputs (TS) + vectores de prueba compartidos
├── bridge/                (Fase 2) Python: WebSocket → vgamepad/ViGEmBus + filtro anti-troll
├── infra/mediamtx/        (Fase 2) Docker Compose: MediaMTX (WHIP/WHEP) + coturn + Caddy
├── supabase/
│   ├── migrations/001_init.sql   Esquema, RLS, funciones de la fila, chat, pagos, métricas, pg_cron
│   ├── sql-tests/                Tests de la migración sobre Postgres local
│   └── config.toml               Supabase local (supabase start)
└── docs/ARCHITECTURE_RESEARCH.md Investigación (morluto/rea, sitio de referencia) y arquitectura
```

---

## Deploy en 10 minutos (Supabase Cloud + Vercel)

### 1. Supabase (≈4 min)

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. **Database → Extensions**: habilitá `pg_cron` (avanza la fila cada 5 s; si no lo habilitás la fila igual
   avanza por eventos, pero más lento ante pestañas cerradas).
3. **SQL Editor**: pegá y ejecutá [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql)
   (o `npx supabase link && npx supabase db push`). Verificá el cron con `select jobname, schedule from cron.job;`.
4. **Authentication → Sign In / Providers**:
   - Activá **Allow anonymous sign-ins** (botón "Entrar como invitado").
   - Activá **Google** con tu Client ID/Secret de Google Cloud
     (redirect URI autorizado: `https://<proyecto>.supabase.co/auth/v1/callback`).
5. **Authentication → URL Configuration**: Site URL `https://tu-app.vercel.app` y en Redirect URLs agregá
   `https://tu-app.vercel.app/auth/callback` (y `http://localhost:3000/auth/callback` para local).
6. **Project Settings → API**: copiá URL, `anon`/publishable key y `service_role`/secret key.

### 2. Vercel (≈3 min)

1. **Add New → Project** e importá este repo.
2. **Root Directory**: `apps/web` (Vercel detecta Next.js y los npm workspaces).
3. **Environment Variables** (mínimo para Fase 1):

   | Variable | Valor |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |
   | `NEXT_PUBLIC_APP_URL` | `https://tu-app.vercel.app` |
   | `STREAM_MODE` | `SIMULATED` |
   | `CHECKOUT_PROVIDER` | `mock` (o `mercadopago` / `stripe`) |

4. **Deploy**.

### 3. Hacete admin y configurá el stream (≈2 min)

1. Entrá al sitio y logueate con Google.
2. En el SQL Editor:

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'tu-email@ejemplo.com');
   ```

3. Abrí `/admin` → **Stream 24/7**: elegí YouTube/Kick/Twitch, pegá la URL o ID del directo → **Guardar y publicar**.
   Se actualiza en vivo para todos, sin redeploy. Usá transmisiones propias o con permiso del creador.

---

## Desarrollo local

Requisitos: Node ≥ 20.9 (recomendado 22), Docker (para Supabase local) y Python ≥ 3.11 (solo para el bridge).

```bash
npm install
```

```bash
npx supabase start     # levanta Postgres + Auth + Realtime y aplica supabase/migrations
```

`supabase start` imprime la URL de la API (`http://127.0.0.1:54321`) y las keys. Creá `apps/web/.env.local`:

```bash
cp apps/web/.env.example apps/web/.env.local
# NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable/anon key>
# SUPABASE_SERVICE_ROLE_KEY=<secret/service_role key>
```

```bash
npm run dev            # http://localhost:3000
```

Sin variables de Supabase la página igual carga en "vista previa" (útil para diseño), con la fila y el chat desactivados.
Para ser admin en local, entrá como invitado y corré en `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`:
`update public.profiles set role = 'admin' where id = '<tu id>';` (el id aparece en `/admin`).

### Tests

```bash
npm test                     # protocolo (TS) + helpers de la web (tokens, stream, firma de Mercado Pago)
npm run typecheck
npm run build
npm run test:sql             # migración + 75 asserts de fila/pagos/chat/RLS (requiere psql y un Postgres local: PGURL=...)
npm run test:bridge          # bridge Python (pip install -r bridge/requirements-dev.txt)
```

---

## Pagos

| `CHECKOUT_PROVIDER` | Qué pasa al tocar "Pagar" |
| --- | --- |
| `mock` | Se registra el `payment_intent` (`clicked`), se muestra "todavía no estamos cobrando" y, si acepta, queda en la lista de fundadores (`mock_completed`). No se cobra nada. |
| `mercadopago` | Checkout Pro. Configurá `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` y el webhook `https://tu-app.vercel.app/api/webhooks/mercadopago` (evento **Pagos**). |
| `stripe` | Stripe Checkout. Configurá `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y el webhook `https://tu-app.vercel.app/api/webhooks/stripe` con `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` y `charge.refunded`. |

- Los webhooks verifican la firma y **vuelven a consultar el pago a la API del proveedor** antes de acreditar;
  rechazan montos menores al precio. La URL de retorno también consulta el pago (sirve en local sin webhooks).
- La acreditación es idempotente (`fulfilled_at`). En `SIMULATED` queda como crédito de fundador inerte; en
  `REAL`, "Saltar la fila" sube la prioridad al instante y "+10 min" se suma al turno en curso o al próximo.
- Al pasar a Fase 2: `/admin` → **Activar créditos de fundadores** convierte las reservas en créditos activos.
- Precios por defecto en `apps/web/src/lib/products.ts`; para testear precios sin deploy de código usá `PRODUCT_PRICES`.

### Regla de decisión (¿compro la consola?)

En `/admin` mirá **Clics en pagos / Visitantes únicos**, **Checkouts iniciados** y **Pagos aprobados** (o
**Lista de fundadores** en mock). Un umbral razonable antes de invertir: ≥ 3 % de visitantes tocando un pago y
pagos/reservas reales que cubran una parte significativa del costo de consola + juego + servidor.

---

## Fase 2: conectar la consola

1. **PC host (Windows)** con la consola por Remote Play: [Chiaki-ng](https://github.com/streetpea/chiaki-ng) (PS5)
   o [Greenlight](https://github.com/unknownskl/greenlight) (Xbox). Instalá ViGEmBus y corré el bridge
   (ver [`bridge/README.md`](bridge/README.md)); exponelo con Cloudflare Tunnel.
2. **VPS** con IP pública: `infra/mediamtx` (MediaMTX + coturn + Caddy). Ver [`infra/mediamtx/README.md`](infra/mediamtx/README.md).
3. **OBS** en la PC host: captura la ventana de Chiaki-ng/Greenlight → WHIP a `https://stream.tudominio.com/console1/whip`
   con el Bearer `STREAM_PUBLISH_SECRET`. Para espectadores, salida extra a YouTube/Kick (y ese canal en `/admin`).
4. **Vercel**: `STREAM_MODE=REAL`, `CONSOLE_PROFILE`, `BRIDGE_SHARED_SECRET`, `BRIDGE_PUBLIC_URL`, `WHEP_URL`,
   `STREAM_PUBLISH_SECRET`, `TURN_URLS`, `TURN_STATIC_AUTH_SECRET` → redeploy. El checklist de `/admin` muestra qué falta.
5. Si algo falla en vivo: `/admin` → **Forzar SIMULATED** (fallback sin redeploy) y **Kill-switch** para el jugador actual.

Revisá los términos de PlayStation Network / Xbox Network sobre uso compartido y comercial de la cuenta antes de abrir al público.

---

## Variables de entorno

Todas están documentadas en [`apps/web/.env.example`](apps/web/.env.example), [`bridge/.env.example`](bridge/.env.example)
e [`infra/mediamtx/.env.example`](infra/mediamtx/.env.example).

| Variable | Fase | Descripción |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_NAME` | 1 | Nombre del sitio |
| `NEXT_PUBLIC_APP_URL` | 1 | URL pública (back URLs de pagos, webhooks) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 1 | Cliente Supabase (navegador + servidor) |
| `SUPABASE_SERVICE_ROLE_KEY` | 1 | Solo servidor: pagos y webhooks |
| `STREAM_MODE` | 1/2 | `SIMULATED` o `REAL` (techo; `/admin` puede forzar SIMULATED) |
| `CONSOLE_PROFILE` | 2 | `ps5` o `xbox` (botones bloqueados en el HUD) |
| `CHECKOUT_PROVIDER` | 1 | `mock`, `mercadopago` o `stripe` |
| `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_WEBHOOK_SECRET` / `MERCADOPAGO_CURRENCY` | 1 | Mercado Pago |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_CURRENCY` | 1 | Stripe |
| `MOCK_CURRENCY` / `PRODUCT_PRICES` | 1 | Moneda del modo mock / precios en JSON |
| `BRIDGE_SHARED_SECRET` / `BRIDGE_PUBLIC_URL` | 2 | Tokens del bridge (≥ 32 caracteres) y su URL `wss://` |
| `WHEP_URL` / `STREAM_TOKEN_SECRET` / `STREAM_PUBLISH_SECRET` / `STREAM_PUBLIC_HLS` | 2 | Video MediaMTX |
| `TURN_URLS` / `TURN_STATIC_AUTH_SECRET` | 2 | coturn con credenciales efímeras |

## Cómo funciona la fila

- Máquina de estados en Postgres (`waiting → offered → playing → done`), con funciones `SECURITY DEFINER`;
  el cliente nunca escribe las tablas. Un solo turno activo garantizado por índice único.
- Turno de `turn_seconds` (600). Si al terminar no hay nadie esperando, se extiende `extension_seconds` (300).
- Al llegar al #1: modal "¡ES TU TURNO!" con sonido y título parpadeando; `confirm_seconds` (25) para confirmar.
- Heartbeat cada 15 s; sin heartbeat por `heartbeat_timeout_seconds` (60) sale de la fila.
- `queue_tick()` corre por pg_cron cada 5 s y además lo disparan los clientes cercanos al frente cuando vence un plazo.
- El snapshot público (turno actual + próximos 12 + contadores) se difunde por Realtime en una sola fila
  (`queue_state`) para no multiplicar consultas con miles de espectadores.

## Aviso

Proyecto independiente. No afiliado a Rockstar Games ni a Take-Two Interactive. "GTA" es una marca de sus
dueños: evaluá el riesgo de usarla en el nombre/dominio antes de lanzar.
