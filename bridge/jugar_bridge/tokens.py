"""Tokens HMAC-SHA256 emitidos por apps/web (src/lib/signed-token.ts).

Formato: base64url(json_payload) + "." + base64url(hmac_sha256(secret, base64url(json_payload)))
Payload: {"sub": user_id, "turn": entry_id, "aud": "bridge", "iat": s, "exp": s}
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass


class TokenError(Exception):
    pass


@dataclass(frozen=True)
class TurnToken:
    sub: str
    turn: int
    aud: str
    exp: int
    iat: int


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign(payload: dict, secret: str) -> str:
    """Solo para tests y herramientas; en producción firma la web."""
    body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(sig)}"


def verify(token: str, secret: str, audience: str, now: float | None = None, leeway: int = 5) -> TurnToken:
    if not secret or len(secret) < 32:
        raise TokenError("secret_too_short")
    if not isinstance(token, str) or token.count(".") != 1 or len(token) > 2048:
        raise TokenError("malformed")
    body, sig = token.split(".")
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    try:
        given = _b64url_decode(sig)
        payload = json.loads(_b64url_decode(body))
    except Exception as exc:  # noqa: BLE001
        raise TokenError("malformed") from exc
    if not hmac.compare_digest(expected, given):
        raise TokenError("bad_signature")
    if payload.get("aud") != audience:
        raise TokenError("bad_audience")
    now = time.time() if now is None else now
    exp = int(payload.get("exp", 0))
    if exp + leeway < now:
        raise TokenError("expired")
    try:
        return TurnToken(
            sub=str(payload["sub"]),
            turn=int(payload["turn"]),
            aud=str(payload["aud"]),
            exp=exp,
            iat=int(payload.get("iat", 0)),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise TokenError("malformed") from exc
