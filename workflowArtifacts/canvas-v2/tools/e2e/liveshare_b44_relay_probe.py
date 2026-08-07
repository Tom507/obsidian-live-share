"""B44 — is the relay endpoint mounted, and what does it answer?

SECRET DISCIPLINE. The control URL carries `token`, `jwt` and `password` as
query parameters. This script therefore:
  * reads them from data.json itself, never from a command line or an env var,
  * NEVER prints the URL, any query string, or any value,
  * prints ONLY the HTTP status line and the response headers of the WebSocket
    handshake, plus a boolean for whether credentials were attached.

That is enough to distinguish the three cases we care about:
  101  the relay accepted the upgrade      -> the relay is up and auth passed
  401/403 the relay answered and refused   -> the relay is up, auth is the problem
  404/502/200-html the proxy fell through  -> the relay SERVICE is not mounted
"""

from __future__ import annotations

import json
import socket
import ssl
import sys
import base64
import os
from pathlib import Path
from urllib.parse import quote, urlparse

DATA = {
    "A": Path(r"H:\Developement\_NeuralAngels\ObsidianOrga\.obsidian\plugins\live-share\data.json"),
    "B": Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie\.obsidian\plugins\live-share\data.json"),
}


def handshake(host: str, port: int, path_with_query: str, tls: bool, label: str) -> None:
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET {path_with_query} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    s = socket.create_connection((host, port), timeout=10)
    if tls:
        s = ssl.create_default_context().wrap_socket(s, server_hostname=host)
    try:
        s.sendall(req.encode())
        s.settimeout(10)
        buf = b""
        while b"\r\n\r\n" not in buf and len(buf) < 8192:
            chunk = s.recv(4096)
            if not chunk:
                break
            buf += chunk
    finally:
        s.close()
    head = buf.split(b"\r\n\r\n", 1)[0].decode("utf-8", "replace")
    print(f"  [{label}]")
    for line in head.splitlines():
        # No echo of anything we sent; this is the SERVER's answer only.
        print(f"    {line[:160]}")
    if not head:
        print("    <server closed without answering>")
    print()


def main() -> int:
    cfg = json.loads(DATA["A"].read_text(encoding="utf-8"))
    u = urlparse(cfg["serverUrl"])
    host = u.hostname
    tls = u.scheme == "https"
    port = u.port or (443 if tls else 80)
    room = cfg["roomId"]
    has = {k: bool(cfg.get(k)) for k in ("token", "jwt", "serverPassword", "encryptionPassphrase")}
    print(f"relay host={host} tls={tls} port={port}")
    print(f"credentials present (values NEVER printed): {has}")
    print()

    # 1. the control route WITHOUT credentials — tells us if the route exists.
    handshake(host, port, f"/control/{quote(room, safe='')}", tls,
              "control route, NO credentials")

    # 2. the control route WITH credentials, built here and never displayed.
    q = f"token={quote(cfg['token'], safe='')}"
    if cfg.get("jwt"):
        q += f"&jwt={quote(cfg['jwt'], safe='')}"
    if cfg.get("serverPassword"):
        q += f"&password={quote(cfg['serverPassword'], safe='')}"
    handshake(host, port, f"/control/{quote(room, safe='')}?{q}", tls,
              "control route, WITH credentials")

    # 3. a route that certainly does not exist — the control against which the
    #    other two answers mean something. If this answers the same as (1), the
    #    proxy is answering for everything and (1) proved nothing.
    handshake(host, port, "/control/__b44_no_such_room__", tls,
              "CONTROL PROBE: a room that cannot exist")
    return 0


if __name__ == "__main__":
    sys.exit(main())
