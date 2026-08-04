# WP70 / AC2 — blind counterpart 2 for "`sharedFolder` is provisioned to the rig-owned
# scratch folder CONSTANT (not a re-spelled literal) and `excludePatterns` to an empty
# list".
#
# Different angle: a source-level scan. Hard-won rule 10 is a claim about the SOURCE, so
# it is checked in the source: the folder literal, the empty-pattern literal and the
# permission literal may be spelled in `constants.py` and nowhere else under
# `tools/obsidian_e2e/`, and no module may re-declare a `SETTINGS_*` name.
#
# DATA SAFETY: this test reads source files only. Nothing is written or started.

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

from obsidian_e2e import constants, provisioning  # noqa: E402

PACKAGE = _TOOLS / "obsidian_e2e"
OTHER_MODULES = sorted(p for p in PACKAGE.glob("*.py") if p.name != "constants.py")

# Derived from the constants, so this test never becomes a second spelling itself.
GUARDED_LITERALS = (
    constants.SETTINGS_SHARED_FOLDER,
    constants.SETTINGS_PERMISSION,
    constants.SETTINGS_ROLE_HOST,
    constants.SETTINGS_ROLE_GUEST,
)


def string_literals(path: Path) -> set:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            out.add(node.value)
    return out


def assigned_names(path: Path) -> set:
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


@pytest.mark.parametrize("module", [p.name for p in OTHER_MODULES])
def test_no_other_module_spells_a_guarded_settings_literal(module: str) -> None:
    literals = string_literals(PACKAGE / module)
    offenders = [value for value in GUARDED_LITERALS if value in literals]
    assert offenders == [], f"{module} re-spells {offenders}; import the constant instead"


@pytest.mark.parametrize("module", [p.name for p in OTHER_MODULES])
def test_no_other_module_re_declares_a_settings_constant(module: str) -> None:
    names = assigned_names(PACKAGE / module)
    shadowed = sorted(
        name
        for name in names
        if name.startswith(("SETTINGS_", "PROVISIONED_", "CREDENTIAL_", "SCRATCH_"))
    )
    assert shadowed == [], f"{module} re-declares WP43-owned names {shadowed}"


def test_the_owning_module_does_spell_them() -> None:
    # Without this, the scan above would pass for constants that do not exist at all.
    literals = string_literals(PACKAGE / "constants.py")
    for value in GUARDED_LITERALS:
        assert value in literals


def test_the_pinned_values_are_the_contracts() -> None:
    assert constants.SETTINGS_PERMISSION == "read-write"
    assert constants.SETTINGS_ROLE_HOST == "host"
    assert constants.SETTINGS_ROLE_GUEST == "guest"
    assert constants.SETTINGS_ROLES == {
        constants.ROLE_A: constants.SETTINGS_ROLE_HOST,
        constants.ROLE_B: constants.SETTINGS_ROLE_GUEST,
    }
    assert constants.SETTINGS_AUTO_RECONNECT is True
    assert constants.SETTINGS_EXCLUDE_PATTERNS == ()


def test_the_provisioning_module_reads_the_constants_rather_than_its_own() -> None:
    assert provisioning.constants is constants
    literals = string_literals(PACKAGE / "provisioning.py")
    assert constants.SETTINGS_SHARED_FOLDER not in literals
