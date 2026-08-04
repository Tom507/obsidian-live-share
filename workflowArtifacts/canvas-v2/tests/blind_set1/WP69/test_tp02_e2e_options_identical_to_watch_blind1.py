# WP69 / AC1 — blind 1. Same subject (the e2e mode's option object), different
# angle: the **exact difference set** between each pair of modes, computed rather
# than asserted key by key.
#
# Three modes give three pairs. AC1 fixes all three:
#   ├── e2e  vs watch       → no differing field at all
#   ├── e2e  vs production  → exactly {sourcemap, define}
#   └── watch vs production → exactly {sourcemap, define}
#
# Computing the difference set catches the case a field-by-field test cannot: a
# field ADDED to only one branch. `metafile: true` on the e2e branch alone, or a
# `minify` that appears only in production, changes what ships and would slip past
# "assert define == …; assert sourcemap == …".
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


def opts(root: Path, *argv: str) -> dict:
    log = root / f"{uuid.uuid4().hex}.jsonl"
    log.write_bytes(b"")
    subprocess.run(  # noqa: S603 - fixed argv, fake esbuild, always terminates
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
    contexts = [e["options"] for e in entries if e["event"] == "context"]
    assert len(contexts) == 1, f"argv={argv!r}: expected 1 context() call, got {len(contexts)}"
    return contexts[0]


def delta(left: dict, right: dict) -> set[str]:
    return {k for k in set(left) | set(right) if left.get(k, ...) != right.get(k, ...)}


def test_e2e_and_watch_have_an_empty_difference_set(root: Path) -> None:
    assert delta(opts(root, constants.E2E_BUILD_ARGV), opts(root)) == set()


def test_e2e_and_production_differ_in_exactly_the_two_mode_fields(root: Path) -> None:
    assert delta(opts(root, constants.E2E_BUILD_ARGV), opts(root, "production")) == {
        "sourcemap",
        "define",
    }


def test_watch_and_production_differ_in_the_same_two_fields(root: Path) -> None:
    """The pre-change invariant: adding a third mode must not perturb this pair."""
    assert delta(opts(root), opts(root, "production")) == {"sourcemap", "define"}


def test_no_option_key_exists_in_one_mode_only(root: Path) -> None:
    keys = [
        set(opts(root, constants.E2E_BUILD_ARGV)),
        set(opts(root)),
        set(opts(root, "production")),
    ]
    assert keys[0] == keys[1] == keys[2]


def test_the_define_map_holds_exactly_one_entry_in_every_mode(root: Path) -> None:
    for argv, expected in (
        ((constants.E2E_BUILD_ARGV,), "true"),
        ((), "true"),
        (("production",), "false"),
    ):
        define = opts(root, *argv)["define"]
        assert list(define) == ["__LS_E2E__"], f"argv={argv!r} defines {list(define)!r}"
        assert define["__LS_E2E__"] == expected


def test_the_sourcemap_value_is_inline_for_both_instrumented_modes(root: Path) -> None:
    assert opts(root, constants.E2E_BUILD_ARGV)["sourcemap"] == "inline"
    assert opts(root)["sourcemap"] == "inline"
    assert opts(root, "production")["sourcemap"] is False


def test_canonical_serialisation_of_e2e_and_watch_is_identical(root: Path) -> None:
    """Key order and nesting included — the strongest form of 'identical in every field'."""
    a = json.dumps(opts(root, constants.E2E_BUILD_ARGV), sort_keys=True)
    b = json.dumps(opts(root), sort_keys=True)
    assert a == b
    assert json.dumps(opts(root, "production"), sort_keys=True) != a
