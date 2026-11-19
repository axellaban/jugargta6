"""Espejo en Python de packages/protocol/src/index.ts (mismo formato, mismos vectores)."""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

PROTOCOL_VERSION = 1
FRAME_SIZE = 16

TYPE_STATE = 1
TYPE_PING = 2
TYPE_PONG = 3

# Índice de bit de cada botón (idéntico a Button en TS).
BUTTONS = {
    "A": 0,
    "B": 1,
    "X": 2,
    "Y": 3,
    "LB": 4,
    "RB": 5,
    "Back": 6,
    "Start": 7,
    "LS": 8,
    "RS": 9,
    "Up": 10,
    "Down": 11,
    "Left": 12,
    "Right": 13,
    "Guide": 14,
    "Touchpad": 15,
}

_STATE = struct.Struct("<BBHHBBhhhh")
_TIMED = struct.Struct("<BBHI8x")
assert _STATE.size == FRAME_SIZE and _TIMED.size == FRAME_SIZE


@dataclass(frozen=True)
class GamepadState:
    buttons: int = 0
    lt: int = 0
    rt: int = 0
    lx: int = 0
    ly: int = 0
    rx: int = 0
    ry: int = 0

    def pressed(self, name: str) -> bool:
        return bool(self.buttons & (1 << BUTTONS[name]))

    def pressed_names(self) -> list[str]:
        return [n for n in BUTTONS if self.pressed(n)]


NEUTRAL = GamepadState()


@dataclass(frozen=True)
class StateFrame:
    seq: int
    state: GamepadState
    type: int = field(default=TYPE_STATE)


@dataclass(frozen=True)
class TimedFrame:
    type: int
    seq: int
    timestamp: int


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(v)))


def encode_state(seq: int, s: GamepadState) -> bytes:
    return _STATE.pack(
        PROTOCOL_VERSION,
        TYPE_STATE,
        seq & 0xFFFF,
        s.buttons & 0xFFFF,
        _clamp(s.lt, 0, 255),
        _clamp(s.rt, 0, 255),
        _clamp(s.lx, -32768, 32767),
        _clamp(s.ly, -32768, 32767),
        _clamp(s.rx, -32768, 32767),
        _clamp(s.ry, -32768, 32767),
    )


def encode_timed(frame_type: int, seq: int, timestamp: int) -> bytes:
    return _TIMED.pack(PROTOCOL_VERSION, frame_type, seq & 0xFFFF, timestamp & 0xFFFFFFFF)


def decode_frame(data: bytes) -> StateFrame | TimedFrame | None:
    """Devuelve None si el frame es inválido (tamaño, versión o tipo)."""
    if not isinstance(data, (bytes, bytearray, memoryview)) or len(data) != FRAME_SIZE:
        return None
    data = bytes(data)
    if data[0] != PROTOCOL_VERSION:
        return None
    frame_type = data[1]
    if frame_type == TYPE_STATE:
        _, _, seq, buttons, lt, rt, lx, ly, rx, ry = _STATE.unpack(data)
        return StateFrame(seq=seq, state=GamepadState(buttons, lt, rt, lx, ly, rx, ry))
    if frame_type in (TYPE_PING, TYPE_PONG):
        _, _, seq, ts = _TIMED.unpack(data)
        return TimedFrame(type=frame_type, seq=seq, timestamp=ts)
    return None


def is_newer_seq(seq: int, last: int) -> bool:
    diff = (seq - last) & 0xFFFF
    return diff != 0 and diff < 0x8000
