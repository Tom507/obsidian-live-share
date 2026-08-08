"""WP124 — run the PRODUCTION convergence oracle headlessly, over real HTTP.

WHAT THIS IS FOR
----------------
`tools/e2e/ls_records.py` is the driver side of the records oracle. Its whole
job is to notice when the rig did NOT judge a records expectation, and a test of
that property is worthless unless the rig on the other end of the socket is the
real one. This module bundles `plugin/src/__tests__/e2e/judge-entry.ts` with the
plugin's own esbuild (an existing devDependency — no new dep, the same trick
`tools/launch_liveshare_e2e.py` already uses) and runs it with node, so a python
test can POST `convergence.judge` to the SHIPPED `routeCommand`.

WHAT IT IS NOT
--------------
It is NOT a rig. There is no vault, no relay, no Obsidian, no peer. The host
object behind the control server is empty on purpose, so `convergence.judge` —
which is pure and reads no host member — answers exactly as a live instance
does, and every other command answers with a structured failure. See the header
of `judge-entry.ts`.

It also never touches ports 39431/39432/39433. It binds an EPHEMERAL port on
127.0.0.1 (`port: 0`) and prints it, so it can never collide with a live
instance under validation.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

# tools/e2e/judge_bridge.py -> repo root is two levels up
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PLUGIN_DIR = REPO_ROOT / "plugin"
ENTRY_TS = PLUGIN_DIR / "src" / "__tests__" / "e2e" / "judge-entry.ts"
ESBUILD_CLI = PLUGIN_DIR / "node_modules" / "esbuild" / "bin" / "esbuild"
#: the SAME headless mock vitest resolves `obsidian` to (see plugin/vitest.config.ts)
OBSIDIAN_MOCK = PLUGIN_DIR / "src" / "__mocks__" / "obsidian.ts"
OUT_BUNDLE = PLUGIN_DIR / "node_modules" / ".cache" / "ls-judge-bridge.mjs"

PORT_LINE = "JUDGE_BRIDGE_PORT "


class BridgeUnavailable(RuntimeError):
    """The bridge could not be built or did not bind. NEVER swallowed into a
    green: a test that cannot reach the oracle has measured nothing."""


def _preflight() -> None:
    if not ENTRY_TS.is_file():
        raise BridgeUnavailable(f"judge entry not found: {ENTRY_TS}")
    if not OBSIDIAN_MOCK.is_file():
        raise BridgeUnavailable(f"obsidian mock not found: {OBSIDIAN_MOCK}")
    if not ESBUILD_CLI.is_file():
        raise BridgeUnavailable(
            "esbuild not found under plugin/node_modules — run `npm install` in "
            f"{PLUGIN_DIR} first (esbuild is an existing devDependency, no new dep)."
        )


def build_bundle(force: bool = False) -> Path:
    """Bundle the judge entry to ESM. Cheap enough to do per test session."""
    _preflight()
    if OUT_BUNDLE.is_file() and not force:
        newest_src = max(
            p.stat().st_mtime
            for p in (ENTRY_TS, PLUGIN_DIR / "src" / "testing" / "e2e-control.ts")
        )
        if OUT_BUNDLE.stat().st_mtime > newest_src:
            return OUT_BUNDLE
    OUT_BUNDLE.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "node",
        str(ESBUILD_CLI),
        str(ENTRY_TS),
        "--bundle",
        "--platform=node",
        "--format=esm",
        "--target=node18",
        f"--alias:obsidian={OBSIDIAN_MOCK}",
        '--banner:js=import{createRequire as __cr}from"module";'
        "const require=__cr(import.meta.url);",
        f"--outfile={OUT_BUNDLE}",
        "--log-level=warning",
    ]
    res = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True)
    if res.returncode != 0:
        raise BridgeUnavailable(
            f"esbuild bundle failed (exit {res.returncode}):\n{res.stderr[:2000]}"
        )
    return OUT_BUNDLE


class JudgeBridge:
    """A live node process serving the production `/command` endpoint.

    Use as a context manager. `post` mirrors what a live driver does byte for
    byte: `POST http://127.0.0.1:<port>/command` with a `{cmd, args}` body.
    """

    def __init__(self, bundle: Optional[Path] = None, boot_timeout: float = 60.0):
        self._bundle = bundle or build_bundle()
        self._boot_timeout = boot_timeout
        self._proc: Optional[subprocess.Popen] = None
        self.port: int = 0

    def __enter__(self) -> "JudgeBridge":
        self._proc = subprocess.Popen(
            ["node", str(self._bundle)],
            cwd=str(REPO_ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        deadline = time.monotonic() + self._boot_timeout
        while time.monotonic() < deadline:
            line = self._proc.stdout.readline() if self._proc.stdout else ""
            if line.startswith(PORT_LINE):
                self.port = int(line[len(PORT_LINE):].strip())
                return self
            if line == "" and self._proc.poll() is not None:
                err = self._proc.stderr.read() if self._proc.stderr else ""
                raise BridgeUnavailable(
                    f"judge bridge exited {self._proc.returncode} before binding:\n{err[:2000]}"
                )
        self.close()
        raise BridgeUnavailable(
            f"judge bridge did not print its port within {self._boot_timeout:.0f}s"
        )

    def __exit__(self, *_exc: Any) -> None:
        self.close()

    def close(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
            proc.wait(timeout=10)
        except Exception:  # noqa: BLE001
            proc.kill()
            proc.wait(timeout=10)

    # -- the wire -----------------------------------------------------------
    def post(self, cmd: str, args: Optional[dict] = None, timeout: float = 30.0) -> dict:
        """POST one command. Returns the parsed body for BOTH 200 and 400, so a
        structured refusal is a result to assert on rather than an exception."""
        if self.port == 0:
            raise BridgeUnavailable("the bridge is not bound")
        body = json.dumps({"cmd": cmd, "args": args or {}}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/command",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"ok": False, "error": f"HTTP {e.code}: {raw[:400]}"}


if __name__ == "__main__":  # pragma: no cover — manual smoke
    with JudgeBridge() as bridge:
        print(f"bound on 127.0.0.1:{bridge.port}", file=sys.stderr)
        print(json.dumps(bridge.post("session.info"), indent=2))
