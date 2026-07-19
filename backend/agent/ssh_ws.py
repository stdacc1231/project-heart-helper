"""
SSH-over-WebSocket / HTTP-Injector bridge on 127.0.0.1:10000.

This is a *loose* HTTP-upgrade proxy: it accepts ANY inbound HTTP-like
request (WebSocket, HTTP Injector custom payloads, malformed
`Upgrade: websocket` with no `Sec-WebSocket-Key`, etc.), replies with
`HTTP/1.1 101 Switching Protocols` and then transparently pipes the
underlying TCP stream to 127.0.0.1:22.

This is deliberately NOT a strict RFC-6455 server — strict libraries
(python `websockets`) reject the classic injector payload:

    GET / HTTP/1.1[crlf]Host:x[crlf]Upgrade: websocket[crlf][crlf]

with HTTP 400 because `Sec-WebSocket-Key` / `Connection: upgrade` are
absent. That is what breaks HTTP Injector / NapsternetV / etc. — this
server accepts it.
"""
from __future__ import annotations
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="ssh-ws %(levelname)s %(message)s")

SSH_HOST, SSH_PORT = "127.0.0.1", 22
LISTEN_HOST, LISTEN_PORT = "127.0.0.1", 10000

RESPONSE_101 = (
    b"HTTP/1.1 101 Switching Protocols\r\n"
    b"Upgrade: websocket\r\n"
    b"Connection: Upgrade\r\n"
    b"Server: Autoscript\r\n"
    b"\r\n"
)


async def _read_http_head(reader: asyncio.StreamReader, timeout: float = 8.0) -> bytes:
    """Read until CRLFCRLF (end of HTTP headers). Returns everything read."""
    buf = bytearray()
    try:
        while b"\r\n\r\n" not in buf and b"\n\n" not in buf:
            chunk = await asyncio.wait_for(reader.read(2048), timeout=timeout)
            if not chunk:
                break
            buf.extend(chunk)
            if len(buf) > 16384:
                break
    except asyncio.TimeoutError:
        pass
    return bytes(buf)


async def _pipe(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await src.read(65536)
            if not data:
                break
            dst.write(data)
            await dst.drain()
    except (ConnectionResetError, BrokenPipeError, OSError):
        pass
    finally:
        try:
            dst.close()
        except Exception:
            pass


async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    peer = client_writer.get_extra_info("peername")
    try:
        # Read the injector / websocket handshake (we accept anything).
        head = await _read_http_head(client_reader)
        if not head:
            client_writer.close()
            return

        # Reply 101 immediately — clients like HTTP Injector wait for this
        # exact status line then start streaming SSH bytes.
        client_writer.write(RESPONSE_101)
        await client_writer.drain()

        # Open TCP connection to sshd.
        try:
            ssh_reader, ssh_writer = await asyncio.open_connection(SSH_HOST, SSH_PORT)
        except OSError as exc:
            logging.error("ssh connect failed from %s: %s", peer, exc)
            client_writer.close()
            return

        # If the client bundled extra bytes after the header end, forward them.
        for sep in (b"\r\n\r\n", b"\n\n"):
            idx = head.find(sep)
            if idx != -1:
                trailing = head[idx + len(sep):]
                if trailing:
                    ssh_writer.write(trailing)
                    await ssh_writer.drain()
                break

        await asyncio.gather(
            _pipe(client_reader, ssh_writer),
            _pipe(ssh_reader, client_writer),
        )
    except Exception as exc:
        logging.warning("ssh-ws handler error from %s: %s", peer, exc)
    finally:
        try:
            client_writer.close()
        except Exception:
            pass


async def main() -> None:
    server = await asyncio.start_server(handle, LISTEN_HOST, LISTEN_PORT)
    sockets = ", ".join(str(s.getsockname()) for s in (server.sockets or []))
    logging.info("SSH-WS (injector-compat) listening on %s -> %s:%d", sockets, SSH_HOST, SSH_PORT)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
