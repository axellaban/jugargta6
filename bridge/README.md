# bridge — WebSocket → mando virtual (Fase 2)

Daemon en Python que corre en la **PC host** (la que tiene Chiaki-ng / Greenlight conectado a la consola).
Recibe los frames de 16 bytes de `packages/protocol` desde el navegador del jugador activo, aplica el
filtro anti-troll y los inyecta en un mando virtual con [vgamepad](https://github.com/yannbouteiller/vgamepad)
(ViGEmBus en Windows).

```
Navegador ──wss──▶ cloudflared ──ws──▶ bridge (127.0.0.1:8765) ──ViGEmBus──▶ DS4/X360 virtual ──▶ Chiaki-ng ──▶ PS5
```

## Seguridad y anti-troll

| Mecanismo | Detalle |
| --- | --- |
| Autenticación | Primer mensaje `{"type":"auth","token":…}` con token HMAC (`aud=bridge`) emitido por `/api/session/credentials` solo para quien tiene el turno. Vence en ≤ 60 s y nunca después del fin del turno; el cliente lo renueva cada 30 s. |
| Una sola conexión | Un token de un turno más nuevo reemplaza al anterior (`4409 replaced`). Turnos viejos o pateados: `4403`. |
| Kill-switch | `GET /kick?turn=<id>` con `Authorization: Bearer <token aud=bridge-admin>` (lo llama `/admin`). |
| Botones de sistema | `ps5`: PS y Create/Share bloqueados siempre. `xbox`: Guide bloqueado. Options/Menu solo como toque (< 800 ms). |
| Fail-safe | Sin frames durante 500 ms → mando en neutro. Al desconectar → neutro. |
| Rate limit | 250 frames/s por conexión; frames fuera de orden (seq u16) se descartan. |
| Origin | `BRIDGE_ALLOWED_ORIGINS` rechaza conexiones desde otros sitios. |

## Instalar (Windows, PC host)

1. Instalá [ViGEmBus](https://github.com/nefarius/ViGEmBus/releases) (driver del mando virtual).
2. Python 3.11+:

   ```powershell
   cd bridge
   py -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   copy .env.example .env   # completar BRIDGE_SHARED_SECRET (el mismo que en Vercel)
   ```

3. Probá sin consola (imprime cada input):

   ```powershell
   $env:BRIDGE_SHARED_SECRET="<secreto>"; py -m jugar_bridge --backend log
   ```

4. Con mando virtual (abrí Chiaki-ng y verificá en su test de controles que aparece el DS4 virtual):

   ```powershell
   py -m jugar_bridge --backend vgamepad --target ds4 --profile ps5
   ```

   Si el eje vertical sale invertido en tu cliente: `--invert-ds4-y`.

## Exponerlo a internet (sin abrir puertos)

Con [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```powershell
cloudflared tunnel --url http://127.0.0.1:8765
# o un túnel con nombre apuntando bridge.tudominio.com → http://127.0.0.1:8765
```

Configurá en Vercel `BRIDGE_PUBLIC_URL=wss://bridge.tudominio.com/control`.

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest -q
```

Los tests de protocolo y de tokens usan los mismos vectores que la web
(`packages/protocol/test-vectors.json`), así que una diferencia entre TypeScript y Python rompe ambos.

## Términos de servicio

Revisá los términos de PlayStation Network / Xbox Network sobre uso compartido y comercial de tu cuenta y
de Remote Play antes de abrir el servicio al público.
