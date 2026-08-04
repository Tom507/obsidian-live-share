# WP70 / obsidian-git precondition — blind counterpart 1 for "restore is byte-exact
# (sha256 + byte length) and a non-byte-exact restore is
# COMMUNITY_PLUGINS_RESTORE_MISMATCH".
#
# Different data: enabled lists whose formatting a JSON round trip destroys in ways the
# visible fixtures do not cover — a BOM, escaped non-ASCII in a plugin id, tab indentation
# inside a nested array-of-one, and a file with Windows line endings and no final newline.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import hashlib
import json
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

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T035959Z-43-778899"

FIXTURES = {
    "bom": b"\xef\xbb\xbf" + b'[\n  "obsidian-git",\n  "live-share"\n]\n',
    "escaped_non_ascii_id": b'[\n  "obsidian-git",\n  "notiz-\\u00fcbersicht",\n  "live-share"\n]\n',
    "crlf_no_final_newline": b'[\r\n\t"obsidian-git",\r\n\t"live-share"\r\n]',
    "single_line_spaced": b'[ "obsidian-git" , "live-share" ]',
    "deep_indent": b'[\n        "obsidian-git",\n        "live-share"\n]\n',
}


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, label: str) -> Path:
    vault = assert_synthetic(tmp_path / f"vault-{label}")
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(FIXTURES[label])
    return vault


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_each_fixture_survives_the_borrow_byte_for_byte(tmp_path: Path, label: str) -> None:
    original = FIXTURES[label]
    vault = make_vault(tmp_path, label)
    path = vault / constants.COMMUNITY_PLUGINS_REL

    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert path.read_bytes() != original
    result = provisioning.restore_community_plugins(vault)

    restored = path.read_bytes()
    assert len(restored) == len(original)
    assert hashlib.sha256(restored).hexdigest() == hashlib.sha256(original).hexdigest()
    assert restored == original
    assert result.restored_size == len(original)


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_fixture_audit_a_json_round_trip_destroys_each_fixture(label: str) -> None:
    original = FIXTURES[label]
    parsed = json.loads(original.decode("utf-8-sig"))
    for kwargs in ({"indent": 2}, {}, {"indent": 8}, {"indent": 2, "ensure_ascii": False}):
        assert json.dumps(parsed, **kwargs).encode("utf-8") != original, (
            f"{label}: a json round trip reproduces these bytes"
        )


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_a_backup_replaced_by_a_reserialised_copy_is_a_mismatch(
    tmp_path: Path, label: str
) -> None:
    original = FIXTURES[label]
    # `make_vault` uses its second argument BOTH as the directory suffix and as the
    # FIXTURES key, so decorating it ("mismatch-bom") raised KeyError in the fixture
    # helper and this test never reached its own assertion. pytest gives each
    # parametrised invocation its own tmp_path, so the plain label is already unique.
    vault = make_vault(tmp_path, label)
    provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID)

    reserialised = json.dumps(json.loads(original.decode("utf-8-sig")), indent=2).encode("utf-8")
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(reserialised)

    with pytest.raises(provisioning.CommunityPluginsRestoreMismatch) as excinfo:
        provisioning.restore_community_plugins(vault)
    assert excinfo.value.reason == constants.COMMUNITY_PLUGINS_RESTORE_MISMATCH


def test_the_bom_survives_and_the_list_still_parses(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "bom")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    during = (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
    assert during.startswith(b"\xef\xbb\xbf"), "the BOM was stripped by the modify path"
    assert json.loads(during.decode("utf-8-sig")) == ["live-share"]
