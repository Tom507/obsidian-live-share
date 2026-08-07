"""WP46 blind-set-2 support module — control-endpoint stub + module bootstrap.

DATA SAFETY: fake in-process HTTP endpoints only, bound to ``127.0.0.1:0``.
Never a real Obsidian instance, never a vault, never ``%APPDATA%``, never the
real rig ports.

Import form pinned by T3_SharedContract: put ``<repo>/tools`` on ``sys.path``
and import the package top-level as ``obsidian_e2e``.
"""

from __future__ import annotations

import json
import pathlib
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_TOOLS = pathlib.Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, readiness  # noqa: E402

REASONS = frozenset(
    {
        constants.READINESS_TIMEOUT,
        constants.IDENTITY_SAME_VAULT,
        constants.IDENTITY_UNKNOWN_VAULT,
        constants.ROOM_MISMATCH,
        constants.PLUGIN_NOT_E2E_CAPABLE,
    }
)

STATE_CHANGING = frozenset(
    {"canvas.open", "canvas.simulateEdit", "canvas.setFlag", "scratch.create", "scratch.remove"}
)

_SESSION_INFO_FIELDS = (
    "clientId",
    "role",
    "roomId",
    "connected",
    "vaultId",
    "vaultName",
    "vaultPath",
    "pluginBuild",
    "canvasSurface",
)


def make_info(**fields) -> dict:
    """Build a ``session.info`` result; unlisted §6.2 fields get neutral defaults."""
    base = dict(
        zip(
            _SESSION_INFO_FIELDS,
            ("e2e-x", "guest", "", False, "", "", None, "1.4.2+e2e", False),
        )
    )
    unknown = set(fields) - set(_SESSION_INFO_FIELDS)
    assert not unknown, f"not a §6.2 field: {sorted(unknown)}"
    base.update(fields)
    return base


class _HttpServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, request, client_address):
        pass


class _Dispatch(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _reply(self, code: int, body: bytes) -> None:
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def do_GET(self):  # noqa: N802
        self.server.stub.note(f"GET {self.path}")  # type: ignore[attr-defined]
        self._reply(404, b'{"ok": false, "error": "not found"}')

    def do_POST(self):  # noqa: N802
        stub: StubEndpoint = self.server.stub  # type: ignore[attr-defined]
        size = int(self.headers.get("Content-Length") or 0)
        text = self.rfile.read(size).decode("utf-8") if size else ""
        try:
            req = json.loads(text) if text.strip() else {}
        except Exception:
            req = {}
        command = req.get("cmd") if isinstance(req, dict) else None
        stub.note(command if isinstance(command, str) else "<undecodable>")

        if stub.kind == "mute":
            stub.unmute.wait(timeout=stub.mute_for_s)
            self._reply(504, b'{"ok": false, "error": "unmuted"}')
            return
        if stub.kind == "verbatim":
            self._reply(stub.http_status, stub.payload)
            return
        if command == "session.info":
            self._reply(200, json.dumps({"ok": True, "result": dict(stub.info)}).encode())
            return
        self._reply(400, json.dumps({"ok": False, "error": f"unknown cmd {command!r}"}).encode())


class StubEndpoint:
    """Kinds: ``reply`` (default), ``mute``, ``verbatim``."""

    def __init__(
        self,
        info: dict | None = None,
        *,
        kind: str = "reply",
        http_status: int = 200,
        payload: bytes = b"",
        mute_for_s: float = 30.0,
    ) -> None:
        self.info = info or {}
        self.kind = kind
        self.http_status = http_status
        self.payload = payload
        self.mute_for_s = mute_for_s
        self.unmute = threading.Event()
        self.port = 0
        self._http: _HttpServer | None = None
        self._notes: list[str] = []
        self._guard = threading.Lock()

    def up(self) -> "StubEndpoint":
        self._http = _HttpServer(("127.0.0.1", 0), _Dispatch)
        self._http.stub = self  # type: ignore[attr-defined]
        self.port = self._http.server_address[1]
        assert self.port not in (constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B)
        threading.Thread(target=self._http.serve_forever, daemon=True).start()
        return self

    def down(self) -> None:
        self.unmute.set()
        if self._http is not None:
            self._http.shutdown()
            self._http.server_close()
            self._http = None

    def __enter__(self) -> "StubEndpoint":
        return self.up()

    def __exit__(self, *exc) -> None:
        self.down()

    def note(self, command: str) -> None:
        with self._guard:
            self._notes.append(command)

    @property
    def notes(self) -> list[str]:
        with self._guard:
            return list(self._notes)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def assert_only_probed(*stubs: StubEndpoint) -> None:
    for stub in stubs:
        seen = set(stub.notes)
        assert not (seen & STATE_CHANGING), f"state-changing command sent: {sorted(seen)}"
        assert seen <= {"session.info"}, f"unexpected traffic: {sorted(seen)}"


def as_script(ns: dict) -> int:
    import traceback

    cases = [v for k, v in sorted(ns.items()) if k.startswith("test_") and callable(v)]
    broken = 0
    for case in cases:
        try:
            case()
            print(f"PASS {case.__name__}")
        except Exception:
            broken += 1
            print(f"FAIL {case.__name__}")
            traceback.print_exc()
    print(f"\n{len(cases) - broken}/{len(cases)} passed")
    return 1 if broken else 0
