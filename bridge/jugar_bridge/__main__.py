from __future__ import annotations

import asyncio
import logging
import signal

from .backends import create_backend
from .config import from_args
from .server import Bridge


async def main() -> None:
    cfg = from_args()
    backend = create_backend(cfg.backend, cfg.target, cfg.invert_ds4_y)
    bridge = Bridge(cfg, backend)
    await bridge.start()
    logging.getLogger("bridge").info(
        "escuchando en ws://%s:%d/control (backend=%s, perfil=%s)", cfg.host, bridge.port, backend.name, cfg.profile
    )
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows
            pass
    try:
        await stop.wait()
    finally:
        await bridge.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
