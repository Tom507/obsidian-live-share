"""WP46 blind-set-1 support module — control-endpoint stub + module bootstrap.

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

REFUSAL_REASONS = frozenset(
    {
        constants.READINESS_TIMEOUT,
        constants.IDENTITY_SAME_VAULT,
        constants.IDENTITY_UNKNOWN_VAULT,
        constants.ROOM_MISMATCH,
        constants.PLUGIN_NOT_E2E_CAPABLE,
    }
)

WRITE_COMMANDS = frozenset(
    {"canvas.open", "canvas.simulateEdit", "canvas.setFlag", "scratch.create", "scratch.remove"}
)


def info_payload(vault: str, room: str, **over) -> dict:
    """``session.info`` result with the §6.2 fields; ``over`` replaces any of them."""
    payload = {
        "clientId": "e2e-a",
        "role": "host",
        "roomId": room,
        "connected": True,
        "vaultId": vault,
        "vaultName": pathlib.PureWindowsPath(vault).name or vault,
        "vaultPath": vault,
        "pluginBuild": "1.4.2+e2e",
        "canvasSurface": True,
    }
    payload.update(over)
    return payload


class _Srv(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, request, client_address):
        pass


class _Route(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _emit(self, code: int, blob: bytes) -> None:
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(blob)))
            self.end_headers()
            self.wfile.write(blob)
        except OSError:
            pass

    def do_GET(self):  # noqa: N802
        self.server.stub.seen(f"GET {self.path}")  # type: ignore[attr-defined]
        self._emit(404, b'{"ok": false, "error": "not found"}')

    def do_POST(self):  # noqa: N802
        stub: ControlStub = self.server.stub  # type: ignore[attr-defined]
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n).decode("utf-8") if n else ""
        try:
            parsed = json.loads(raw) if raw.strip() else {}
        except Exception:
            parsed = {}
        cmd = parsed.get("cmd") if isinstance(parsed, dict) else None
        stub.seen(cmd if isinstance(cmd, str) else "<unparsable>")

        behaviour = stub.behaviour
        if behaviour == "silent":
            stub.gate.wait(timeout=stub.silence_s)
            self._emit(504, b'{"ok": false, "error": "gate opened"}')
        elif behaviour == "bytes":
            self._emit(stub.code, stub.blob)
        elif cmd == "session.info":
            self._emit(200, json.dumps({"ok": True, "result": dict(stub.info)}).encode())
        else:
            self._emit(400, json.dumps({"ok": False, "error": f"unknown cmd {cmd!r}"}).encode())


class ControlStub:
    """Behaviours: ``answer`` (default), ``silent``, ``bytes``."""

    def __init__(
        self,
        info: dict | None = None,
        *,
        behaviour: str = "answer",
        code: int = 200,
        blob: bytes = b"",
        silence_s: float = 30.0,
    ) -> None:
        self.info = info or {}
        self.behaviour = behaviour
        self.code = code
        self.blob = blob
        self.silence_s = silence_s
        self.gate = threading.Event()
        self.port = 0
        self._srv: _Srv | None = None
        self._log: list[str] = []
        self._mutex = threading.Lock()

    def open(self) -> "ControlStub":
        self._srv = _Srv(("127.0.0.1", 0), _Route)
        self._srv.stub = self  # type: ignore[attr-defined]
        self.port = self._srv.server_address[1]
        assert self.port not in (constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B)
        threading.Thread(target=self._srv.serve_forever, daemon=True).start()
        return self

    def shut(self) -> None:
        self.gate.set()
        if self._srv is not None:
            self._srv.shutdown()
            self._srv.server_close()
            self._srv = None

    def __enter__(self) -> "ControlStub":
        return self.open()

    def __exit__(self, *exc) -> None:
        self.shut()

    def seen(self, cmd: str) -> None:
        with self._mutex:
            self._log.append(cmd)

    @property
    def log(self) -> list[str]:
        with self._mutex:
            return list(self._log)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def assert_untouched(*stubs: ControlStub) -> None:
    for stub in stubs:
        cmds = set(stub.log)
        assert not (cmds & WRITE_COMMANDS), f"an edit reached the instance: {sorted(cmds)}"
        assert cmds <= {"session.info"}, f"unexpected traffic: {sorted(cmds)}"


def script_main(ns: dict) -> int:
    import traceback

    tests = [v for k, v in sorted(ns.items()) if k.startswith("test_") and callable(v)]
    bad = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception:
            bad += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - bad}/{len(tests)} passed")
    return 1 if bad else 0
