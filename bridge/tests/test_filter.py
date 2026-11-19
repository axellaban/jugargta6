from jugar_bridge.filter import AntiTrollFilter, RateLimiter
from jugar_bridge.protocol import BUTTONS, GamepadState


def mask(*names):
    m = 0
    for n in names:
        m |= 1 << BUTTONS[n]
    return m


def test_ps5_bloquea_ps_y_share_siempre():
    f = AntiTrollFilter("ps5")
    r = f.apply(GamepadState(buttons=mask("A", "Guide", "Back")), 0)
    assert r.state.buttons == mask("A")
    assert r.blocked == mask("Guide", "Back")


def test_xbox_permite_view():
    f = AntiTrollFilter("xbox")
    r = f.apply(GamepadState(buttons=mask("Back", "Guide")), 0)
    assert r.state.buttons == mask("Back")


def test_options_como_toque_pasa_y_sostenido_se_suelta():
    f = AntiTrollFilter("ps5", hold_limit_ms=800)
    assert f.apply(GamepadState(buttons=mask("Start")), 0).state.buttons == mask("Start")
    assert f.apply(GamepadState(buttons=mask("Start")), 700).state.buttons == mask("Start")
    held = f.apply(GamepadState(buttons=mask("Start", "A")), 900)
    assert held.state.buttons == mask("A")
    assert held.blocked == mask("Start")
    # sigue bloqueado mientras no lo suelte
    assert f.apply(GamepadState(buttons=mask("Start")), 5000).state.buttons == 0
    # suelta y vuelve a tocar: pasa otra vez
    f.apply(GamepadState(), 5100)
    assert f.apply(GamepadState(buttons=mask("Start")), 5200).state.buttons == mask("Start")


def test_bloqueos_extra():
    f = AntiTrollFilter("xbox", extra_blocked=["Touchpad"])
    assert f.apply(GamepadState(buttons=mask("Touchpad")), 0).state.buttons == 0


def test_ejes_y_gatillos_pasan_intactos():
    s = GamepadState(buttons=0, lt=10, rt=20, lx=-5, ly=6, rx=7, ry=-8)
    assert AntiTrollFilter("ps5").apply(s, 0).state == s


def test_rate_limiter():
    rl = RateLimiter(rate=10, burst=5)
    assert sum(rl.allow(0.0) for _ in range(20)) == 5
    assert rl.allow(0.1) is True  # 1 token recuperado en 100 ms
    assert rl.allow(0.1) is False
