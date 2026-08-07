# WP70 / AC3 — blind counterpart 2 for "RELAY_PORT is disjoint from 39421/39422/39431/
# 39432, and the literal appears in constants.py and in no other file".
#
# Different angle: an AST scan rather than a text scan. A literal can hide in a default
# argument, an f-string, a docstring or a dict value and still be a second spelling; and
# a module that ASSIGNS a name called `RELAY_PORT` has shadowed the constant even if the
# number it assigns happens to agree today.
#
# DATA SAFETY: this test parses source files only. Nothing is written, started or opened.

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants  # noqa: E402

PACKAGE = _TOOLS / "obsidian_e2e"
OTHERS = sorted(p.name for p in PACKAGE.glob("*.py") if p.name != "constants.py")
RELAY_NAMES = (
    "RELAY_PORT",
    "RELAY_HOST",
    "RELAY_BASE_URL",
    "RELAY_HEALTH_PATH",
    "RELAY_ROOMS_PATH",
    "RELAY_ROOM_NAME_PREFIX",
    "RELAY_STORE_ROOT_NAME",
    "RELAY_STORE_SUBDIRS",
    "RELAY_ENTRY_REL",
    "RELAY_SERVER_DIR_REL",
    "RELAY_BUILD_SCRIPT",
)


def numeric_constants(path: Path) -> set:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, int)
        and not isinstance(node.value, bool)
    }


def module_level_names(path: Path) -> set:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = set()
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    out.add(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out.add(node.target.id)
    return out


@pytest.mark.parametrize("module", OTHERS)
def test_no_other_module_carries_the_port_as_a_numeric_literal(module: str) -> None:
    assert constants.RELAY_PORT not in numeric_constants(PACKAGE / module), (
        f"{module} carries the relay port as a literal; import RELAY_PORT instead"
    )


@pytest.mark.parametrize("module", OTHERS)
def test_no_other_module_re_declares_a_relay_constant(module: str) -> None:
    shadowed = sorted(module_level_names(PACKAGE / module) & set(RELAY_NAMES))
    assert shadowed == [], f"{module} shadows WP70-owned constants {shadowed}"


def test_the_owning_module_declares_every_relay_constant_exactly_once() -> None:
    text = (PACKAGE / "constants.py").read_text(encoding="utf-8")
    tree = ast.parse(text)
    declared = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in RELAY_NAMES:
                    declared.append(target.id)
    assert sorted(declared) == sorted(RELAY_NAMES)
    assert len(declared) == len(set(declared)), "a relay constant is assigned twice"


def test_the_four_existing_ports_are_untouched_by_this_wp() -> None:
    assert constants.HEADLESS_RIG_PORT_A == 39421
    assert constants.HEADLESS_RIG_PORT_B == 39422
    assert constants.REAL_CONTROL_PORT_A == 39431
    assert constants.REAL_CONTROL_PORT_B == 39432
    assert constants.RELAY_PORT not in (39421, 39422, 39431, 39432)


def test_the_store_subdirs_are_the_three_the_relay_actually_writes() -> None:
    assert constants.RELAY_STORE_SUBDIRS == ("data/frames", "data/yjs-docs", "data/audit")
    assert len(set(constants.RELAY_STORE_SUBDIRS)) == 3
