from __future__ import annotations

import argparse
import os
from dataclasses import dataclass, field


def _env_list(name: str) -> list[str]:
    return [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]


@dataclass
class Config:
    secret: str
    host: str = "127.0.0.1"
    port: int = 8765
    backend: str = "log"  # vgamepad | log | null
    target: str = "ds4"  # ds4 (PS5 / Chiaki-ng) | x360 (Xbox / Greenlight)
    profile: str = "ps5"  # perfil anti-troll: ps5 | xbox
    hold_limit_ms: int = 800
    idle_timeout_ms: int = 500
    max_rate: float = 250.0
    auth_timeout_s: float = 5.0
    invert_ds4_y: bool = False
    origins: list[str] = field(default_factory=list)
    extra_blocked: list[str] = field(default_factory=list)

    def validate(self) -> None:
        if len(self.secret or "") < 32:
            raise SystemExit("BRIDGE_SHARED_SECRET debe tener al menos 32 caracteres (igual que en apps/web).")
        if self.profile not in ("ps5", "xbox"):
            raise SystemExit("BRIDGE_PROFILE debe ser ps5 o xbox")
        if self.target not in ("ds4", "x360"):
            raise SystemExit("BRIDGE_TARGET debe ser ds4 o x360")


def from_args(argv: list[str] | None = None) -> Config:
    p = argparse.ArgumentParser(prog="jugar_bridge", description="WebSocket -> mando virtual con filtro anti-troll")
    p.add_argument("--host", default=os.environ.get("BRIDGE_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("BRIDGE_PORT", "8765")))
    p.add_argument("--backend", choices=["vgamepad", "log", "null"], default=os.environ.get("BRIDGE_BACKEND", "log"))
    p.add_argument("--target", choices=["ds4", "x360"], default=os.environ.get("BRIDGE_TARGET", "ds4"))
    p.add_argument("--profile", choices=["ps5", "xbox"], default=os.environ.get("BRIDGE_PROFILE", "ps5"))
    p.add_argument("--hold-limit-ms", type=int, default=int(os.environ.get("BRIDGE_HOLD_LIMIT_MS", "800")))
    p.add_argument("--idle-timeout-ms", type=int, default=int(os.environ.get("BRIDGE_IDLE_TIMEOUT_MS", "500")))
    p.add_argument("--max-rate", type=float, default=float(os.environ.get("BRIDGE_MAX_RATE", "250")))
    p.add_argument("--invert-ds4-y", action="store_true", default=os.environ.get("BRIDGE_INVERT_DS4_Y") == "1")
    a = p.parse_args(argv)
    cfg = Config(
        secret=os.environ.get("BRIDGE_SHARED_SECRET", ""),
        host=a.host,
        port=a.port,
        backend=a.backend,
        target=a.target,
        profile=a.profile,
        hold_limit_ms=a.hold_limit_ms,
        idle_timeout_ms=a.idle_timeout_ms,
        max_rate=a.max_rate,
        invert_ds4_y=a.invert_ds4_y,
        origins=_env_list("BRIDGE_ALLOWED_ORIGINS"),
        extra_blocked=_env_list("BRIDGE_EXTRA_BLOCKED"),
    )
    cfg.validate()
    return cfg
