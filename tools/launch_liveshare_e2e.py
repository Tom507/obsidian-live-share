#!/usr/bin/env python3
"""WP6 — Two-instance liveshare-e2e launcher (US6).

Boots TWO lightweight plugin hosts (A + B) on distinct control ports against one
local relay, prints both control ports + the shared room id, and stays alive
until Ctrl-C (which shuts both hosts down cleanly, freeing both ports).

It does this by bundling the TypeScript launcher entry
(plugin/src/__tests__/e2e/launch-entry.ts) to a single ESM file with the plugin's
own esbuild (the same tool `npm run build` uses — no new dependency), then running
that bundle with node. The bundle reuses the wp5/harness.ts real-relay/real-client
pattern (createApp(noopPersistence) + real SyncManager) and the WP4 control server.

All paths are resolved RELATIVE to this file (never hardcoded absolute paths), so
the launcher works from any clone location.

Usage (from anywhere):
    python <repo>/tools/launch_liveshare_e2e.py [--port-a N] [--port-b N]
                                                [--relay-port N] [--skip-build]

Env knobs are also honored (LIVESHARE_E2E_PORT_A/B, LIVESHARE_RELAY_PORT,
LIVESHARE_ROOM_NAME); CLI flags win over env.

Windows note (Skill_WindowsShellSyntax): run this in a real console via the
visible-console MCP `run_python` so Ctrl-C reaches node and triggers its graceful
SIGINT shutdown. Do NOT background it via the Bash tool.
"""
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
from pathlib import Path

# tools/launch_liveshare_e2e.py  ->  repo root is the parent of tools/
REPO_ROOT = Path(__file__).resolve().parent.parent
PLUGIN_DIR = REPO_ROOT / "plugin"
SERVER_DIR = REPO_ROOT / "server"
ENTRY_TS = PLUGIN_DIR / "src" / "__tests__" / "e2e" / "launch-entry.ts"
ESBUILD_CLI = PLUGIN_DIR / "node_modules" / "esbuild" / "bin" / "esbuild"
# The sync client transitively imports "obsidian" (via src/utils.ts). Alias it to
# the SAME headless mock vitest uses (vitest.config.ts) so the bundle runs in node.
OBSIDIAN_MOCK = PLUGIN_DIR / "src" / "__mocks__" / "obsidian.ts"

# Emit the bundle INSIDE server/node_modules/.cache so the externalized server
# packages (native/dynamic-require CJS: express, level, ws, ...) resolve at runtime
# from server/node_modules. Pure-JS deps (yjs, lib0, y-protocols, minimatch) are
# bundled inline. We run a tiny SHIM that dynamic-imports the bundle so the bundled
# server's `isMain` bootstrap (argv[1] === import.meta.url) stays false — otherwise
# it would spin up a second real relay on :3000 with a level DB.
OUT_BUNDLE = SERVER_DIR / "node_modules" / ".cache" / "liveshare-e2e-launcher.mjs"
RUN_SHIM = SERVER_DIR / "node_modules" / ".cache" / "liveshare-e2e-run.mjs"

# Server runtime deps to keep external (resolved from server/node_modules at run).
SERVER_EXTERNALS = [
    "express",
    "cors",
    "express-rate-limit",
    "jsonwebtoken",
    "level",
    "ws",
    "nanoid",
]


def die(msg: str, code: int = 1) -> None:
    print(f"[launcher] ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def preflight() -> None:
    if not ENTRY_TS.is_file():
        die(f"launcher entry not found: {ENTRY_TS}")
    if not OBSIDIAN_MOCK.is_file():
        die(f"obsidian mock not found: {OBSIDIAN_MOCK}")
    if not ESBUILD_CLI.is_file():
        die(
            "esbuild not found under plugin/node_modules — run `npm install` in "
            f"{PLUGIN_DIR} first (esbuild is an existing devDependency, no new dep)."
        )
    if not (SERVER_DIR / "node_modules").is_dir():
        die(
            "server/node_modules missing — run `npm install` in "
            f"{SERVER_DIR} first (the launcher boots the real server/ relay)."
        )


def build_bundle() -> None:
    OUT_BUNDLE.parent.mkdir(parents=True, exist_ok=True)
    # node <esbuild-cli> is cross-platform (avoids .cmd/.exe shim differences).
    cmd = [
        "node",
        str(ESBUILD_CLI),
        str(ENTRY_TS),
        "--bundle",
        "--platform=node",
        "--format=esm",
        "--target=node18",
        f"--alias:obsidian={OBSIDIAN_MOCK}",
        # createRequire shim so any remaining bundled CJS dep can require() builtins.
        '--banner:js=import{createRequire as __cr}from"module";const require=__cr(import.meta.url);',
        f"--outfile={OUT_BUNDLE}",
        "--log-level=warning",
    ]
    for pkg in SERVER_EXTERNALS:
        cmd.append(f"--external:{pkg}")
    print(f"[launcher] bundling {ENTRY_TS.name} -> {OUT_BUNDLE}")
    res = subprocess.run(cmd, cwd=str(REPO_ROOT))
    if res.returncode != 0:
        die(f"esbuild bundle failed (exit {res.returncode})", res.returncode)
    # Write the run shim (dynamic import keeps the bundled server's isMain false).
    RUN_SHIM.write_text(f'import("./{OUT_BUNDLE.name}");\n', encoding="utf-8")


def run_bundle(env_overrides: dict[str, str]) -> int:
    env = {**os.environ, **env_overrides}
    print(f"[launcher] running {RUN_SHIM} with node (Ctrl-C to stop)\n")
    # Inherit stdio + console so a console Ctrl-C reaches node too and node runs
    # its own graceful SIGINT shutdown. The finally block guarantees the node
    # child is torn down (ports freed) no matter how this wrapper exits — so there
    # is never an orphaned host/port (US6 AC6).
    proc = subprocess.Popen(["node", str(RUN_SHIM)], cwd=str(REPO_ROOT), env=env)

    def _terminate_child() -> None:
        if proc.poll() is not None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

    # Also free the child on a plain SIGTERM to this wrapper (e.g. kill from a
    # supervisor) — not just on console Ctrl-C.
    def _on_sigterm(_signum, _frame) -> None:  # noqa: ANN001
        _terminate_child()
        sys.exit(0)

    try:
        signal.signal(signal.SIGTERM, _on_sigterm)
    except (ValueError, OSError):
        pass  # not on the main thread / unsupported — finally still covers it

    try:
        return proc.wait()
    except KeyboardInterrupt:
        # Console Ctrl-C was already delivered to node too; let it settle, then
        # force-free the ports if it is still alive.
        try:
            return proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _terminate_child()
            return proc.returncode if proc.returncode is not None else 0
    finally:
        _terminate_child()


def main() -> int:
    ap = argparse.ArgumentParser(description="liveshare-e2e two-instance launcher (WP6)")
    ap.add_argument("--port-a", type=int, help="control port for host A (default 39421)")
    ap.add_argument("--port-b", type=int, help="control port for host B (default 39422)")
    ap.add_argument(
        "--relay-port",
        type=int,
        help="connect to an EXISTING local relay on this port instead of an in-process one",
    )
    ap.add_argument("--room-name", type=str, help="relay room name (default auto)")
    ap.add_argument("--skip-build", action="store_true", help="reuse the existing bundle")
    args = ap.parse_args()

    preflight()
    if not args.skip_build or not OUT_BUNDLE.is_file() or not RUN_SHIM.is_file():
        build_bundle()

    env_overrides: dict[str, str] = {}
    if args.port_a is not None:
        env_overrides["LIVESHARE_E2E_PORT_A"] = str(args.port_a)
    if args.port_b is not None:
        env_overrides["LIVESHARE_E2E_PORT_B"] = str(args.port_b)
    if args.relay_port is not None:
        env_overrides["LIVESHARE_RELAY_PORT"] = str(args.relay_port)
    if args.room_name is not None:
        env_overrides["LIVESHARE_ROOM_NAME"] = args.room_name

    return run_bundle(env_overrides)


if __name__ == "__main__":
    sys.exit(main())
