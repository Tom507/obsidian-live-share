# WP69 / AC1 — blind 1. Same subject (the one added package.json script),
# different angle: the script is not checked against a literal, it is **executed**.
#
# The visible test asserts the script's text. A script can be textually plausible
# and still not reach the mode — a typo'd token, `--mode=e2e` instead of a bare
# argv[2], `production` copied by accident. Here the argv the script actually
# passes is lifted out of the recorded command and fed to the real config file
# through the fake-esbuild seam, and the outcome must be the one-shot instrumented
# build.
#
# Second angle: no OTHER script may reach the new mode, and no script may have been
# widened. `npm run dev` in particular must still be the never-terminating watch.
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

PACKAGE_JSON = _REPO / "plugin" / "package.json"
CONFIG = _REPO / "plugin" / "esbuild.config.mjs"

_STUB_PKG = (
    '{"name":"esbuild","version":"0.0.0-stub","type":"module",'
    '"main":"./index.mjs","exports":{".":"./index.mjs"}}'
)

_STUB_INDEX = r"""
import fs from "node:fs";
import process from "node:process";
const rec = (o) => fs.appendFileSync(process.env.LS_STUB_LOG, JSON.stringify(o) + "\n");
process.on("beforeExit", () => rec({ event: "beforeExit" }));
process.on("exit", (code) => rec({ event: "exit", code }));
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

PRE_EXISTING = ("dev", "build", "test", "test:watch", "lint", "format")


def pkg() -> dict:
    return json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))


def config_argv(command: str) -> list[str]:
    """The arguments the script hands to `esbuild.config.mjs`, in order."""
    assert "esbuild.config.mjs" in command, f"{command!r} does not invoke the config"
    return command.split("esbuild.config.mjs", 1)[1].split()


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


def trace(root: Path, argv: list[str]) -> tuple[list[str], dict]:
    log = root / f"{uuid.uuid4().hex}.jsonl"
    log.write_bytes(b"")
    subprocess.run(  # noqa: S603 - argv comes from package.json, fake esbuild
        [node_exe(), str(root / "esbuild.config.mjs"), *argv],
        cwd=str(root),
        env=dict(os.environ, LS_STUB_LOG=str(log)),
        capture_output=True,
        text=True,
        timeout=120,  # safety net only — never an assertion
        check=False,
    )
    entries = [
        json.loads(line)
        for line in log.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    options = next((e["options"] for e in entries if e["event"] == "context"), {})
    return [e["event"] for e in entries], options


def test_the_added_script_actually_reaches_the_one_shot_instrumented_build(
    root: Path,
) -> None:
    argv = config_argv(pkg()["scripts"][constants.E2E_BUILD_SCRIPT])
    events, options = trace(root, argv)
    assert "rebuild" in events
    assert "watch" not in events
    assert "beforeExit" not in events  # ended by process.exit(), i.e. it terminates
    assert options["define"]["__LS_E2E__"] == "true"
    assert options["sourcemap"] == "inline"


def test_the_dev_script_still_reaches_the_never_terminating_watch(root: Path) -> None:
    events, options = trace(root, config_argv(pkg()["scripts"]["dev"]))
    assert "watch" in events
    assert "rebuild" not in events
    assert options["define"]["__LS_E2E__"] == "true"


def test_the_build_script_still_reaches_the_production_mode(root: Path) -> None:
    events, options = trace(root, config_argv(pkg()["scripts"]["build"]))
    assert "rebuild" in events
    assert "watch" not in events
    assert options["define"]["__LS_E2E__"] == "false"
    assert options["sourcemap"] is False


def test_no_other_script_mentions_the_e2e_argv_token(root: Path) -> None:
    scripts = pkg()["scripts"]
    for name in PRE_EXISTING:
        assert constants.E2E_BUILD_ARGV not in scripts[name].split(), (
            f"pre-existing script {name!r} was widened to the e2e mode"
        )


def test_exactly_one_name_was_added_and_it_is_the_pinned_one() -> None:
    added = set(pkg()["scripts"]) - set(PRE_EXISTING)
    assert added == {constants.E2E_BUILD_SCRIPT}


def test_the_script_set_is_not_reordered_or_pruned() -> None:
    names = list(pkg()["scripts"])
    # Append, never edit or reorder (B9b shared-ownership rule 1).
    assert names[: len(PRE_EXISTING)] == list(PRE_EXISTING)


def test_the_added_script_introduces_no_new_binary() -> None:
    """No dependency is added (AC1), so no new executable may appear either.

    `node` and `tsc` are the two already used by `dev` and `build`; anything else in
    the added script means a tool that is not in `devDependencies`.
    """
    command = pkg()["scripts"][constants.E2E_BUILD_SCRIPT]
    binaries = {segment.split()[0] for segment in command.split("&&") if segment.split()}
    assert binaries <= {"node", "tsc"}, f"unexpected binary in {command!r}: {binaries}"
    # The config invocation is the last thing the script does — it is the build.
    assert command.split("&&")[-1].split()[0] == "node"
