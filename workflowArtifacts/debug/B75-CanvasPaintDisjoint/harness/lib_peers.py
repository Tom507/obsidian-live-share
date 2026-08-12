"""B75 harness — shared transport for the integration probes.

Deliberately the SAME envelope and the same refusal discipline as
`tools/e2e/canvas_diag.py`, so a probe that survives can be lifted into the
project's own e2e tooling without a rewrite:

  * the body field is ``cmd``, never ``command``;
  * a transport failure is a READING, never an exception that hides the peer;
  * a peer that cannot answer is INCOMPLETE, and an incomplete reading is never
    scored as a pass.

Nothing here writes to the vault, the repo or the plugin.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

REPO = Path(__file__).resolve().parents[4]
DEFAULT_PORTS = {"A": 39431, "B": 39432, "C": 39433}
DEFAULT_PATH = "_liveshare-test/SyncTesting.canvas"

# Where each probe drops its raw responses. `S186`: to disk before anything is
# printed, so a lost console does not lose the reading.
EVIDENCE = Path(__file__).resolve().parent / "evidence"


def post(port: int, cmd: str, args: Optional[dict] = None, timeout: float = 30.0) -> dict:
    body = json.dumps({"cmd": cmd, "args": args or {}}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"status": r.status, "body": json.loads(r.read().decode())}
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            payload = None
        return {"status": e.code, "body": payload}
    except Exception as e:  # noqa: BLE001
        return {"status": 0, "body": None, "transport": f"{type(e).__name__}: {e}"}


def result_of(resp: dict) -> Optional[dict]:
    body = resp.get("body")
    if isinstance(body, dict) and body.get("ok") is True and isinstance(body.get("result"), dict):
        return body["result"]
    return None


def unusable(resp: dict) -> Optional[str]:
    """``None`` when this peer's answer can be scored; otherwise why it cannot."""
    if resp.get("transport"):
        return f"transport failed: {resp['transport']}"
    if resp.get("status") != 200:
        body = resp.get("body")
        err = body.get("error") if isinstance(body, dict) else body
        return f"HTTP {resp.get('status')}: {err}"
    if result_of(resp) is None:
        return f"envelope not ok: {resp.get('body')}"
    return None


def census(port: int, path: str) -> dict:
    return post(port, "canvas.diag", {"op": "census", "path": path})


def paint_plane(result: dict) -> dict:
    c = result.get("census")
    if not isinstance(c, dict):
        return {}
    p = c.get("paint")
    return p if isinstance(p, dict) else {}


def repaint_report(result: dict) -> dict:
    c = result.get("census")
    if not isinstance(c, dict):
        return {}
    r = c.get("repaint")
    return r if isinstance(r, dict) else {}


def save(label: str, payload: Any) -> Path:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    out = EVIDENCE / f"{label}.json"
    out.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return out


def peers_from_args(args) -> dict[str, int]:
    if not getattr(args, "ports", None):
        return dict(DEFAULT_PORTS)
    ports = [int(p.strip()) for p in args.ports.split(",") if p.strip()]
    names = ["A", "B", "C", "D", "E", "F"][: len(ports)]
    return dict(zip(names, ports))


def add_common_args(ap) -> None:
    ap.add_argument("--ports", default=None, help="comma-separated control ports (default 39431,39432,39433)")
    ap.add_argument("--path", default=DEFAULT_PATH, help="the .canvas path under test")


def verdict(probe_id: str, ok: bool, lines: list[str]) -> int:
    """Print the contract line last, after the evidence. Exit code is the result."""
    for line in lines:
        print(f"    {line}")
    print(f"{probe_id} {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1
