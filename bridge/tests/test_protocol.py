import json
from pathlib import Path

from jugar_bridge.protocol import (
    TYPE_PING, TYPE_PONG, GamepadState, StateFrame, TimedFrame, decode_frame, encode_state, encode_timed, is_newer_seq,
)

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "packages/protocol/test-vectors.json").read_text())


def test_vectores_validos_coinciden_con_typescript():
    for v in VECTORS["valid"]:
        if v["type"] == "state":
            encoded = encode_state(v["seq"], GamepadState(**v["state"]))
        else:
            ftype = TYPE_PING if v["type"] == "ping" else TYPE_PONG
            encoded = encode_timed(ftype, v["seq"], v["timestamp"])
        assert encoded.hex() == v["hex"], v["name"]
        frame = decode_frame(bytes.fromhex(v["hex"]))
        assert frame is not None and frame.seq == v["seq"]
        if isinstance(frame, StateFrame):
            assert frame.state == GamepadState(**v["state"])
        else:
            assert isinstance(frame, TimedFrame) and frame.timestamp == v["timestamp"]


def test_vectores_invalidos():
    for v in VECTORS["invalid"]:
        assert decode_frame(bytes.fromhex(v["hex"])) is None, v["name"]
    assert decode_frame("no-bytes") is None


def test_seq_con_vuelta():
    assert is_newer_seq(0, 65535)
    assert not is_newer_seq(65535, 0)
    assert not is_newer_seq(3, 3)
