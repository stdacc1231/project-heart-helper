"""
SSH-over-WebSocket bridge on 127.0.0.1:2095.

Nginx upgrades WebSocket connections arriving at "/" to this port. Each
connection is transparently proxied to 127.0.0.1:22 so any SSH client that
speaks WebSocket transport (e.g. HTTP Injector, NapsternetV) can connect on
port 443 using path "/" without needing a randomized path.

HTTP/1.1 upgrade is enforced by Nginx (`proxy_http_version 1.1`).
"""
from __future__ import annotations
import asyncio, logging

import websockets

logging.basicConfig(level=logging.INFO, format="ssh-ws %(levelname)s %(message)s")

SSH_HOST, SSH_PORT = "127.0.0.1", 22
LISTEN_HOST, LISTEN_PORT = "127.0.0.1", 2095


async def pipe_ws_to_tcp(ws, writer):
    try:
        async for msg in ws:
            if isinstance(msg, str):
                msg = msg.encode()
            writer.write(msg)
            await writer.drain()
    finally:
        writer.close()


async def pipe_tcp_to_ws(reader, ws):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            await ws.send(data)
    finally:
        await ws.close()


async def handler(ws):
    try:
        reader, writer = await asyncio.open_connection(SSH_HOST, SSH_PORT)
    except OSError as e:
        logging.error("connect ssh: %s", e)
        await ws.close(code=1011)
        return
    await asyncio.gather(pipe_ws_to_tcp(ws, writer), pipe_tcp_to_ws(reader, ws))


async def main():
    async with websockets.serve(handler, LISTEN_HOST, LISTEN_PORT, max_size=None):
        logging.info("SSH-WS listening on %s:%d -> %s:%d", LISTEN_HOST, LISTEN_PORT, SSH_HOST, SSH_PORT)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
