# Investigación y arquitectura — Fase 0

> Fecha: 2026-11-19 · Alcance: `morluto/rea` (commit `1cf9bc8`, v6.9.0) y `jogargta.com`.
> Resultado: arquitectura final del monorepo y decisiones que condicionan el MVP.

---

## 1. `morluto/rea` — qué es y qué nos sirve

### 1.1 Qué es

REA ("Reverse Engineer Anything") es un **servidor MCP + CLI** (`rea-agents` en npm, licencia MIT)
que conecta agentes de IA con herramientas de ingeniería inversa. **No es una librería de streaming
ni de control remoto**: es un set de herramientas de *análisis* que corren en local y devuelven
"Evidence" (hallazgos con su evidencia y sus límites).

Arquitectura interna (por carpetas del repo, ~9.350 archivos, TypeScript ESM, Node ≥ 22.23):

| Capa | Carpeta | Rol |
| --- | --- | --- |
| Dominio | `src/domain/**` | Parsers puros: JS/Electron, ELF/PE/Mach-O, IL2CPP, GGUF, WASM, etc. |
| Aplicación | `src/application/**` | Casos de uso (workflows) que combinan parsers y proveedores. |
| Proveedores | `src/ghidra`, `src/native`, `bridge/hopper_bridge.py`, `bridge/ghidra/*.java`, `bridge/android/*` | Adaptadores a motores externos (Ghidra, Hopper, IDA, JADX) vía sockets/IPC. |
| Navegador | `src/browser/Cdp*.ts` | Observación **pasiva** de páginas vía Chrome DevTools Protocol. |
| Capturas | `bridge/mitmproxy/capture.py`, HAR/SAZ | Lectura offline de tráfico de red grabado. |
| Entornos | `bridge/agentenv/*` | Convierte una sesión HAR en un "environment" para RL/evaluación de agentes. |
| Contratos | `src/contracts`, `docs/reference/mcp-contracts.md` | Esquemas de entrada/salida validados en el servidor. |

Patrones de diseño destacables:
- **Evidence-first**: cada resultado declara cobertura (`complete` / `partial` / `unknown`) y limitaciones.
  Nunca asume equivalencia cuando falta evidencia.
- **Puentes por proceso** (Python/Java/Swift) hablando un *wire protocol* acotado con el core en TS
  (`src/ghidra/GhidraClientWire.ts`, `GhidraRequestQueue.ts`): cola de requests, timeouts de arranque
  configurables, límites de tamaño de mensaje.
- **Límites duros en todo** (bytes de stdout, eventos CDP, frames de WebSocket) para no colgarse.

### 1.2 Herramientas relevantes para este proyecto

| Herramienta REA | Uso concreto acá |
| --- | --- |
| `rea inspect-web-page` | Capturar DOM, scripts, recursos y **tamaños de frames WebSocket** de una página abierta en tu Chrome (CDP). Sirve para ver cómo un sitio de referencia publica la fila y los inputs. |
| `rea analyze-web-bundle` / `export-web-scripts` | Extraer candidatos de rutas, **endpoints** y fingerprints de vendors (Supabase, Socket.IO, LiveKit, etc.) del bundle JS de un sitio, sin ejecutarlo. |
| `rea observe-web-session` | Grabar la secuencia de navegación/eventos mientras hacés el onboarding a mano (login → fila → confirmación). |
| `rea inspect-web-network-capture <har>` | Leer un HAR exportado desde DevTools: payloads de la API de la fila, cadencia de los inputs, tamaño de cada paquete. |
| `rea capture-process` / `compare-process-captures` | Grabar el comportamiento del `bridge/` (stdout, exit, archivos) para tests de regresión del daemon. |
| `rea environment-build <har>` | Generar un entorno reproducible de **nuestra propia** web para testear con agentes (QA automatizado de la fila y el chat). |

### 1.3 Qué integramos y qué no

- **No se integra en runtime.** REA es tooling de desarrollo (y su `DISCLAIMER.md` excluye explícitamente
  saltear protecciones, cheats o manipular servicios online). Nada de REA corre en producción.
- **Sí se adopta como herramienta de dev** documentada en este repo (ver §5.4) y se toman tres patrones:
  1. Wire protocol acotado y versionado → `packages/protocol` (frame binario fijo de 16 bytes, versión en el byte 0).
  2. Límites duros y fail-safe → el bridge suelta todos los botones si no recibe frames en 500 ms y limita a 250 Hz.
  3. Evidence/test vectors compartidos → `packages/protocol/test-vectors.json` lo consumen los tests de TS **y** de Python.

---

## 2. `jogargta.com` — ingeniería inversa funcional

### 2.1 Limitación de esta investigación

Desde el entorno de esta sesión **no fue posible acceder a `jogargta.com`** ni a los artículos que lo
cubren (el proxy de salida rechaza esos dominios). El análisis se basa en resultados de búsqueda,
cobertura de prensa indexada y en la descripción funcional del brief. Para completar con datos reales,
corré REA desde tu máquina (ver §5.4) y anexá el HAR a este documento.

Fuentes indexadas:
- [GTA 6 no navegador: projeto deixa você jogar de graça, ao vivo — Game Over Drive](https://gameoverdrive.com.br/gta-6-navegador-jogargta-10-minutos-gratis/)
- [Como jogar GTA 6 direto no seu navegador de graça — GGames](https://ggames.com.br/dicas-tutoriais/gta-6-no-navegador/)
- [Post de difusión en X](https://x.com/Chief117Br/status/2123024237258518555)

### 2.2 Hallazgos

| Aspecto | Observado / reportado |
| --- | --- |
| Hardware | Un **Xbox** con GTA VI; el sitio entrega el control del mando de esa consola. |
| Turno | **10 minutos** por persona; +5 min si la fila está vacía (brief). |
| Confirmación | Al llegar tu turno aparece **"Assumir o controle"**, con countdown de ~25-30 s; si no confirmás, pasa al siguiente. |
| Controles | Teclado o joystick en el navegador + **modo de entrenamiento** de comandos antes de jugar. |
| Anti-troll | Los **controles de sistema de la consola están bloqueados**: se puede jugar pero no tocar menús del Xbox (Guide, captura, etc.). |
| Escala | Picos reportados de **~2.500 espectadores simultáneos y ~800 en fila**. |
| Público | Solo mayores de edad (GTA es +18). |
| Monetización | Donaciones tipo LivePix (brief). No se pudo confirmar si la donación da prioridad en la fila. |

### 2.3 Lecturas de UX aplicadas al diseño

1. **Una sola página** con el stream como protagonista; fila y chat en paneles laterales (en mobile, tabs debajo del video).
2. **Stats sociales arriba** (online, en fila, partidas jugadas): con 800 en fila, el tiempo estimado es lo que más
   preguntan → lo calculamos con `posición × duración de turno`.
3. **Confirmación con sonido + título de pestaña parpadeando**: la mayoría espera en otra pestaña.
4. **Heartbeat obligatorio**: con cientos esperando, la fila se llena de pestañas cerradas. Quien no late en 60 s sale de la fila.
5. **Entrenador de controles** como "cosa que hacer mientras esperás" → retiene y reduce turnos desperdiciados.
6. **Bloqueo de botones de sistema** del lado del servidor (bridge), nunca confiando en el cliente.

---

## 3. Decisiones de producto para la Fase 1 (smoke test)

El objetivo de la Fase 1 es medir **disposición real a pagar** antes de comprar consola y juego.
Un *fake door test* bien hecho mide eso sin engañar a nadie, y es lo que implementa este repo:

| Pedido original | Implementación | Por qué |
| --- | --- | --- |
| Badge "EN VIVO • CONSOLA #1", latencia simulada, nombre de jugador "al mando" sobre un stream de terceros | En `SIMULATED` el reproductor dice **"TRANSMISIÓN DE REFERENCIA"** y atribuye el canal. El badge de consola, la latencia (medida de verdad con `RTCPeerConnection.getStats`) y el jugador al mando aparecen solo en `REAL`. | Mostrar el directo de otro como propio es engañoso y además viola los términos de YouTube/Kick (no se puede tapar ni modificar su reproductor). |
| Bots que rotan en la fila y contador de espectadores inflado | **No implementado.** Los contadores son reales (Realtime Presence + tabla de la fila). | La fila es exactamente lo que se cobra por saltar: cobrar por adelantar bots es fraude al consumidor (Ley 24.240 en AR) y te expone a contracargos y a perder la cuenta de Mercado Pago/Stripe. |
| Sesión de control "simulada" cuando un usuario llega al #1 | El turno, el countdown de 25 s y el HUD funcionan igual, pero con un aviso fijo: **"Modo práctica: la consola todavía no está conectada"**. | El usuario sabe qué está probando; igual medís retención y confirmación de turno. |
| Checkout de "Saltar la fila" / "+10 min" | En `SIMULATED` los mismos botones venden **"Pase Fundador"**: una reserva con la condición escrita en el checkout (se acredita al encender la consola; reembolsable). Con `CHECKOUT_PROVIDER=mock` no se cobra nada y se muestra el reveal "todavía no estamos cobrando, te anotamos como fundador". | Es la variante "reserva de turno fundador" que vos mismo propusiste: mide intención real (clic → checkout → pago) sin vender algo inexistente. |

Las métricas para decidir la compra de la consola quedan intactas: `payment_intents` registra cada clic,
el inicio de checkout, el pago aprobado y el monto, y `/admin` muestra el embudo completo.

---

## 4. Arquitectura final

### 4.1 Vista general

```
                ┌──────────────── Vercel ────────────────┐
 Navegador ───▶ │ Next.js (App Router)                    │
  │  ▲          │  • UI, /admin                           │
  │  │          │  • /api/checkout, /api/webhooks/*       │──▶ Mercado Pago / Stripe
  │  │          │  • /api/bridge/token (HMAC, Fase 2)     │
  │  │          │  • /api/stream/auth (hook MediaMTX)     │
  │  │          └──────────────┬──────────────────────────┘
  │  │                         │ service role
  │  │          ┌──────────────▼──────────────────────────┐
  │  └──────────│ Supabase                                │
  │   Realtime  │  • Postgres: fila como máquina de       │
  │   (chat,    │    estados en funciones SQL             │
  │   fila,     │  • pg_cron: queue_tick() cada 5 s       │
  │   presencia)│  • Auth: Google + anónimo (invitado)    │
  │             └─────────────────────────────────────────┘
  │
  │  Fase 2 (solo el jugador activo)
  ├── WHEP (WebRTC) ──▶ MediaMTX (VPS) ◀── WHIP ── OBS ◀── Chiaki-ng / Greenlight ◀── Consola
  │                       └ coturn (TURN)                          ▲
  └── WSS (frames 16 B) ─▶ bridge (PC host) ── vgamepad/ViGEmBus ──┘
```

### 4.2 La fila como máquina de estados (Postgres)

```
waiting ──(llega al #1)──▶ offered ──(confirma <25 s)──▶ playing ──(fin / se va / kick)──▶ done|kicked
   │                          │                             │
   └─(sin heartbeat 60 s)─▶ left   └─(no confirma)─▶ expired   └─(fila vacía al terminar)─▶ +5 min
```

- Toda transición vive en funciones `SECURITY DEFINER` (`join_queue`, `confirm_turn`, `queue_tick`, …): el
  cliente nunca escribe la tabla directamente.
- `queue_tick()` es **idempotente** y toma un `pg_advisory_xact_lock`: la llaman pg_cron (cada 5 s) y cualquier
  cliente que vea vencido un deadline, así el turno avanza aunque pg_cron no esté habilitado.
- Orden: `priority DESC, joined_at ASC`. El pago aprobado de "Saltar la fila" (solo en `REAL`) sube `priority`.
- Índice único parcial: una sola entrada activa por usuario.

### 4.3 Realtime

| Canal | Mecanismo | Datos |
| --- | --- | --- |
| Fila | `postgres_changes` en `queue_entries` + `queue_state` | Lista, posición, turno actual |
| Chat | `postgres_changes` INSERT en `chat_messages` | Mensajes; cooldown y anti-spam en trigger SQL |
| Online | Realtime **Presence** canal `lobby` | Conteo real de pestañas abiertas |
| Settings | `postgres_changes` en `app_settings` | Cambio de stream en caliente desde `/admin` |

### 4.4 Modos de stream

`STREAM_MODE` (env) es el techo; `app_settings.stream_mode` (`AUTO`/`SIMULATED`/`REAL`) es el switch de `/admin`:

| env `STREAM_MODE` | setting | Modo efectivo |
| --- | --- | --- |
| `SIMULATED` | cualquiera | `SIMULATED` |
| `REAL` | `AUTO` o `REAL` | `REAL` |
| `REAL` | `SIMULATED` | `SIMULATED` (fallback si se cae la consola) |

Con `AUTO` por defecto, pasar a Fase 2 es **cambiar una variable de entorno y redeployar**.

### 4.5 Pagos

- `payment_intents` registra `clicked → checkout_created → approved|rejected|cancelled|refunded`.
- Proveedor por env: `CHECKOUT_PROVIDER=mock|mercadopago|stripe`.
- Webhooks verifican firma (`x-signature` HMAC de Mercado Pago; `Stripe-Signature`) y **vuelven a consultar el
  pago a la API** antes de acreditar. Acreditación idempotente (`fulfilled_at`).
- Fulfillment según modo: `REAL` → prioridad/minutos en la fila; `SIMULATED` → `profiles.is_founder` + créditos
  (`bonus_minutes`, `priority_credits`) que se aplican automáticamente al primer turno real.

### 4.6 Fase 2: input y video

- **Protocolo** (`packages/protocol`): frame fijo de 16 bytes, little-endian.

  | Byte | Campo |
  | --- | --- |
  | 0 | versión (`1`) |
  | 1 | tipo (`1` estado, `2` ping, `3` pong) |
  | 2-3 | `seq` u16 |
  | 4-5 | botones u16 (bitmask, orden W3C Standard Gamepad) |
  | 6, 7 | LT, RT u8 |
  | 8-15 | LX, LY, RX, RY i16 |

- **Bridge** (`bridge/`, Python): WSS → valida token HMAC emitido por `/api/bridge/token` (incluye `turn_id` y
  vencimiento) → filtro anti-troll → `vgamepad` (ViGEmBus en Windows). Una sola conexión de control a la vez;
  `/kick` autenticado para el kill-switch de `/admin`.
- **Anti-troll** en el bridge: Guide/PS y Share bloqueados siempre; Options/Menu permitido solo como toque
  (< 800 ms); rate limit 250 Hz; fail-safe a neutro tras 500 ms sin frames; descarta frames fuera de orden.
- **Video**: OBS publica por WHIP a MediaMTX en un VPS; el jugador activo lee por WHEP con token (MediaMTX llama
  a `/api/stream/auth`); los espectadores ven el restream a YouTube/Kick (OBS multi-salida) o el HLS de MediaMTX.
  coturn cubre a usuarios detrás de NAT simétrico (redes móviles).
- **Host**: Chiaki-ng (PS5 Remote Play) o Greenlight (Xbox) en una PC con Windows; ambos leen el mando virtual
  creado por ViGEmBus. Revisá los términos de PlayStation Network / Xbox Live sobre uso comercial y compartido.

---

## 5. Estructura del monorepo

```
/
├── docs/ARCHITECTURE_RESEARCH.md
├── apps/web/                    Next.js 16 + Tailwind 4 + Supabase + Gamepad API
│   ├── src/app/                 page, /admin, /auth/callback, /api/*
│   ├── src/components/          Player, QueuePanel, Chat, TurnModal, ControlsHUD, Trainer, Checkout
│   ├── src/hooks/               useQueue, usePresence, useChat, useGamepadInput
│   └── src/lib/                 supabase clients, products, payments, bridge tokens
├── packages/protocol/           encoder/decoder TS + test-vectors.json
├── bridge/                      daemon Python (websockets + vgamepad) + tests
├── infra/mediamtx/              docker-compose (MediaMTX + coturn) + mediamtx.yml
└── supabase/migrations/         001_init.sql
```

- **npm workspaces** (sin turbo/pnpm: menos piezas para el deploy en Vercel). Vercel apunta a `apps/web`.
- `packages/protocol` se consume con `transpilePackages`, sin paso de build.

### 5.4 Cómo completar la investigación de la referencia con REA (desde tu máquina)

```bash
npx -y rea-agents@latest setup
# Abrí Chrome con depuración remota y entrá a la página de referencia
google-chrome --remote-debugging-port=9222
rea list-browser-targets http://127.0.0.1:9222 --json
rea inspect-web-page http://127.0.0.1:9222 TARGET_ID --observation-ms 10000 --json > capture.json
rea analyze-web-bundle http://127.0.0.1:9222 TARGET_ID --json        # endpoints, vendors, rutas
rea observe-web-session http://127.0.0.1:9222 TARGET_ID --observation-ms 60000 --json  # hacé el onboarding a mano
# DevTools → Network → "Save all as HAR" mientras hacés fila
rea inspect-web-network-capture "$PWD/session.har" har --json
```

Usalo para observar comportamiento público (UX, cadencia de inputs, tamaño de frames). No copies código,
assets ni marca del sitio de referencia, y respetá sus términos de uso.

---

## 6. Verificación realizada (2026-11-19)

| Prueba | Entorno | Resultado |
| --- | --- | --- |
| Migración + 75 asserts de fila, prioridad, pagos, chat, RLS y permisos | Postgres 16 vanilla (`supabase/sql-tests`) | OK, y re-aplicable (idempotente) |
| Migración sobre Supabase real | `supabase start` (Postgres 17, Auth, Realtime) | OK; `pg_cron` ejecuta `queue_tick()` cada 5 s |
| Protocolo de 16 bytes | Node (TS) y Python con los mismos vectores | OK en ambos lenguajes |
| Tokens HMAC web ↔ bridge | Vectores generados por la web y verificados por Python | OK |
| E2E navegador Fase 1 | Chromium + Supabase local | Login invitado → fila → "¡ES TU TURNO!" → HUD práctica; segundo usuario en fila; chat en vivo con cooldown; checkout mock → `mock_completed`; `/admin` con métricas; kill-switch pasa el turno; anuncio en caliente por Realtime; mobile sin scroll horizontal; sin errores de consola |
| E2E navegador Fase 2 | + MediaMTX 1.21.4 (Docker) + bridge Python + señal de prueba | Video WHEP 1280x720 autenticado por `/api/stream/auth`; inputs llegan al bridge (`W`→stick arriba, `Espacio`→A) y `Create` filtrado; kill-switch corta el bridge |
| Webhook de Stripe | Eventos firmados localmente | Aprobado → prioridad aplicada; reintento idempotente; monto menor → `rejected`; firma inválida → 400 |

No verificado en este entorno: Mercado Pago y Stripe contra sus APIs reales (requieren credenciales), login con
Google (requiere OAuth client) y `vgamepad` sobre ViGEmBus (requiere Windows).
