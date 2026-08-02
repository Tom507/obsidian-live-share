"""WP45 / AC4 / TP09 (blind2) — the seam has a shape, and the module has no side effects.

Angle: the visible test proves spawn primitives are confined. This one proves the confinement
is *meaningful*: `spawn_through_console` must actually exist and take a console, `import` of
the module must not start anything, and no launch decision may sit at module level.

DATA SAFETY: parses and imports source; the autouse guard makes an import-time spawn fail
loudly rather than run.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from obsidian_e2e import lifecycle  # noqa: E402

LIFECYCLE = TOOLS_DIR / "obsidian_e2e" / "lifecycle.py"
ENTRYPOINT = TOOLS_DIR / "launch_obsidian_e2e.py"
SEAM = "spawn_through_console"


def _tree(path):
    return ast.parse(path.read_text(encoding="utf-8"))


def test_the_sanctioned_seam_exists_and_takes_a_console():
    assert hasattr(lifecycle, SEAM), f"lifecycle.py must expose the seam {SEAM!r}"
    fn = next(
        node for node in _tree(LIFECYCLE).body
        if isinstance(node, ast.FunctionDef) and node.name == SEAM
    )
    arg_names = [a.arg for a in fn.args.args] + [a.arg for a in fn.args.kwonlyargs]
    assert "console" in arg_names, f"{SEAM} must receive the console seam explicitly"


def test_ensure_endpoints_delegates_instead_of_spawning_itself():
    fn = next(
        node for node in _tree(LIFECYCLE).body
        if isinstance(node, ast.FunctionDef) and node.name == "ensure_endpoints"
    )
    called = {
        node.func.id for node in ast.walk(fn)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    assert SEAM in called, "ensure_endpoints must launch through the sanctioned seam"


@pytest.mark.parametrize("path", [LIFECYCLE, ENTRYPOINT])
def test_module_level_holds_no_executable_side_effect(path):
    """Only imports, assignments, defs and the __main__ guard may sit at module level."""
    allowed = (
        ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.FunctionDef,
        ast.AsyncFunctionDef, ast.ClassDef, ast.Expr, ast.If, ast.Try, ast.Pass,
    )
    for node in _tree(path).body:
        assert isinstance(node, allowed), f"{path.name}: {type(node).__name__} at module level"
        if isinstance(node, ast.Expr):
            assert isinstance(node.value, ast.Constant), (
                f"{path.name}: module-level expression that is not a docstring"
            )


@pytest.mark.parametrize("path", [LIFECYCLE, ENTRYPOINT])
def test_no_process_module_is_used_outside_the_seam(path):
    tree = _tree(path)
    owners = {}

    def walk(node, current):
        for child in ast.iter_child_nodes(node):
            nxt = child.name if isinstance(child, ast.FunctionDef) else current
            owners[child] = nxt
            walk(child, nxt)

    walk(tree, None)

    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id in ("subprocess", "multiprocessing") and owners.get(node) != SEAM:
                offenders.append(f"{path.name}:{node.lineno} {node.value.id}.{node.attr}")
    assert offenders == [], f"process module used outside the seam: {offenders}"


def test_importing_the_lifecycle_module_launches_nothing():
    """The autouse guard would have raised during import if it had."""
    assert lifecycle is not None
    assert callable(getattr(lifecycle, "ensure_endpoints", None))


class _ForbiddenProcessCall(BaseException):
    pass


@pytest.fixture(autouse=True)
def _no_real_process(monkeypatch):
    """DATA SAFETY: no WP45 test may reach a real OS process primitive."""
    import os as _os
    import subprocess as _sp

    def _forbid(label):
        def _f(*args, **kwargs):
            raise _ForbiddenProcessCall(f"real process primitive reached: {label}{args!r}")

        return _f

    for _mod, _attr in (
        (_os, "system"), (_os, "popen"), (_os, "kill"), (_os, "startfile"),
        (_os, "execv"), (_os, "execvp"), (_os, "spawnv"),
        (_sp, "Popen"), (_sp, "run"), (_sp, "call"),
        (_sp, "check_call"), (_sp, "check_output"),
    ):
        if hasattr(_mod, _attr):
            monkeypatch.setattr(_mod, _attr, _forbid(f"{_mod.__name__}.{_attr}"))
    yield
