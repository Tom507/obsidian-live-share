"""WP45 / AC4 / TP09 (visible) — process discipline, checked STRUCTURALLY.

AC4 is a property of the *source*, not of one run: no code path may start a long-running
process outside the single sanctioned visible-console seam. A behavioural test can only
show that the paths it happens to exercise behave; an AST scan shows that no path exists.

`spawn_through_console` is the one function allowed to touch a spawn primitive.

DATA SAFETY: this test only parses source files. It executes nothing.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
TOOLS_DIR = REPO_ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

SANCTIONED_SEAM = "spawn_through_console"

SCANNED = [
    TOOLS_DIR / "obsidian_e2e" / "lifecycle.py",
    TOOLS_DIR / "launch_obsidian_e2e.py",
]

BANNED_ATTR_CALLS = {
    ("subprocess", "Popen"),
    ("subprocess", "run"),
    ("subprocess", "call"),
    ("subprocess", "check_call"),
    ("subprocess", "check_output"),
    ("os", "system"),
    ("os", "popen"),
    ("os", "startfile"),
    ("os", "execv"),
    ("os", "execvp"),
    ("os", "spawnv"),
    ("os", "spawnl"),
}
BANNED_BARE_CALLS = {"Popen", "startfile", "system", "fork", "execv"}


def _enclosing_functions(tree):
    """Map every node to the nearest enclosing function name (or None)."""
    owner = {}

    def walk(node, current):
        for child in ast.iter_child_nodes(node):
            nxt = current
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                nxt = child.name
            owner[child] = nxt
            walk(child, nxt)

    owner[tree] = None
    walk(tree, None)
    return owner


def _call_target(node):
    func = node.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return (func.value.id, func.attr)
    if isinstance(func, ast.Name):
        return (None, func.id)
    return (None, None)


def test_every_source_file_exists_and_parses():
    for path in SCANNED:
        assert path.is_file(), f"WP45 must create {path}"
        ast.parse(path.read_text(encoding="utf-8"))


def test_spawn_primitives_appear_only_inside_the_sanctioned_seam():
    offenders = []
    for path in SCANNED:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        owner = _enclosing_functions(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            mod, attr = _call_target(node)
            hit = (mod, attr) in BANNED_ATTR_CALLS or (
                mod is None and attr in BANNED_BARE_CALLS
            )
            if hit and owner.get(node) != SANCTIONED_SEAM:
                offenders.append(
                    f"{path.name}:{node.lineno} {mod or ''}.{attr} in "
                    f"{owner.get(node) or '<module level>'}"
                )
    assert offenders == [], (
        "process spawn outside the sanctioned visible-console seam "
        f"'{SANCTIONED_SEAM}': {offenders}"
    )


def test_shell_true_appears_nowhere():
    offenders = []
    for path in SCANNED:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.keyword) and node.arg == "shell":
                if isinstance(node.value, ast.Constant) and node.value.value is True:
                    offenders.append(f"{path.name}:{node.value.lineno}")
        assert "shell=True" not in path.read_text(encoding="utf-8")
    assert offenders == []


def test_no_detached_background_launch_flags():
    """A detached/backgrounded child is exactly what AC4 forbids."""
    banned_text = (
        "start_new_session",
        "DETACHED_PROCESS",
        "CREATE_NEW_PROCESS_GROUP",
        "CREATE_NO_WINDOW",
        "nohup",
        "creationflags",
    )
    for path in SCANNED:
        src = path.read_text(encoding="utf-8")
        for token in banned_text:
            assert token not in src, f"{path.name} uses detached-launch token {token!r}"


# ---------------------------------------------------------------------------
# DATA SAFETY GUARD (T3_SharedContract S1/S2/S5) — autouse, every test.
# The owner's Obsidian is installed and its vaults are live. No WP45 test may
# reach a real OS process primitive, not even when the implementation under
# test is wrong. `_ForbiddenProcessCall` derives from BaseException so a stray
# `except Exception` inside the implementation cannot swallow the trip-wire.
# ---------------------------------------------------------------------------
class _ForbiddenProcessCall(BaseException):
    pass


@pytest.fixture(autouse=True)
def _no_real_process(monkeypatch):
    import os as _os
    import subprocess as _sp

    def _forbid(label):
        def _f(*args, **kwargs):
            raise _ForbiddenProcessCall(
                f"WP45 test tried to reach a real process primitive: {label}{args!r}"
            )

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
