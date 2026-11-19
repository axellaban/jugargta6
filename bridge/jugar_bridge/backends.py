"""Salidas del bridge: mando virtual (vgamepad) o backends de prueba."""

from __future__ import annotations

import logging
from typing import Protocol

from .protocol import BUTTONS, NEUTRAL, GamepadState

log = logging.getLogger("bridge.backend")


class Backend(Protocol):
    name: str

    def apply(self, state: GamepadState) -> None: ...

    def neutral(self) -> None: ...

    def close(self) -> None: ...


class NullBackend:
    """No hace nada; guarda el último estado (tests, dry-run)."""

    name = "null"

    def __init__(self) -> None:
        self.last: GamepadState = NEUTRAL
        self.applied = 0

    def apply(self, state: GamepadState) -> None:
        if state != self.last:
            self.last = state
            self.applied += 1
            self._changed(state)

    def _changed(self, state: GamepadState) -> None:
        pass

    def neutral(self) -> None:
        self.apply(NEUTRAL)

    def close(self) -> None:
        self.neutral()


class LogBackend(NullBackend):
    """Imprime cada cambio de estado. Útil para probar sin consola."""

    name = "log"

    def _changed(self, state: GamepadState) -> None:
        log.info(
            "buttons=%s lt=%d rt=%d L=(%d,%d) R=(%d,%d)",
            ",".join(state.pressed_names()) or "-",
            state.lt, state.rt, state.lx, state.ly, state.rx, state.ry,
        )


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(v)))


class X360Backend:
    """Xbox 360 virtual (ViGEmBus). Para Greenlight / Xbox app / xCloud y también Chiaki-ng."""

    name = "vgamepad-x360"

    def __init__(self) -> None:
        import vgamepad as vg  # import diferido: solo existe con ViGEmBus instalado

        self.vg = vg
        self.pad = vg.VX360Gamepad()
        b = vg.XUSB_BUTTON
        self.map = {
            "A": b.XUSB_GAMEPAD_A,
            "B": b.XUSB_GAMEPAD_B,
            "X": b.XUSB_GAMEPAD_X,
            "Y": b.XUSB_GAMEPAD_Y,
            "LB": b.XUSB_GAMEPAD_LEFT_SHOULDER,
            "RB": b.XUSB_GAMEPAD_RIGHT_SHOULDER,
            "Back": b.XUSB_GAMEPAD_BACK,
            "Start": b.XUSB_GAMEPAD_START,
            "LS": b.XUSB_GAMEPAD_LEFT_THUMB,
            "RS": b.XUSB_GAMEPAD_RIGHT_THUMB,
            "Up": b.XUSB_GAMEPAD_DPAD_UP,
            "Down": b.XUSB_GAMEPAD_DPAD_DOWN,
            "Left": b.XUSB_GAMEPAD_DPAD_LEFT,
            "Right": b.XUSB_GAMEPAD_DPAD_RIGHT,
            "Guide": b.XUSB_GAMEPAD_GUIDE,
            # Touchpad no existe en X360.
        }
        self.last: GamepadState | None = None
        self.neutral()

    def apply(self, s: GamepadState) -> None:
        if s == self.last:
            return
        mask = 0
        for name, flag in self.map.items():
            if s.buttons & (1 << BUTTONS[name]):
                mask |= int(flag)
        self.pad.report.wButtons = mask
        self.pad.left_trigger(_clamp(s.lt, 0, 255))
        self.pad.right_trigger(_clamp(s.rt, 0, 255))
        # XInput: Y positivo = arriba, igual que el protocolo.
        self.pad.left_joystick(_clamp(s.lx, -32768, 32767), _clamp(s.ly, -32768, 32767))
        self.pad.right_joystick(_clamp(s.rx, -32768, 32767), _clamp(s.ry, -32768, 32767))
        self.pad.update()
        self.last = s

    def neutral(self) -> None:
        self.apply(NEUTRAL)

    def close(self) -> None:
        self.neutral()


class DS4Backend:
    """DualShock 4 virtual (ViGEmBus). Recomendado para Chiaki-ng / PS Remote Play."""

    name = "vgamepad-ds4"

    def __init__(self, invert_y: bool = False) -> None:
        import vgamepad as vg

        self.vg = vg
        self.pad = vg.VDS4Gamepad()
        b = vg.DS4_BUTTONS
        self.map = {
            "A": b.DS4_BUTTON_CROSS,
            "B": b.DS4_BUTTON_CIRCLE,
            "X": b.DS4_BUTTON_SQUARE,
            "Y": b.DS4_BUTTON_TRIANGLE,
            "LB": b.DS4_BUTTON_SHOULDER_LEFT,
            "RB": b.DS4_BUTTON_SHOULDER_RIGHT,
            "Back": b.DS4_BUTTON_SHARE,
            "Start": b.DS4_BUTTON_OPTIONS,
            "LS": b.DS4_BUTTON_THUMB_LEFT,
            "RS": b.DS4_BUTTON_THUMB_RIGHT,
        }
        d = vg.DS4_DPAD_DIRECTIONS
        self.dpad = {
            (True, False, False, False): d.DS4_BUTTON_DPAD_NORTH,
            (False, True, False, False): d.DS4_BUTTON_DPAD_SOUTH,
            (False, False, True, False): d.DS4_BUTTON_DPAD_WEST,
            (False, False, False, True): d.DS4_BUTTON_DPAD_EAST,
            (True, False, True, False): d.DS4_BUTTON_DPAD_NORTHWEST,
            (True, False, False, True): d.DS4_BUTTON_DPAD_NORTHEAST,
            (False, True, True, False): d.DS4_BUTTON_DPAD_SOUTHWEST,
            (False, True, False, True): d.DS4_BUTTON_DPAD_SOUTHEAST,
        }
        self.dpad_none = d.DS4_BUTTON_DPAD_NONE
        self.trigger_left_bit = int(b.DS4_BUTTON_TRIGGER_LEFT)
        self.trigger_right_bit = int(b.DS4_BUTTON_TRIGGER_RIGHT)
        self.special_ps = int(vg.DS4_SPECIAL_BUTTONS.DS4_SPECIAL_BUTTON_PS)
        self.special_touchpad = int(vg.DS4_SPECIAL_BUTTONS.DS4_SPECIAL_BUTTON_TOUCHPAD)
        self.invert_y = invert_y
        self.last: GamepadState | None = None
        self.neutral()

    def _axis(self, v: int) -> int:
        return _clamp(128 + round(v / 32767 * 127), 0, 255)

    def _axis_y(self, v: int) -> int:
        # HID DS4: 0 = arriba. Protocolo: positivo = arriba → se invierte.
        return self._axis(v) if self.invert_y else _clamp(128 - round(v / 32767 * 127), 0, 255)

    def apply(self, s: GamepadState) -> None:
        if s == self.last:
            return
        mask = 0
        for name, flag in self.map.items():
            if s.buttons & (1 << BUTTONS[name]):
                mask |= int(flag)
        if s.lt > 30:
            mask |= self.trigger_left_bit
        if s.rt > 30:
            mask |= self.trigger_right_bit
        key = (s.pressed("Up"), s.pressed("Down"), s.pressed("Left"), s.pressed("Right"))
        dpad = int(self.dpad.get(key, self.dpad_none))
        self.pad.report.wButtons = (mask & ~0xF) | dpad
        special = 0
        if s.pressed("Guide"):
            special |= self.special_ps
        if s.pressed("Touchpad"):
            special |= self.special_touchpad
        self.pad.report.bSpecial = special
        self.pad.left_trigger(_clamp(s.lt, 0, 255))
        self.pad.right_trigger(_clamp(s.rt, 0, 255))
        self.pad.left_joystick(self._axis(s.lx), self._axis_y(s.ly))
        self.pad.right_joystick(self._axis(s.rx), self._axis_y(s.ry))
        self.pad.update()
        self.last = s

    def neutral(self) -> None:
        self.apply(NEUTRAL)

    def close(self) -> None:
        self.neutral()


def create_backend(name: str, target: str = "ds4", invert_y: bool = False) -> Backend:
    if name == "null":
        return NullBackend()
    if name == "log":
        return LogBackend()
    if name == "vgamepad":
        try:
            return DS4Backend(invert_y=invert_y) if target == "ds4" else X360Backend()
        except ImportError as exc:
            raise SystemExit(
                "vgamepad no está instalado. En Windows: instalá ViGEmBus y `pip install vgamepad`."
            ) from exc
    raise SystemExit(f"backend desconocido: {name}")
