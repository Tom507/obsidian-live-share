"""WP45 / AC4+AC2 / TP09 (blind1) — lexical scan: the module owns NO termination verb.

Angle: the visible test is an AST scan for spawn primitives. This one is a lexical scan for
*termination* vocabulary. `lifecycle.py` attaches and launches; it has no legitimate reason
to contain `.terminate(`, `.kill(`, `taskkill`, `Stop-Process` or a `psutil` import at all.
Absence of the vocabulary is a stronger guarantee than absence on the paths a test happened
to walk.

DATA SAFETY: reads source text only.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

LIFECYCLE = TOOLS_DIR / "obsidian_e2e" / "lifecycle.py"
ENTRYPOINT = TOOLS_DIR / "launch_obsidian_e2e.py"

TERMINATION_VOCAB = (
    ".terminate(",
    ".kill(",
    "taskkill",
    "Stop-Process",
    "TerminateProcess",
    "SIGKILL",
    "SIGTERM",
    "os.kill",
    "psutil",
    "CTRL_BREAK_EVENT",
)


def test_both_modules_exist():
    assert LIFECYCLE.is_file(), f"WP45 must create {LIFECYCLE}"
    assert ENTRYPOINT.is_file(), f"WP45 must create {ENTRYPOINT}"


@pytest.mark.parametrize("path", [LIFECYCLE, ENTRYPOINT])
def test_no_termination_vocabulary_anywhere_in_the_module(path):
    src = path.read_text(encoding="utf-8")
    found = [word for word in TERMINATION_VOCAB if word in src]
    assert found == [], f"{path.name} contains termination vocabulary: {found}"


@pytest.mark.parametrize("path", [LIFECYCLE, ENTRYPOINT])
def test_no_shell_invocation_of_any_kind(path):
    src = path.read_text(encoding="utf-8")
    assert "shell=True" not in src
    assert "os.system" not in src
    assert not re.search(r"\bcmd(\.exe)?\s*/[ckCK]\b", src), "no cmd /c or cmd /k wrapper"
    assert "powershell" not in src.lower()


def test_the_lifecycle_does_not_import_process_management_libraries():
    src = LIFECYCLE.read_text(encoding="utf-8")
    for banned in ("import psutil", "from psutil", "import signal", "import win32api"):
        assert banned not in src, f"lifecycle.py must not use {banned!r}"


def test_the_sanctioned_seam_is_the_only_place_that_talks_to_the_console():
    """`console.run_*` may appear only inside `spawn_through_console`."""
    import ast

    tree = ast.parse(LIFECYCLE.read_text(encoding="utf-8"))
    owners = {}

    def walk(node, current):
        for child in ast.iter_child_nodes(node):
            nxt = child.name if isinstance(child, ast.FunctionDef) else current
            owners[child] = nxt
            walk(child, nxt)

    walk(tree, None)

    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in ("run_command", "run_python", "await_console"):
                if owners.get(node) != "spawn_through_console":
                    offenders.append(f"{node.func.attr} at line {node.lineno}")
    assert offenders == [], f"console calls outside the sanctioned seam: {offenders}"


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
