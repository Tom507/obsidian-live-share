"""WP46 visible-set support module — fake control endpoint + module bootstrap.

DATA SAFETY (non-negotiable): every WP46 Python test runs against a fake,
in-process HTTP control endpoint bound to ``127.0.0.1:0`` (ephemeral port, read
back after binding). No real Obsidian instance, no vault, no ``%APPDATA%``, and
never the real rig ports ``REAL_CONTROL_PORT_A`` / ``REAL_CONTROL_PORT_B``.
Shape follows the existing precedent ``tools/test_liveshare_e2e_mcp.py``.

Import form is pinned by T3_SharedContract: ``<repo>/tools`` goes on ``sys.path``
and the package is imported top-level as ``obsidian_e2e`` — never as
``tools.obsidian_e2e`` (the workspace ``tools`` regular package would win).
"""

from __future__ import annotations

import json
import pathlib
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# <repo>/workflowArtifacts/canvas-v2/tests/visible/WP46/_wp46_endpoint_visible.py
_TOOLS = pathlib.Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, readiness  # noqa: E402

# Every named refusal WP46 may return — imported from the owning module, never
# re-declared here (T3_SharedContract §7).
NAMED_REASONS = frozenset(
    {
        constants.READINESS_TIMEOUT,
        constants.IDENTITY_SAME_VAULT,
        constants.IDENTITY_UNKNOWN_VAULT,
        constants.ROOM_MISMATCH,
        constants.PLUGIN_NOT_E2E_CAPABLE,
    }
)

# Any command that would change vault or document state. A readiness probe must
# never send one of these — that is the "no edit is issued" oracle.
MUTATING_COMMANDS = frozenset(
    {"canvas.simulateEdit", "canvas.setFlag", "canvas.open", "scratch.create", "scratch.remove"}
)


def session_info(
    *,
    vault_id: str,
    room_id: str,
    client_id: str = "e2e-a",
    role: str = "host",
    vault_name: str | None = None,
    vault_path: str | None = None,
    plugin_build: str = "1.4.2+e2e",
    canvas_surface: bool = True,
    connected: bool = True,
) -> dict:
    """A well-formed ``session.info`` result (T3_SharedContract §6 + §6.2)."""
    return {
        "clientId": client_id,
        "role": role,
        "roomId": room_id,
        "connected": connected,
        "vaultId": vault_id,
        "vaultName": vault_name if vault_name is not None else vault_id,
        "vaultPath": vault_path,
        "pluginBuild": plugin_build,
        "canvasSurface": canvas_surface,
    }


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, request, client_address):  # noqa: D102 - silence stub noise
        pass


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence stub server logging
        pass

    def _send_json(self, code: int, payload: dict) -> None:
        self._send_raw(code, json.dumps(payload).encode("utf-8"))

    def _send_raw(self, code: int, data: bytes) -> None:
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except OSError:
            pass  # the client gave up (timeout test) — nothing to report

    def do_GET(self):  # noqa: N802 (http.server API)
        ep: FakeEndpoint = self.server.endpoint  # type: ignore[attr-defined]
        ep._record(f"GET {self.path}")
        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):  # noqa: N802 (http.server API)
        ep: FakeEndpoint = self.server.endpoint  # type: ignore[attr-defined]
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        try:
            body = json.loads(raw) if raw.strip() else {}
        except Exception:
            body = {}
        cmd = body.get("cmd") if isinstance(body, dict) else None
        ep._record(cmd if isinstance(cmd, str) else f"<unparsed:{self.path}>")

        if ep.mode == "hang":
            ep._released.wait(timeout=ep.hang_s)
            self._send_json(503, {"ok": False, "error": "stub released"})
            return
        if ep.mode == "raw":
            self._send_raw(ep.status, ep.raw_body)
            return
        if ep.mode == "error":
            self._send_json(400, {"ok": False, "error": "stub refusal"})
            return
        if cmd == "session.info":
            self._send_json(200, {"ok": True, "result": dict(ep.info)})
            return
        self._send_json(400, {"ok": False, "error": f"unknown cmd {cmd!r}"})


class FakeEndpoint:
    """A stub of the WP4 in-plugin control server.

    ``mode``:
      ``ok``    respond ``200 {"ok": true, "result": <info>}`` to ``session.info``
      ``hang``  accept the request and never answer (bounded-timeout probe)
      ``raw``   respond ``status`` with arbitrary bytes (malformed-body probe)
      ``error`` respond ``400 {"ok": false, ...}``
    """

    def __init__(
        self,
        *,
        info: dict | None = None,
        mode: str = "ok",
        status: int = 200,
        raw_body: bytes = b"",
        hang_s: float = 30.0,
    ) -> None:
        self.info = info or {}
        self.mode = mode
        self.status = status
        self.raw_body = raw_body
        self.hang_s = hang_s
        self.port = 0
        self._server: _Server | None = None
        self._lock = threading.Lock()
        self._commands: list[str] = []
        self._released = threading.Event()

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> "FakeEndpoint":
        self._server = _Server(("127.0.0.1", 0), _Handler)
        self._server.endpoint = self  # type: ignore[attr-defined]
        self.port = self._server.server_address[1]
        assert self.port not in (
            constants.REAL_CONTROL_PORT_A,
            constants.REAL_CONTROL_PORT_B,
        ), "data safety: a stub must never occupy a real rig port"
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def stop(self) -> None:
        self._released.set()
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    def __enter__(self) -> "FakeEndpoint":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

    # -- spy ---------------------------------------------------------------
    def _record(self, cmd: str) -> None:
        with self._lock:
            self._commands.append(cmd)

    @property
    def commands(self) -> list[str]:
        with self._lock:
            return list(self._commands)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def assert_no_edit_issued(*endpoints: FakeEndpoint) -> None:
    """Every failing readiness path must leave the instances untouched."""
    for ep in endpoints:
        seen = set(ep.commands)
        assert not (seen & MUTATING_COMMANDS), f"readiness issued an edit: {sorted(seen)}"
        assert seen <= {"session.info"}, f"unexpected command on the wire: {sorted(seen)}"


def run_as_script(namespace: dict) -> int:
    """Standalone `python <file>` fallback (workspace convention)."""
    import traceback

    tests = [v for k, v in sorted(namespace.items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0
