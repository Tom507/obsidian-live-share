# WP78 / AC1 — "`build_e2e_bundle` has no runner default, and the spawning implementation is
# a named, public, opt-in symbol that is the default value of nothing."
#
# The criterion names its own vacuity risk and it is honoured here: a test that asserts only
# "`build_e2e_bundle(plugin_dir)` raises" passes for ANY TypeError — including one from an
# unrelated signature break — and says nothing about whether a substitution moved into the
# body. So AC1 is decided from the AST of the signature AND of the body, and the positive
# direction is asserted too: a call WITH an explicit runner still builds and still returns
# the same `BuildResult`, or "the function is now unusable" would satisfy the criterion.
#
#   ├── T1  positive control, then the parsed signature: keyword-only, NO default
#   ├── T2  the body holds exactly one use of `runner` — as the callee. No substitution of
#   │       any shape: no `or`, no `IfExp`, no `is None`, no rebinding
#   ├── T3  no substitution hid at module level either: no DEFAULT_RUNNER constant, no
#   │       `functools.partial`, and the only `runner`-ish module binding is the type alias
#   ├── T4  the spawning implementation is public, exported, documented, and defaults nothing
#   ├── T5  `_default_runner` does not survive — not as a def, not as an alias, not in __all__
#   ├── T6  the negative direction: a bare call is a TypeError NAMING `runner`, at the call
#   ├── T7  the positive direction: with an explicit runner it still builds, and the
#   │       BuildResult is field-for-field what WP69 returned
#   └── T8  the spawn was GATED, NOT DELETED — both spawn primitives still exist
#
# DATA SAFETY: every fixture is synthetic and under `tmp_path`. No file in either owner vault
# is read, opened, hashed or pointed at. No build is run, no process started, no socket
# opened, no Obsidian launched.

from __future__ import annotations

import inspect
import sys
from pathlib import Path

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

import _spawn_oracle as oracle  # noqa: E402
from obsidian_e2e import constants, install  # noqa: E402

PACKAGE = _TOOLS / "obsidian_e2e"

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

E2E_MAIN = (
    b'"use strict";var __LS_E2E__=true;\n'
    + b"".join(b"/* " + m.encode("utf-8") + b" */\n" for m in constants.E2E_BUILD_MARKERS)
    + b"module.exports={};\n"
)


@pytest.fixture()
def report() -> oracle.PackageReport:
    return oracle.scan_package(PACKAGE)


@pytest.fixture()
def plugin_dir(tmp_path: Path) -> Path:
    """A synthetic plugin directory with an already-emitted E2E bundle. Never a real one."""
    root = (tmp_path / "synthetic-plugin").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP78 fixture must never be rooted at or inside an owner vault"
        )
    root.mkdir()
    (root / install.BUNDLE_NAME).write_bytes(E2E_MAIN)
    return root


class RecordingRunner:
    """A fake runner. It records and returns; it never starts anything."""

    def __init__(self, status: object = 0) -> None:
        self.status = status
        self.calls: list = []

    def __call__(self, command, cwd):
        self.calls.append((tuple(command), cwd))
        return self.status


# ---------------------------------------------------------------------------------
# T1 — the parsed signature
# ---------------------------------------------------------------------------------


def test_t1_runner_is_keyword_only_and_has_no_default(report: oracle.PackageReport) -> None:
    # POSITIVE CONTROL first, in this same test: the walk must have found the function and
    # the spawn it is about to reason over. Everything below is vacuous without it.
    report.assert_found(functions=[oracle.BUILD_FN, oracle.OPT_IN_RUNNER], min_spawn_nodes=2)

    runner = report.parameter(oracle.BUILD_FN, "runner")
    assert runner is not None, "build_e2e_bundle has no `runner` parameter at all"
    assert runner.kind == "keyword-only", (
        f"`runner` is {runner.kind}; a positional runner would let a call site supply it by "
        "accident and would break all 22 existing keyword call sites"
    )
    assert runner.has_default is False, (
        f"`runner` still has the default {runner.default_source!r} — the whole defect"
    )
    assert runner.default_source is None
    # The annotation is the second half of the statement: `Optional[Runner]` would say the
    # function still accepts `None`, which is what a re-introduced substitution needs.
    assert runner.annotation == "Runner", (
        f"`runner` is annotated {runner.annotation!r}; `Optional[...]` would re-open the "
        "None branch this WP closed"
    )
    # `plugin_dir` is untouched — this WP changes one parameter, not the signature.
    plugin = report.parameter(oracle.BUILD_FN, "plugin_dir")
    assert plugin is not None and plugin.kind == "positional-or-keyword"
    assert plugin.has_default is False


# ---------------------------------------------------------------------------------
# T2 — the body: the substitution disappeared rather than moved
# ---------------------------------------------------------------------------------


def test_t2_the_body_holds_no_substitution_of_any_shape(report: oracle.PackageReport) -> None:
    report.assert_found(functions=[oracle.BUILD_FN], min_spawn_nodes=2)

    usage = report.body_usage(oracle.BUILD_FN, "runner")
    assert len(usage["call-target"]) == 1, (
        f"`runner` should be called exactly once; found {usage['call-target']}"
    )
    assert usage["call-target"][0].source.startswith("runner("), usage["call-target"][0].source
    for shape, label in (
        ("boolop", "`runner or <default>`"),
        ("ifexp", "`<default> if runner is None else runner`"),
        ("compare", "`runner is None`"),
        ("rebound", "`runner = ...` inside the body"),
        ("other", "any non-call use of `runner`"),
    ):
        assert usage[shape] == [], (
            f"AC2(b) violation: {label} reintroduces the default in the body, which "
            f"satisfies a naive signature check and preserves the exact defect: {usage[shape]}"
        )


# ---------------------------------------------------------------------------------
# T3 — and it did not move to module level either
# ---------------------------------------------------------------------------------


def test_t3_no_module_level_default_runner_binding(report: oracle.PackageReport) -> None:
    report.assert_found(functions=[oracle.BUILD_FN, oracle.OPT_IN_RUNNER], min_spawn_nodes=2)

    bindings = oracle.module_bindings_matching(report, "runner")
    # Pinned exactly, not merely "no DEFAULT_RUNNER": a constant named anything at all that
    # holds the spawning runner is the same defect wearing a different label.
    assert set(bindings) == {"Runner"}, (
        f"unexpected module-level runner binding(s): {bindings}. The only admissible one is "
        "the `Runner` type alias, which is a type and not a value."
    )
    alias = bindings["Runner"]
    assert len(alias) == 1 and alias[0].module == oracle.INSTALL_MODULE
    assert alias[0].source.startswith("Callable["), (
        f"`Runner` is bound to {alias[0].source!r} — a callable VALUE, not a type alias"
    )
    assert report.calls_named("partial") == (), (
        "a `functools.partial` in the package could pre-bind the spawning runner and be "
        "handed to `build_e2e_bundle` implicitly"
    )


# ---------------------------------------------------------------------------------
# T4 — the opt-in symbol
# ---------------------------------------------------------------------------------


def test_t4_the_spawning_runner_is_public_exported_and_documented(
    report: oracle.PackageReport,
) -> None:
    report.assert_found(functions=[oracle.OPT_IN_RUNNER], min_spawn_nodes=2)

    assert not oracle.OPT_IN_RUNNER.startswith("_"), "the opt-in name must be public"
    exported = report.exported[oracle.INSTALL_MODULE]
    assert oracle.OPT_IN_RUNNER in exported, (
        f"{oracle.OPT_IN_RUNNER} is not in install.__all__ = {exported}; an unexported "
        "spawn is one a caller cannot legitimately name, which pushes them back to a default"
    )
    assert getattr(install, oracle.OPT_IN_RUNNER, None) is not None
    doc = getattr(install, oracle.OPT_IN_RUNNER).__doc__ or ""
    assert "starts a process" in doc, (
        "the opt-in runner's docstring must say what it does — the caller writing its name "
        "is the audit, and an undocumented name is not an informed opt-in"
    )
    assert "only thing" in doc, "the docstring must say it is the only spawn in the package"
    # It defaults nothing, anywhere in the package.
    assert report.param_defaults_naming(oracle.OPT_IN_RUNNER) == ()
    assert report.substitutions_naming(oracle.OPT_IN_RUNNER) == ()
    # Stronger, and the reason the two assertions above cannot be evaded: the package does
    # not reference the name AT ALL. It is defined and exported, and nothing inside reads it.
    assert report.name_references(oracle.OPT_IN_RUNNER) == (), (
        "the opt-in runner is referenced inside the package; every reference is a place a "
        "caller did not have to name it"
    )


# ---------------------------------------------------------------------------------
# T5 — the superseded private name does not survive
# ---------------------------------------------------------------------------------


def test_t5_default_runner_does_not_survive_as_an_alias(report: oracle.PackageReport) -> None:
    report.assert_found(functions=[oracle.OPT_IN_RUNNER], min_spawn_nodes=2)
    # POSITIVE CONTROL for a name-absence assertion: prove the lookup CAN find a function by
    # this exact mechanism, using the name that does exist, before asserting one does not.
    assert report.found_function(oracle.OPT_IN_RUNNER), "the found-a-function lookup is broken"

    assert not report.found_function(oracle.SUPERSEDED_RUNNER), (
        "`_default_runner` still exists as a definition"
    )
    assert report.name_references(oracle.SUPERSEDED_RUNNER) == (), (
        "`_default_runner` survives as an alias or a reference — two names for one spawn is "
        "how one of them stops being audited"
    )
    for module, names in report.exported.items():
        assert oracle.SUPERSEDED_RUNNER not in names, module
    assert not hasattr(install, oracle.SUPERSEDED_RUNNER)


# ---------------------------------------------------------------------------------
# T6 — the negative direction, at the call
# ---------------------------------------------------------------------------------


def test_t6_a_bare_call_is_a_typeerror_naming_runner(plugin_dir: Path) -> None:
    # POSITIVE CONTROL: the parameter exists and the function is callable, so the TypeError
    # below is about the missing runner and not about a function that vanished.
    signature = inspect.signature(install.build_e2e_bundle)
    assert "runner" in signature.parameters
    assert signature.parameters["runner"].kind is inspect.Parameter.KEYWORD_ONLY
    assert signature.parameters["runner"].default is inspect.Parameter.empty

    with pytest.raises(TypeError) as excinfo:
        install.build_e2e_bundle(plugin_dir)  # type: ignore[call-arg]

    message = str(excinfo.value)
    # Not "any TypeError" — the criterion names that as the vacuity. It must be the missing
    # required keyword-only argument, by name.
    assert "runner" in message, message
    assert "missing" in message and "required" in message, message
    # And nothing ran: the bundle on disk is untouched and no process was started.
    assert (plugin_dir / install.BUNDLE_NAME).read_bytes() == E2E_MAIN


# ---------------------------------------------------------------------------------
# T7 — the positive direction: the function still works
# ---------------------------------------------------------------------------------


def test_t7_an_explicit_runner_still_builds_and_returns_the_same_buildresult(
    plugin_dir: Path,
) -> None:
    runner = RecordingRunner(0)
    result = install.build_e2e_bundle(plugin_dir, runner=runner)

    # The seam was used exactly once, with WP69's command and the plugin dir — unchanged.
    assert runner.calls == [(install.build_command(), str(plugin_dir))]
    assert install.build_command() == ("npm", "run", constants.E2E_BUILD_SCRIPT)

    # Field for field, this is WP69's BuildResult. "The function is now unusable" does not
    # satisfy AC1, and this is the assertion that rules it out.
    assert isinstance(result, install.BuildResult)
    assert result.mode == constants.E2E_BUILD_ARGV
    assert result.command == install.build_command()
    assert result.exit_status == 0
    assert result.bundle_path == str(plugin_dir / install.BUNDLE_NAME)
    assert result.size == len(E2E_MAIN)
    assert result.markers_found == tuple(constants.E2E_BUILD_MARKERS)
    assert result.markers_missing == ()
    assert result.e2e_capable is True


def test_t7b_the_runner_is_the_only_thing_that_decides_the_build_ran(
    plugin_dir: Path,
) -> None:
    """A non-zero status from the injected runner still refuses, bundle untouched (C69)."""
    before = (plugin_dir / install.BUNDLE_NAME).read_bytes()
    with pytest.raises(install.E2EBuildFailed):
        install.build_e2e_bundle(plugin_dir, runner=RecordingRunner(2))
    assert (plugin_dir / install.BUNDLE_NAME).read_bytes() == before

    with pytest.raises(install.E2EBuildFailed) as excinfo:
        install.build_e2e_bundle(plugin_dir, runner=RecordingRunner("0"))
    assert "str" in str(excinfo.value)
    assert (plugin_dir / install.BUNDLE_NAME).read_bytes() == before


# ---------------------------------------------------------------------------------
# T8 — gated, not deleted
# ---------------------------------------------------------------------------------


def test_t8_the_spawn_was_gated_not_deleted(report: oracle.PackageReport) -> None:
    """The most likely wrong implementation of this WP is removing `subprocess`.

    That would make every absence assertion in AC2 trivially true, shrink the diff, and
    delete WP69's ability to build the bundle at all. This test fails on it.
    """
    report.assert_found(functions=[oracle.OPT_IN_RUNNER], min_spawn_nodes=2)
    kinds = {node.kind for node in report.spawn_nodes}
    assert "import" in kinds, "`import subprocess` was removed — the capability is gone"
    spellings = {node.spelling for node in report.spawn_nodes}
    assert "subprocess.run" in spellings, "`subprocess.run` was removed — the build cannot run"
    assert all(node.function == oracle.OPT_IN_RUNNER for node in report.spawn_nodes)
