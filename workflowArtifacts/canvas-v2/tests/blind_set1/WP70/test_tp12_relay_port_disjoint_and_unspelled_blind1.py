# WP70 / AC3 — blind counterpart 1 for "RELAY_PORT is disjoint from 39421/39422/39431/
# 39432, and the literal appears in constants.py and in no other file".
#
# Different angle: the scan is widened to the WHOLE rig source tree — `tools/*.py` as well
# as `tools/obsidian_e2e/*.py` — because the entrypoint scripts are exactly where a
# convenience literal gets typed. The disjointness is checked as a set property over
# every port constant the module owns, not against four re-typed numbers.
#
# DATA SAFETY: this test reads source files only. Nothing is written, started or opened.

from __future__ import annotations

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

PORT_LITERAL = str(constants.RELAY_PORT)
SCAN = sorted(
    [p for p in _TOOLS.glob("*.py")] + [p for p in (_TOOLS / "obsidian_e2e").glob("*.py")]
)


def port_constants() -> dict:
    return {
        name: value
        for name, value in vars(constants).items()
        if name.endswith("_PORT") or name.endswith("_PORT_A") or name.endswith("_PORT_B")
        if isinstance(value, int)
    }


def test_every_port_constant_the_module_owns_is_distinct() -> None:
    ports = port_constants()
    assert len(set(ports.values())) == len(ports), f"a port value is shared: {ports}"
    assert "RELAY_PORT" in ports


def test_the_relay_port_is_not_any_other_ports_value() -> None:
    others = {name: value for name, value in port_constants().items() if name != "RELAY_PORT"}
    assert constants.RELAY_PORT not in others.values()
    # …and not the relay server's own shipped default either, so a rig relay can never
    # be confused with a developer's `npm start`.
    assert constants.RELAY_PORT != 3000


@pytest.mark.parametrize("path", [str(p) for p in SCAN])
def test_the_port_literal_is_spelled_only_in_constants_py(path: str) -> None:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    if Path(path).name == "constants.py" and Path(path).parent.name == "obsidian_e2e":
        assert PORT_LITERAL in text
    else:
        assert PORT_LITERAL not in text, f"{Path(path).name} spells the relay port literal"


@pytest.mark.parametrize("path", [str(p) for p in SCAN])
def test_the_relay_base_url_is_spelled_only_in_constants_py(path: str) -> None:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    if Path(path).name == "constants.py" and Path(path).parent.name == "obsidian_e2e":
        return
    assert constants.RELAY_BASE_URL not in text


def test_the_relay_port_sits_in_its_own_decade() -> None:
    taken = (
        constants.HEADLESS_RIG_PORT_A,
        constants.HEADLESS_RIG_PORT_B,
        constants.REAL_CONTROL_PORT_A,
        constants.REAL_CONTROL_PORT_B,
    )
    # A transposed digit must not land on an existing rig port.
    digits = PORT_LITERAL
    transpositions = {
        int(digits[:i] + digits[i + 1] + digits[i] + digits[i + 2 :])
        for i in range(len(digits) - 1)
    }
    assert transpositions.isdisjoint(taken)
