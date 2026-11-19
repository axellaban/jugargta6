import asyncio
import json
import time
import urllib.request

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from jugar_bridge.backends import NullBackend
from jugar_bridge.config import Config
from jugar_bridge.protocol import BUTTONS, TYPE_PING, TYPE_PONG, GamepadState, decode_frame, encode_state, encode_timed
from jugar_bridge.server import CLOSE_BAD_AUTH, CLOSE_FORBIDDEN, CLOSE_KICKED, CLOSE_REPLACED, Bridge
from jugar_bridge.tokens import sign

SECRET = "s" * 48


def token(turn=1, sub="user-1", aud="bridge", ttl=60):
    now = int(time.time())
    return sign({"sub": sub, "turn": turn, "aud": aud, "iat": now, "exp": now + ttl}, SECRET)


def run(coro):
    return asyncio.run(asyncio.wait_for(coro, timeout=10))


async def start_bridge(**kw):
    cfg = Config(secret=SECRET, host="127.0.0.1", port=0, backend="null", **kw)
    backend = NullBackend()
    bridge = Bridge(cfg, backend)
    await bridge.start()
    return bridge, backend, f"ws://127.0.0.1:{bridge.port}/control"


async def auth(ws, tok):
    await ws.send(json.dumps({"type": "auth", "token": tok}))
    return json.loads(await ws.recv())


async def wait_until(pred, timeout=2.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        await asyncio.sleep(0.01)
    return False


def test_flujo_completo_y_filtro():
    async def scenario():
        bridge, backend, url = await start_bridge()
        try:
            async with connect(url) as ws:
                ready = await auth(ws, token())
                assert ready["type"] == "ready" and ready["profile"] == "ps5"
                assert "Guide" in ready["always_blocked"]
                pressed = (1 << BUTTONS["A"]) | (1 << BUTTONS["Guide"])
                await ws.send(encode_state(1, GamepadState(buttons=pressed, rt=200, lx=1000)))
                assert await wait_until(lambda: backend.last.rt == 200)
                assert backend.last.buttons == 1 << BUTTONS["A"], "Guide filtrado"
                # frame viejo descartado
                await ws.send(encode_state(0, GamepadState(rt=1)))
                await ws.send(encode_timed(TYPE_PING, 9, 1234))
                pong = decode_frame(await ws.recv())
                assert pong.type == TYPE_PONG and pong.timestamp == 1234
                assert backend.last.rt == 200
            assert await wait_until(lambda: backend.last == GamepadState()), "neutro al desconectar"
        finally:
            await bridge.stop()

    run(scenario())


def test_token_invalido_y_turno_viejo():
    async def scenario():
        bridge, _, url = await start_bridge()
        try:
            async with connect(url) as ws:
                await ws.send(json.dumps({"type": "auth", "token": token(aud="stream")}))
                with pytest.raises(ConnectionClosed) as exc:
                    await ws.recv()
                assert exc.value.rcvd.code == CLOSE_BAD_AUTH
            async with connect(url) as ws2:
                await auth(ws2, token(turn=5))
                async with connect(url) as ws_old:
                    await ws_old.send(json.dumps({"type": "auth", "token": token(turn=4)}))
                    with pytest.raises(ConnectionClosed) as exc:
                        await ws_old.recv()
                    assert exc.value.rcvd.code == CLOSE_FORBIDDEN
        finally:
            await bridge.stop()

    run(scenario())


def test_turno_nuevo_reemplaza_al_anterior():
    async def scenario():
        bridge, _, url = await start_bridge()
        try:
            ws1 = await connect(url)
            await auth(ws1, token(turn=1, sub="a"))
            ws2 = await connect(url)
            assert (await auth(ws2, token(turn=2, sub="b")))["type"] == "ready"
            msg = json.loads(await ws1.recv())
            assert msg["type"] == "replaced"
            with pytest.raises(ConnectionClosed) as exc:
                await ws1.recv()
            assert exc.value.rcvd.code == CLOSE_REPLACED
            assert bridge.active_turn == 2
            await ws2.close()
        finally:
            await bridge.stop()

    run(scenario())


def test_watchdog_suelta_botones():
    async def scenario():
        bridge, backend, url = await start_bridge(idle_timeout_ms=100)
        try:
            async with connect(url) as ws:
                await auth(ws, token())
                await ws.send(encode_state(1, GamepadState(buttons=1, rt=255)))
                assert await wait_until(lambda: backend.last.rt == 255)
                assert await wait_until(lambda: backend.last == GamepadState(), timeout=1.0)
        finally:
            await bridge.stop()

    run(scenario())


def test_kick_y_health():
    async def scenario():
        bridge, _, url = await start_bridge()
        base = url.replace("ws://", "http://").replace("/control", "")
        try:
            async with connect(url) as ws:
                await auth(ws, token(turn=7))
                health = await asyncio.to_thread(lambda: json.loads(urllib.request.urlopen(base + "/health").read()))
                assert health["active"] and health["turn"] == 7

                def kick(tok):
                    req = urllib.request.Request(base + "/kick?turn=7", headers={"Authorization": f"Bearer {tok}"})
                    try:
                        return urllib.request.urlopen(req).status
                    except urllib.error.HTTPError as e:
                        return e.code

                assert await asyncio.to_thread(kick, token(aud="bridge")) == 401
                assert await asyncio.to_thread(kick, token(aud="bridge-admin", sub="admin")) == 200
                assert json.loads(await ws.recv())["type"] == "kicked"
                with pytest.raises(ConnectionClosed) as exc:
                    await ws.recv()
                assert exc.value.rcvd.code == CLOSE_KICKED
            # el turno pateado no puede volver a entrar
            async with connect(url) as ws:
                await ws.send(json.dumps({"type": "auth", "token": token(turn=7)}))
                with pytest.raises(ConnectionClosed) as exc:
                    await ws.recv()
                assert exc.value.rcvd.code == CLOSE_FORBIDDEN
        finally:
            await bridge.stop()

    run(scenario())
