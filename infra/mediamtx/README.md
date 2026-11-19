# infra/mediamtx — video WebRTC (Fase 2)

```
Consola ──HDMI/Remote Play──▶ PC host (OBS) ──WHIP──▶ VPS: Caddy ▶ MediaMTX ──WHEP──▶ jugador activo
                                                          coturn (TURN) ◀────────────┘ (si hay NAT estricto)
```

## Requisitos

- VPS Linux con IP pública (2 vCPU / 2 GB alcanza para 1 consola; MediaMTX no transcodifica).
- Un dominio (`stream.tudominio.com`) apuntando al VPS.
- Puertos abiertos: `80,443/tcp` (Caddy), `8189/udp+tcp` (media WebRTC), `3478/udp+tcp` y `5349/tcp` (TURN),
  `49160-49200/udp` (relay TURN).

## Levantar

```bash
cp .env.example .env    # completar
docker compose up -d
docker compose logs -f mediamtx
```

## Publicar desde OBS (≥ 30)

1. Ajustes → Emisión → Servicio **WHIP**.
2. Servidor: `https://stream.tudominio.com/console1/whip`
3. Bearer token: el valor de `STREAM_PUBLISH_SECRET` (definido en las variables de Vercel).
4. Salida: x264/NVENC, **CBR 6000 kbps**, keyframe cada **1 s**, perfil baseline/main, sin B-frames, 1080p60 o 720p60.

Para que los espectadores vean el juego, agregá en OBS una segunda salida (plugin *Multiple RTMP outputs*)
hacia YouTube/Kick y configurá ese canal en `/admin`. Alternativa: `STREAM_PUBLIC_HLS=1` en Vercel para servir
LL-HLS desde este mismo VPS (más carga de ancho de banda).

## Cómo autentica

MediaMTX llama a `POST {APP_URL}/api/stream/auth` en cada publish/read con
`{ action, path, protocol, token, query, ip, ... }`.

| Acción | Regla |
| --- | --- |
| `publish` en `console1` | token = `STREAM_PUBLISH_SECRET` |
| `read` por `webrtc` | token firmado `aud=stream`, vigente, del turno activo |
| `read` por `hls` | permitido solo si `STREAM_PUBLIC_HLS=1` |
| resto | 401 |

## Probar sin consola

```bash
# Publicar una señal de prueba por WHIP con GStreamer (o usá OBS con una escena cualquiera)
gst-launch-1.0 videotestsrc is-live=true ! videoconvert ! x264enc tune=zerolatency bitrate=2000 key-int-max=30 \
  ! rtph264pay ! whipclientsink signaller::whip-endpoint="https://stream.tudominio.com/console1/whip" \
  signaller::auth-token="$STREAM_PUBLISH_SECRET"
```
