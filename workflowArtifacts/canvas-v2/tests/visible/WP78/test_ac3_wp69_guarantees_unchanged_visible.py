# WP78 / AC3 — "WP69's landed guarantees are unchanged, and this is SHOWN rather than
# asserted."
#
# The criterion names its own vacuity: "the WP69 tests still pass" with no count is not
# evidence. The counts are measured by running those suites and are recorded in
# `ImplementationReport_WP78.md`; what this file adds is the structural half — the parts of
# WP69 that a signature change could plausibly have reached, asserted directly, plus a
# measurement that no WP69 test file was touched at all.
#
#   ├── T1  the build command is the same tuple, from the same one npm script
#   ├── T2  the capability oracle is exit status AND all three markers — never existence,
#   │       never mtime — and each half still vetoes on its own
#   ├── T3  the non-integer-status refusal survives, at both levels
#   ├── T4  a failed build leaves the previous bundle BYTE-untouched
#   ├── T5  install/restore is untouched, and the REASON is asserted structurally: neither
#   │       `capture_bundle_state` nor `install_bundle` nor `restore_bundle` calls
#   │       `build_e2e_bundle` or reads `runner`, so a change to the build's argument list
#   │       cannot reach the byte comparison against the recorded restore point
#   ├── T6  a real install → restore round trip is byte-exact, end to end
#   ├── T7  the 22 WP69 call sites are BYTE-unchanged since the baseline commit, measured
#   │       against git rather than asserted — no test deleted, weakened, retitled, skipped
#   │       or amended, so no §7 licence of any class is engaged
#   └── T8  `install.__all__` gained exactly one name and lost none
#
# DATA SAFETY: every fixture is synthetic and under `tmp_path`. No file in either owner vault
# is read, opened, hashed or pointed at; the `data.json` written into the fixture vault is an
# obviously fake literal. No build is run, no process started, no Obsidian launched.

from __future__ import annotations

import ast
import hashlib
import subprocess
import sys
from pathlib import Path
from typing import Iterator

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))

import _prerepair  # noqa: E402
import _spawn_oracle as oracle  # noqa: E402
from obsidian_e2e import constants, install  # noqa: E402

PACKAGE = _TOOLS / "obsidian_e2e"
WP69_TEST_DIRS = (
    "workflowArtifacts/canvas-v2/tests/visible/WP69",
    "workflowArtifacts/canvas-v2/tests/blind_set1/WP69",
    "workflowArtifacts/canvas-v2/tests/blind_set2/WP69",
)

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

PRODUCTION_MAIN = b'"use strict";var live=1;module.exports={};\n' * 8
E2E_MAIN = (
    b'"use strict";var __LS_E2E__=true;\n'
    + b"".join(b"/* " + m.encode("utf-8") + b" */\n" for m in constants.E2E_BUILD_MARKERS)
    + b"module.exports={};\n"
)
#: Obviously fake — no value here resembles a credential, and none is ever printed.
FAKE_DATA_JSON = b'{"serverPassword":"FAKE-NOT-REAL-0000","roomId":"fixture-room"}\n'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class RecordingRunner:
    def __init__(self, status: object = 0, *, emit: bytes | None = None, at: Path | None = None):
        self.status = status
        self.emit = emit
        self.at = at
        self.calls: list = []

    def __call__(self, command, cwd):
        self.calls.append((tuple(command), cwd))
        if self.emit is not None and self.at is not None:
            self.at.write_bytes(self.emit)
        return self.status


@pytest.fixture()
def plugin_dir(tmp_path: Path) -> Path:
    root = (tmp_path / "synthetic-plugin").resolve()
    for owner in OWNER_VAULTS:
        assert root != owner.resolve() and owner.resolve() not in root.parents
    root.mkdir()
    return root


@pytest.fixture()
def vault(tmp_path: Path) -> Iterator[Path]:
    root = (tmp_path / "synthetic-vault").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP78 fixture vault must never be rooted at or inside an owner vault"
        )
    plugin = root / constants.PLUGIN_DIR_REL
    plugin.mkdir(parents=True)
    (plugin / "main.js").write_bytes(PRODUCTION_MAIN)
    (plugin / "manifest.json").write_bytes(b'{"id":"live-share","version":"0.6.1"}\n')
    (plugin / "styles.css").write_bytes(b".live-share{color:red}\n")
    (plugin / "data.json").write_bytes(FAKE_DATA_JSON)
    (plugin / "main.js.bak").write_bytes(b"owner backup, not ours\n")
    (root / constants.COMMUNITY_PLUGINS_REL).write_bytes(b'["live-share"]\n')
    yield root


# ---------------------------------------------------------------------------------
# T1 / T2 / T3 / T4 — the build and its oracle
# ---------------------------------------------------------------------------------


def test_t1_the_build_command_is_unchanged() -> None:
    assert install.build_command() == ("npm", "run", constants.E2E_BUILD_SCRIPT)
    assert constants.E2E_BUILD_SCRIPT == "build:e2e"
    assert constants.E2E_BUILD_ARGV == "e2e"


def test_t2_the_capability_oracle_still_needs_status_and_all_three_markers(
    plugin_dir: Path,
) -> None:
    bundle = plugin_dir / install.BUNDLE_NAME

    # Both halves present → capable.
    bundle.write_bytes(E2E_MAIN)
    result = install.verify_e2e_bundle(bundle, exit_status=0)
    assert result.e2e_capable is True
    assert result.markers_found == tuple(constants.E2E_BUILD_MARKERS)

    # Clean exit, one marker missing → refused, whatever is on disk.
    missing_one = E2E_MAIN.replace(constants.E2E_BUILD_MARKERS[1].encode("utf-8"), b"XX")
    bundle.write_bytes(missing_one)
    with pytest.raises(install.BundleNotE2ECapable):
        install.verify_e2e_bundle(bundle, exit_status=0)

    # Non-zero exit → refused without consulting the file at all: the bundle here is a
    # perfectly good E2E bundle, and it is still not accepted.
    bundle.write_bytes(E2E_MAIN)
    with pytest.raises(install.E2EBuildFailed):
        install.verify_e2e_bundle(bundle, exit_status=1)

    # Existence is not the oracle: a clean exit that emitted nothing is refused.
    bundle.unlink()
    with pytest.raises(install.BundleNotE2ECapable):
        install.verify_e2e_bundle(bundle, exit_status=0)


def test_t3_a_non_integer_status_is_still_refused(plugin_dir: Path) -> None:
    (plugin_dir / install.BUNDLE_NAME).write_bytes(E2E_MAIN)
    with pytest.raises(install.E2EBuildFailed) as at_build:
        install.build_e2e_bundle(plugin_dir, runner=RecordingRunner(None))
    assert "NoneType" in str(at_build.value)
    with pytest.raises(install.E2EBuildFailed):
        install.verify_e2e_bundle(plugin_dir / install.BUNDLE_NAME, exit_status=True)


def test_t4_a_failed_build_leaves_the_previous_bundle_byte_untouched(plugin_dir: Path) -> None:
    bundle = plugin_dir / install.BUNDLE_NAME
    bundle.write_bytes(PRODUCTION_MAIN)
    before = sha(bundle.read_bytes())
    with pytest.raises(install.E2EBuildFailed):
        install.build_e2e_bundle(plugin_dir, runner=RecordingRunner(1))
    assert sha(bundle.read_bytes()) == before


# ---------------------------------------------------------------------------------
# T5 — the restore oracle survives trivially, and the REASON is asserted
# ---------------------------------------------------------------------------------


def test_t5_the_install_restore_path_neither_calls_the_build_nor_reads_runner() -> None:
    """A change to `build_e2e_bundle`'s argument list cannot reach the restore comparison.

    The charter asks for this stated positively rather than left to inference. It is a
    structural fact about three functions, so it is decided structurally: if any of them
    called `build_e2e_bundle` or referenced `runner`, this test would name which one.
    """
    tree = ast.parse((PACKAGE / oracle.INSTALL_MODULE).read_text(encoding="utf-8"))
    targets = ("capture_bundle_state", "install_bundle", "restore_bundle")
    seen = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in targets:
            names = {
                sub.id for sub in ast.walk(node) if isinstance(sub, ast.Name)
            } | {sub.attr for sub in ast.walk(node) if isinstance(sub, ast.Attribute)}
            seen[node.name] = names
    # POSITIVE CONTROL: all three were found and each really does reference the machinery it
    # is about — otherwise "none of them mentions `runner`" is a fact about an empty set.
    assert set(seen) == set(targets), f"only found {sorted(seen)}"
    for name, names in seen.items():
        assert names, f"{name} parsed to an empty name set"
    assert "_sha256" in seen["restore_bundle"], (
        "POSITIVE CONTROL FAILED: `restore_bundle` does not reference the hash helper, so "
        "this walk is not seeing the byte comparison it is reasoning about"
    )

    for name, names in seen.items():
        assert "runner" not in names, f"{name} reads `runner`"
        assert oracle.BUILD_FN not in names, f"{name} calls `build_e2e_bundle`"
        assert oracle.OPT_IN_RUNNER not in names, f"{name} names the spawning runner"


def test_t6_install_then_restore_is_byte_exact(vault: Path, tmp_path: Path) -> None:
    """End to end, on a synthetic vault: the borrowed bundle is given back byte for byte."""
    bundle = vault / constants.PLUGIN_MAIN_REL
    original = bundle.read_bytes()
    original_sha = sha(original)
    source = tmp_path / "built-main.js"
    source.write_bytes(E2E_MAIN)

    record = install.install_bundle(vault, constants.ROLE_A, source)
    assert record is not None
    assert bundle.read_bytes() == E2E_MAIN
    assert sha(bundle.read_bytes()) != original_sha

    result = install.restore_bundle(vault)
    assert result is not None
    assert bundle.read_bytes() == original
    assert sha(bundle.read_bytes()) == original_sha
    # The owner's own backup was never touched, before or after.
    assert (vault / constants.PLUGIN_DIR_REL / "main.js.bak").read_bytes() == (
        b"owner backup, not ours\n"
    )


# ---------------------------------------------------------------------------------
# T7 — no existing test was touched. Measured against git, not asserted.
# ---------------------------------------------------------------------------------


def test_t7_every_wp69_test_file_is_byte_unchanged_since_the_baseline() -> None:
    repo = _prerepair.repo_root()
    changed = subprocess.run(
        ["git", "diff", "--name-only", _prerepair.BASELINE_COMMIT, "--", *WP69_TEST_DIRS],
        cwd=str(repo),
        capture_output=True,
        check=True,
        text=True,
    ).stdout.split()

    # POSITIVE CONTROL: git must actually be looking at those paths. An empty diff over a
    # path that does not exist is indistinguishable from an empty diff over an untouched one.
    listed = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", _prerepair.BASELINE_COMMIT, "--", *WP69_TEST_DIRS],
        cwd=str(repo),
        capture_output=True,
        check=True,
        text=True,
    ).stdout.split()
    assert len(listed) >= 33, (
        f"POSITIVE CONTROL FAILED: git lists only {len(listed)} WP69 test file(s) at the "
        "baseline, so 'nothing changed' would be a statement about nothing"
    )

    assert changed == [], (
        "WP78 modified WP69 test file(s): " + ", ".join(changed) + ". No test may be "
        "deleted, weakened, retitled, skipped or amended — WP78 holds no §7 licence."
    )

    # And the call sites those files carry are still 22, still all keyword-supplied.
    sites = [s for s in oracle.scan_call_sites(repo, oracle.BUILD_FN) if "/WP69/" in s.path]
    assert len(sites) == 22
    assert all(s.supplies_runner for s in sites)


def test_t8_install_all_gained_exactly_one_name(tmp_path: Path) -> None:
    before = oracle.scan_package(_prerepair.package_dir()).exported[oracle.INSTALL_MODULE]
    after = oracle.scan_package(PACKAGE).exported[oracle.INSTALL_MODULE]
    # POSITIVE CONTROL: both lists are non-empty and were really read from `__all__`.
    assert len(before) > 10 and len(after) > 10, (before, after)
    assert set(before) - set(after) == set(), (
        f"WP78 removed public name(s) from install.__all__: {set(before) - set(after)}"
    )
    assert set(after) - set(before) == {oracle.OPT_IN_RUNNER}, (
        f"WP78 added more than the one opt-in runner: {set(after) - set(before)}"
    )
