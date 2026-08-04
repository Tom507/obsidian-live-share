# WP70 / obsidian-git precondition — "restore is byte-exact (sha256 + byte length) and a
# non-byte-exact restore is `COMMUNITY_PLUGINS_RESTORE_MISMATCH`."
#
# Same oracle as WP44's `SETTINGS_RESTORE_MISMATCH` and WP69's `BUNDLE_RESTORE_MISMATCH`,
# for the same reason: a file nobody can reconstruct any more is strictly worse than a
# loud refusal. A parse-and-rewrite restore reproduces the ids and destroys the owner's
# formatting, so every fixture here is one a json round trip would change.
#
#   ├── T1 adversarial formatting survives the borrow byte-for-byte
#   ├── T2 the fixtures really are adversarial (a json round trip changes them)
#   ├── T3 a corrupted backup is refused BEFORE anything is written
#   ├── T4 the refusal is COMMUNITY_PLUGINS_RESTORE_MISMATCH and keeps the evidence
#   ├── T5 both sha256 AND byte length are checked — a same-length change is caught
#   └── T6 restore with nothing borrowed is a safe no-op, callable twice
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults.

from __future__ import annotations

import hashlib
import json
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

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260804T000000Z-1-a1b2c3"

FIXTURES = {
    "tabs_no_trailing_newline": b'[\n\t"obsidian-git",\n\t"live-share"\n]',
    "crlf": b'[\r\n  "obsidian-git",\r\n  "live-share"\r\n]\r\n',
    "minified": b'["obsidian-git","live-share"]',
    "four_space_indent": b'[\n    "obsidian-git",\n    "dataview",\n    "live-share"\n]\n',
    "trailing_blank_lines": b'[\n  "obsidian-git",\n  "live-share"\n]\n\n\n',
}


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, community: bytes) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(community)
    return vault


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_adversarial_formatting_survives_the_borrow_byte_for_byte(
    tmp_path: Path, label: str
) -> None:
    original = FIXTURES[label]
    vault = make_vault(tmp_path, f"vault-{label}", original)
    path = vault / constants.COMMUNITY_PLUGINS_REL

    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert path.read_bytes() != original
    result = provisioning.restore_community_plugins(vault)

    restored = path.read_bytes()
    assert len(restored) == len(original), f"{label}: restored length differs"
    assert hashlib.sha256(restored).hexdigest() == hashlib.sha256(original).hexdigest()
    assert restored == original
    assert result.restored_size == len(original)


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_fixture_audit_a_json_round_trip_destroys_each_fixture(label: str) -> None:
    original = FIXTURES[label]
    parsed = json.loads(original.decode("utf-8"))
    for kwargs in ({"indent": 2}, {}, {"indent": 4}):
        assert json.dumps(parsed, **kwargs).encode("utf-8") != original, (
            f"{label}: a json round trip reproduces these bytes — pick harder data"
        )


def test_a_corrupted_backup_is_refused_before_anything_is_written(tmp_path: Path) -> None:
    original = FIXTURES["tabs_no_trailing_newline"]
    vault = make_vault(tmp_path, "vault-corrupt", original)
    path = vault / constants.COMMUNITY_PLUGINS_REL

    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    during = path.read_bytes()
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(original + b"\n")

    with pytest.raises(provisioning.CommunityPluginsRestoreMismatch):
        provisioning.restore_community_plugins(vault)

    assert path.read_bytes() == during, "the refused restore wrote anyway"


def test_the_refusal_keeps_the_evidence_for_a_human(tmp_path: Path) -> None:
    original = FIXTURES["crlf"]
    vault = make_vault(tmp_path, "vault-evidence", original)
    provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID)
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(b"[]")

    with pytest.raises(provisioning.CommunityPluginsRestoreMismatch) as excinfo:
        provisioning.restore_community_plugins(vault)

    assert excinfo.value.reason == constants.COMMUNITY_PLUGINS_RESTORE_MISMATCH
    assert constants.COMMUNITY_PLUGINS_RESTORE_MISMATCH in constants.FAILURE_REASONS
    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).is_file()
    assert (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).is_file()


def test_a_same_length_change_is_caught(tmp_path: Path) -> None:
    # A length check alone would pass this; a sha256 check alone would pass a truncation
    # that happens to hash-collide, which is why the criterion names both.
    original = FIXTURES["minified"]
    vault = make_vault(tmp_path, "vault-same-length", original)
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)

    tampered = original.replace(b"live-share", b"live-shore")
    assert len(tampered) == len(original)
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(tampered)

    with pytest.raises(provisioning.CommunityPluginsRestoreMismatch):
        provisioning.restore_community_plugins(vault)


def test_restore_with_nothing_borrowed_is_a_safe_no_op(tmp_path: Path) -> None:
    original = FIXTURES["four_space_indent"]
    vault = make_vault(tmp_path, "vault-noop", original)

    first = provisioning.restore_community_plugins(vault)
    assert first.restored is False
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == original

    second = provisioning.restore_community_plugins(vault)
    assert second.restored is False
