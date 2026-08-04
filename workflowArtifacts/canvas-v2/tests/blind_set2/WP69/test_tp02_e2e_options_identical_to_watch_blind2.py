# WP69 / AC1 — blind 2. Same subject (the e2e mode's option object), different
# angle: **the options must depend on argv[2] and on nothing else**.
#
# The config is executed under a deliberately hostile environment — `NODE_ENV`,
# `LIVESHARE_E2E`, `CI`, `ESBUILD_*` all set — and the recorded option object must
# be byte-for-byte the same as under a clean environment. An implementation that
# reaches for `process.env` to decide the mode (a very natural way to add a third
# one) would make the shipped production bundle depend on the shell it was built
# from, which is the silent-ship failure AC2 exists to catch, arriving through a
# different door.
#
# Second angle: the option object is compared as canonical JSON, so key ORDER and
# nesting are part of the comparison.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

# --- repo bootstrap (T3 shared contract §0.2): <repo>/tools on sys.path, top-level pkg ---
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover - only fires if the file is moved outside the repo
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants  # noqa: E402

CONFIG = _REPO / "plugin" / "esbuild.config.mjs"

_STUB_PKG = (
    '{"name":"esbuild","version":"0.0.0-stub","type":"module",'
    '"main":"./index.mjs","exports":{".":"./index.mjs"}}'
)

_STUB_INDEX = r"""
import fs from "node:fs";
import process from "node:process";
const rec = (o) => fs.appendFileSync(process.env.LS_STUB_LOG, JSON.stringify(o) + "\n");
async function context(options) {
  rec({ event: "context", options });
  return {
    rebuild: async () => { rec({ event: "rebuild" }); return { errors: [], warnings: [] }; },
    watch: async () => { rec({ event: "watch" }); },
    dispose: async () => { rec({ event: "dispose" }); },
  };
}
export default { context };
export { context };
"""

#: A shell that has been used for something else. None of this may reach the bundle.
HOSTILE_ENV = {
    "NODE_ENV": "production",
    "LIVESHARE_E2E": "39431",
    "CI": "true",
    "ESBUILD_BINARY_PATH": "",
    "npm_lifecycle_event": "build",
    "npm_config_production": "true",
}


def node_exe() -> str:
    exe = shutil.which("node")
    if exe is None:  # a skip here would be a green that cannot fail
        raise RuntimeError("node is not on PATH; the AC1 build-mode tests cannot run")
    return exe


@pytest.fixture()
def root(tmp_path: Path) -> Path:
    r = tmp_path / "esb"
    stub = r / "node_modules" / "esbuild"
    stub.mkdir(parents=True)
    (stub / "package.json").write_text(_STUB_PKG, encoding="utf-8")
    (stub / "index.mjs").write_text(_STUB_INDEX, encoding="utf-8")
    shutil.copyfile(CONFIG, r / "esbuild.config.mjs")
    return r


def canonical_options(root: Path, argv: tuple[str, ...], extra_env: dict | None = None) -> str:
    log = root / f"{uuid.uuid4().hex}.jsonl"
    log.write_bytes(b"")
    env = dict(os.environ, LS_STUB_LOG=str(log))
    env.update(extra_env or {})
    subprocess.run(  # noqa: S603 - fixed argv, fake esbuild, always terminates
        [node_exe(), str(root / "esbuild.config.mjs"), *argv],
        cwd=str(root),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,  # safety net only — never an assertion
        check=False,
    )
    contexts = [
        json.loads(line)["options"]
        for line in log.read_text(encoding="utf-8").splitlines()
        if line.strip() and json.loads(line)["event"] == "context"
    ]
    assert len(contexts) == 1, f"argv={argv!r}: expected 1 context() call"
    return json.dumps(contexts[0], sort_keys=True, separators=(",", ":"))


def test_e2e_and_watch_serialise_identically(root: Path) -> None:
    assert canonical_options(root, (constants.E2E_BUILD_ARGV,)) == canonical_options(root, ())


def test_e2e_is_not_the_same_as_production(root: Path) -> None:
    """Guards the equality above from passing on a config that lost its branch."""
    assert canonical_options(root, (constants.E2E_BUILD_ARGV,)) != canonical_options(
        root, ("production",)
    )


@pytest.mark.parametrize("argv", [(), ("production",), (constants.E2E_BUILD_ARGV,)])
def test_a_hostile_environment_does_not_change_the_options(
    root: Path, argv: tuple[str, ...]
) -> None:
    clean = canonical_options(root, argv)
    dirty = canonical_options(root, argv, HOSTILE_ENV)
    assert clean == dirty, f"argv={argv!r}: the build options depend on the environment"


def test_the_instrumented_flag_is_true_under_a_production_shaped_environment(
    root: Path,
) -> None:
    """NODE_ENV=production must not fold the e2e mode's flag to false."""
    options = json.loads(canonical_options(root, (constants.E2E_BUILD_ARGV,), HOSTILE_ENV))
    assert options["define"]["__LS_E2E__"] == "true"
    assert options["sourcemap"] == "inline"


def test_the_production_flag_is_false_under_an_e2e_shaped_environment(
    root: Path,
) -> None:
    """…and LIVESHARE_E2E in the shell must not leak instrumentation into what ships."""
    options = json.loads(canonical_options(root, ("production",), HOSTILE_ENV))
    assert options["define"]["__LS_E2E__"] == "false"
    assert options["sourcemap"] is False


def test_the_entry_point_and_output_are_the_same_in_all_three_modes(root: Path) -> None:
    shapes = [
        json.loads(canonical_options(root, argv))
        for argv in ((), ("production",), (constants.E2E_BUILD_ARGV,))
    ]
    assert {s["outfile"] for s in shapes} == {"main.js"}
    assert {json.dumps(s["entryPoints"]) for s in shapes} == {json.dumps(["src/main.ts"])}
    assert {json.dumps(s["external"]) for s in shapes} == {json.dumps(shapes[0]["external"])}
    assert {s["treeShaking"] for s in shapes} == {True}
