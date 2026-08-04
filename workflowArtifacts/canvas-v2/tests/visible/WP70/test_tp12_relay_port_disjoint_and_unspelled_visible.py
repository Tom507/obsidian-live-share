# WP70 / AC3 — "Its port is a new constant in `constants.py`, disjoint from `39421`/
# `39422` and `39431`/`39432`, mirrored into `T3_SharedContract.md`, and spelled as a
# literal nowhere else."
#
# Hard-won rule 10 in its sharpest form: two agents independently choosing incompatible
# constants has already cost this run a batch. Disjointness is asserted against the
# CONSTANTS, never against re-typed numbers, and the literal-uniqueness scan derives the
# digits from `constants.RELAY_PORT` so that this test does not itself become a second
# spelling of the port.
#
#   ├── T1 RELAY_PORT is disjoint from all four existing rig ports
#   ├── T2 the derived relay URL is built from the constants, not from a literal
#   ├── T3 the port literal appears in constants.py
#   ├── T4 the port literal appears in NO other module under tools/obsidian_e2e/
#   ├── T5 relay.py's docstrings contain no port literal and no hard-coded relay URL
#   └── T6 the pinned relay paths and room prefix are the contract's, verbatim
#
# DATA SAFETY: this test reads source files only. It writes nothing, starts nothing and
# opens no socket.

from __future__ import annotations

import ast
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

from obsidian_e2e import constants, relay  # noqa: E402

PACKAGE = _TOOLS / "obsidian_e2e"

# Derived, never re-typed: spelling the digits here would make this file the very
# second spelling the assertion forbids.
PORT_LITERAL = str(constants.RELAY_PORT)


def test_relay_port_is_disjoint_from_all_four_existing_rig_ports() -> None:
    taken = {
        constants.HEADLESS_RIG_PORT_A,
        constants.HEADLESS_RIG_PORT_B,
        constants.REAL_CONTROL_PORT_A,
        constants.REAL_CONTROL_PORT_B,
    }
    assert len(taken) == 4, "the four existing rig ports are no longer distinct"
    assert constants.RELAY_PORT not in taken
    # One decade above the real-control pair, so a transposed digit lands on nothing.
    assert all(abs(constants.RELAY_PORT - port) >= 9 for port in taken)


def test_the_relay_url_is_built_from_the_constants() -> None:
    assert constants.RELAY_BASE_URL == f"http://{constants.RELAY_HOST}:{constants.RELAY_PORT}"
    assert constants.RELAY_HOST == "127.0.0.1"
    assert constants.RELAY_BASE_URL.endswith(f":{PORT_LITERAL}")


def test_the_port_literal_appears_in_constants_py() -> None:
    text = (PACKAGE / "constants.py").read_text(encoding="utf-8")
    assert PORT_LITERAL in text, "the pinned port is not spelled in its owning module"


@pytest.mark.parametrize(
    "module",
    sorted(p.name for p in (_TOOLS / "obsidian_e2e").glob("*.py") if p.name != "constants.py"),
)
def test_the_port_literal_appears_in_no_other_rig_module(module: str) -> None:
    text = (PACKAGE / module).read_text(encoding="utf-8")
    assert PORT_LITERAL not in text, (
        f"{module} spells the relay port literal; every consumer must import it"
    )


def test_relay_py_docstrings_contain_no_port_literal_and_no_hard_coded_url() -> None:
    source = (PACKAGE / "relay.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    docstrings = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            doc = ast.get_docstring(node)
            if doc:
                docstrings.append(doc)
    blob = "\n".join(docstrings)
    assert PORT_LITERAL not in blob, "a docstring example spells the relay port"
    assert "http://127.0.0.1:" not in blob, "a docstring hard-codes the relay URL"


def test_the_pinned_relay_paths_and_room_prefix_are_the_contracts() -> None:
    assert constants.RELAY_HEALTH_PATH == "/healthz"
    assert constants.RELAY_ROOMS_PATH == "/rooms"
    assert constants.RELAY_ROOM_NAME_PREFIX == "e2e-gate-"
    assert constants.RELAY_SERVER_DIR_REL == "server"
    assert constants.RELAY_ENTRY_REL == "server/dist/index.js"
    assert constants.RELAY_BUILD_SCRIPT == "build"
    # The module reads them; it does not re-declare them.
    assert relay.constants is constants
