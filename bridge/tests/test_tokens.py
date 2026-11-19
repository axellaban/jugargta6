import json
import time
from pathlib import Path

import pytest

from jugar_bridge.tokens import TokenError, sign, verify

SECRET = "x" * 40


def test_roundtrip():
    tok = sign({"sub": "u1", "turn": 42, "aud": "bridge", "iat": 1, "exp": int(time.time()) + 60}, SECRET)
    t = verify(tok, SECRET, "bridge")
    assert t.sub == "u1" and t.turn == 42


@pytest.mark.parametrize(
    "payload,audience,error",
    [
        ({"sub": "u", "turn": 1, "aud": "bridge", "exp": 1}, "bridge", "expired"),
        ({"sub": "u", "turn": 1, "aud": "stream", "exp": 9999999999}, "bridge", "bad_audience"),
        ({"turn": 1, "aud": "bridge", "exp": 9999999999}, "bridge", "malformed"),
    ],
)
def test_rechazos(payload, audience, error):
    with pytest.raises(TokenError, match=error):
        verify(sign(payload, SECRET), SECRET, audience)


def test_firma_invalida():
    tok = sign({"sub": "u", "turn": 1, "aud": "bridge", "exp": 9999999999}, SECRET)
    with pytest.raises(TokenError, match="bad_signature"):
        verify(tok, "y" * 40, "bridge")
    body, sig = tok.split(".")
    with pytest.raises(TokenError):
        verify(body + "." + sig[:-2] + "AA", SECRET, "bridge")


def test_token_generado_por_la_web():
    """Vector producido por apps/web/src/lib/signed-token.ts (ver su test)."""
    data = json.loads((Path(__file__).resolve().parents[2] / "packages/protocol/test-vectors.json").read_text())
    for v in data.get("tokens", []):
        t = verify(v["token"], v["secret"], v["payload"]["aud"], now=v["payload"]["iat"])
        assert t.sub == v["payload"]["sub"] and t.turn == v["payload"]["turn"]
