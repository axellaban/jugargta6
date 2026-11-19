"""Servidor WebSocket del bridge.

Flujo de una conexión de control:
  1. El navegador abre ws(s)://<bridge>/control.
  2. Primer mensaje (texto, < 5 s): {"type": "auth", "token": "<token aud=bridge>"}.
     El token lo emite /api/bridge/token solo para quien tiene el turno activo y vence
     como mucho al final del turno (y a los 60 s). El cliente lo renueva enviando otro
     "auth" antes de que venza; si no, se corta la conexión.
  3. Frames binarios de 16 bytes (packages/protocol). PING → PONG con el mismo timestamp.
Garantías:
  - Una sola conexión de control: un token de un turno más nuevo reemplaza al anterior.
  - Fail-safe: sin frames durante idle_timeout_ms → mando en neutro.
  - Filtro anti-troll y rate limit del lado del servidor.
Endpoints HTTP: GET /health, GET /kick?turn=<id|-1> con "Authorization: Bearer <token aud=bridge-admin>".
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from http import HTTPStatus
from urllib.parse import parse_qs, urlsplit

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from .backends import Backend
from .config import Config
from .filter import AntiTrollFilter, RateLimiter
from .protocol import NEUTRAL, TYPE_PING, TYPE_PONG, StateFrame, TimedFrame, decode_frame, encode_timed, is_newer_seq
from .tokens import TokenError, verify

log = logging.getLogger("bridge")

CLOSE_BAD_AUTH = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_REPLACED = 4409
CLOSE_KICKED = 4410
CLOSE_PROTOCOL = 4400


class Bridge:
    def __init__(self, cfg: Config, backend: Backend):
        self.cfg = cfg
        self.backend = backend
        self.filter = AntiTrollFilter(cfg.profile, cfg.hold_limit_ms, cfg.extra_blocked)
        self.active: ServerConnection | None = None
        self.active_turn = -1
        self.active_sub: str | None = None
        self.active_exp = 0.0
        self.kicked_turns: set[int] = set()
        self.last_seq: int | None = None
        self.last_frame_at = 0.0
        self.idle_neutral = True
        self.stats = {"frames": 0, "dropped": 0, "invalid": 0, "blocked": 0}
        self._watchdog: asyncio.Task | None = None
        self.server: Server | None = None

    # ------------------------------------------------------------------ HTTP
    async def process_request(self, connection: ServerConnection, request):
        url = urlsplit(request.path)
        if url.path == "/health":
            body = {
                "ok": True,
                "backend": self.backend.name,
                "profile": self.cfg.profile,
                "active": self.active is not None,
                "turn": self.active_turn if self.active is not None else None,
            }
            return connection.respond(HTTPStatus.OK, json.dumps(body) + "\n")
        if url.path == "/kick":
            auth = request.headers.get("Authorization", "")
            token = auth[7:] if auth.lower().startswith("bearer ") else ""
            try:
                verify(token, self.cfg.secret, "bridge-admin")
            except TokenError as exc:
                return connection.respond(HTTPStatus.UNAUTHORIZED, f"unauthorized: {exc}\n")
            try:
                turn = int(parse_qs(url.query).get("turn", ["-1"])[0])
            except ValueError:
                return connection.respond(HTTPStatus.BAD_REQUEST, "bad turn\n")
            kicked = await self.kick(turn)
            return connection.respond(HTTPStatus.OK, json.dumps({"kicked": kicked}) + "\n")
        if url.path not in ("/", "/control"):
            return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")
        return None  # sigue el handshake WebSocket

    async def kick(self, turn: int) -> bool:
        target = self.active_turn if turn == -1 else turn
        if target >= 0:
            self.kicked_turns.add(target)
        if self.active is not None and (turn == -1 or self.active_turn == turn):
            ws = self.active
            await self._release(ws)
            await self._send_json(ws, {"type": "kicked"})
            await ws.close(CLOSE_KICKED, "kicked")
            return True
        return False

    # ------------------------------------------------------------- WebSocket
    async def handler(self, ws: ServerConnection) -> None:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=self.cfg.auth_timeout_s)
        except (asyncio.TimeoutError, ConnectionClosed):
            await ws.close(CLOSE_BAD_AUTH, "auth_timeout")
            return
        tok = self._parse_auth(raw)
        if tok is None:
            await ws.close(CLOSE_BAD_AUTH, "bad_token")
            return
        if tok.turn in self.kicked_turns or tok.turn < self.active_turn:
            await ws.close(CLOSE_FORBIDDEN, "turn_not_active")
            return

        previous = self.active
        self.active = ws
        self.active_turn = tok.turn
        self.active_sub = tok.sub
        self.active_exp = tok.exp
        self.last_seq = None
        self.last_frame_at = time.monotonic()
        self.filter.reset()
        self.backend.neutral()
        self.idle_neutral = True
        if previous is not None and previous is not ws:
            await self._send_json(previous, {"type": "replaced"})
            await previous.close(CLOSE_REPLACED, "replaced")

        log.info("control: turno %s (%s) conectado", tok.turn, tok.sub)
        await self._send_json(ws, {"type": "ready", "turn": tok.turn, "exp": tok.exp, **self.filter.describe()})

        limiter = RateLimiter(self.cfg.max_rate, burst=max(10, int(self.cfg.max_rate // 5)))
        try:
            async for message in ws:
                if self.active is not ws:
                    break
                if time.time() > self.active_exp + 5:
                    await ws.close(CLOSE_BAD_AUTH, "token_expired")
                    break
                if isinstance(message, str):
                    await self._handle_text(ws, message)
                    continue
                await self._handle_binary(ws, message, limiter)
        except ConnectionClosed:
            pass
        finally:
            if self.active is ws:
                await self._release(ws)
                self.active = None
                log.info("control: turno %s desconectado", self.active_turn)

    def _parse_auth(self, raw):
        if not isinstance(raw, str):
            return None
        try:
            msg = json.loads(raw)
            if msg.get("type") != "auth":
                return None
            return verify(msg.get("token", ""), self.cfg.secret, "bridge")
        except (ValueError, AttributeError, TokenError) as exc:
            log.warning("auth rechazada: %s", exc)
            return None

    async def _handle_text(self, ws: ServerConnection, message: str) -> None:
        tok = self._parse_auth(message)
        if tok is None or tok.sub != self.active_sub or tok.turn != self.active_turn:
            await self._send_json(ws, {"type": "error", "error": "bad_refresh"})
            return
        self.active_exp = max(self.active_exp, tok.exp)
        await self._send_json(ws, {"type": "refreshed", "exp": self.active_exp})

    async def _handle_binary(self, ws: ServerConnection, message: bytes, limiter: RateLimiter) -> None:
        frame = decode_frame(message)
        if frame is None:
            self.stats["invalid"] += 1
            if self.stats["invalid"] % 100 == 0:
                log.warning("frames inválidos: %d", self.stats["invalid"])
            return
        if isinstance(frame, TimedFrame):
            if frame.type == TYPE_PING:
                await ws.send(encode_timed(TYPE_PONG, frame.seq, frame.timestamp))
            return
        assert isinstance(frame, StateFrame)
        now = time.monotonic()
        if not limiter.allow(now):
            self.stats["dropped"] += 1
            return
        if self.last_seq is not None and not is_newer_seq(frame.seq, self.last_seq):
            self.stats["dropped"] += 1
            return
        self.last_seq = frame.seq
        self.last_frame_at = now
        result = self.filter.apply(frame.state, now * 1000)
        if result.blocked:
            self.stats["blocked"] += 1
        self.backend.apply(result.state)
        self.idle_neutral = result.state == NEUTRAL
        self.stats["frames"] += 1

    async def _release(self, ws: ServerConnection | None) -> None:
        self.backend.neutral()
        self.filter.reset()
        self.idle_neutral = True

    @staticmethod
    async def _send_json(ws: ServerConnection, payload: dict) -> None:
        try:
            await ws.send(json.dumps(payload))
        except ConnectionClosed:
            pass

    async def _watchdog_loop(self) -> None:
        """Suelta todo si el cliente deja de mandar frames (pestaña colgada, red caída)."""
        while True:
            await asyncio.sleep(0.05)
            if self.active is None or self.idle_neutral:
                continue
            if (time.monotonic() - self.last_frame_at) * 1000 > self.cfg.idle_timeout_ms:
                self.backend.neutral()
                self.filter.reset()
                self.idle_neutral = True
                log.info("watchdog: sin frames, mando en neutro")

    # ------------------------------------------------------------- lifecycle
    async def start(self) -> Server:
        self.server = await serve(
            self.handler,
            self.cfg.host,
            self.cfg.port,
            process_request=self.process_request,
            origins=self.cfg.origins or None,
            max_size=4096,
            max_queue=64,
            compression=None,
            ping_interval=10,
            ping_timeout=10,
        )
        self._watchdog = asyncio.create_task(self._watchdog_loop())
        return self.server

    async def stop(self) -> None:
        if self._watchdog:
            self._watchdog.cancel()
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        self.backend.close()

    @property
    def port(self) -> int:
        assert self.server is not None
        return self.server.sockets[0].getsockname()[1] if self.server.sockets else self.cfg.port
