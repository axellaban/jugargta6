"""Filtro anti-troll. Es la fuente de verdad: la web solo lo muestra en el HUD."""

from __future__ import annotations

from dataclasses import dataclass, replace

from .protocol import BUTTONS, GamepadState

# Igual que FILTER_PROFILES en packages/protocol.
PROFILES = {
    # PS5: Back = Create/Share (capturas y transmisiones del sistema).
    "ps5": {"always": ("Guide", "Back"), "hold": ("Start",)},
    # Xbox: Back = View (cámara dentro del juego), se permite.
    "xbox": {"always": ("Guide",), "hold": ("Start",)},
}


def _mask(names: tuple[str, ...] | list[str]) -> int:
    m = 0
    for n in names:
        m |= 1 << BUTTONS[n]
    return m


@dataclass
class FilterResult:
    state: GamepadState
    blocked: int  # bits que el usuario apretó y no pasaron


class AntiTrollFilter:
    """
    - always: se descartan siempre.
    - hold: pasan como toque; si se mantienen más de hold_limit_ms se fuerzan a
      soltado hasta que el usuario los suelte de verdad.
    """

    def __init__(self, profile: str = "ps5", hold_limit_ms: int = 800, extra_blocked: list[str] | None = None):
        if profile not in PROFILES:
            raise ValueError(f"perfil desconocido: {profile}")
        cfg = PROFILES[profile]
        self.profile = profile
        self.always_mask = _mask(list(cfg["always"]) + list(extra_blocked or []))
        self.hold_names = tuple(cfg["hold"])
        self.hold_limit_ms = hold_limit_ms
        self._pressed_since: dict[str, float] = {}
        self._latched: set[str] = set()

    def reset(self) -> None:
        self._pressed_since.clear()
        self._latched.clear()

    def apply(self, state: GamepadState, now_ms: float) -> FilterResult:
        buttons = state.buttons
        blocked = buttons & self.always_mask
        buttons &= ~self.always_mask

        for name in self.hold_names:
            bit = 1 << BUTTONS[name]
            if buttons & bit:
                since = self._pressed_since.setdefault(name, now_ms)
                if name in self._latched or now_ms - since > self.hold_limit_ms:
                    self._latched.add(name)
                    buttons &= ~bit
                    blocked |= bit
            else:
                self._pressed_since.pop(name, None)
                self._latched.discard(name)

        return FilterResult(state=replace(state, buttons=buttons & 0xFFFF), blocked=blocked)

    def describe(self) -> dict:
        return {
            "profile": self.profile,
            "always_blocked": [n for n, b in BUTTONS.items() if self.always_mask & (1 << b)],
            "hold_limited": list(self.hold_names),
            "hold_limit_ms": self.hold_limit_ms,
        }


class RateLimiter:
    """Token bucket: como máximo `rate` frames por segundo con ráfaga `burst`."""

    def __init__(self, rate: float = 250.0, burst: int = 50):
        self.rate = rate
        self.burst = burst
        self.tokens = float(burst)
        self.last = None

    def allow(self, now_s: float) -> bool:
        if self.last is None:
            self.last = now_s
        self.tokens = min(self.burst, self.tokens + (now_s - self.last) * self.rate)
        self.last = now_s
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False
