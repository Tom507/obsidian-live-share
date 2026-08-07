# WP77 / AC2 — "the byte-exact borrow and restore oracles still compare CONTENT, and each
# is shown to still fail when the content differs."
#
# This is the dangerous half of WP77. Wrapping the field and leaving a comparison in place
# gives an oracle that may compare wrappers, may compare identities, and will agree far
# more often than the content does — a restore oracle that cannot fail is strictly worse
# than the leak it replaced. So every comparison, length and hash that reads the borrowed
# bytes is driven to RED by a ONE-BYTE perturbation of the content, with the unperturbed
# run as its positive control in the same test.
#
#   ├── C1 the splice input        — perturbation changes the provisioned bytes
#   ├── C2 the backup write        — perturbation changes the saved original, byte for byte
#   ├── C3 the recorded size/sha   — perturbation moves both
#   ├── C4 capture_state's sha check over the saved original → PROVISION_CONFLICT
#   ├── C5 restore_port's sha256-AND-exact-length verification → SETTINGS_RESTORE_MISMATCH
#   ├── C6 install.install_bundle's restore-point verification → BUNDLE_RESTORE_MISMATCH
#   ├── C7 provisioning's community borrow: narrow, backup, size, restore
#   ├── C8 the wrapper does NOT make two different contents compare equal
#   └── C9 the invariants AC2 pins: restore is independent of the modify path, no
#          parse/serialise round trip, no-prior-file restores to NO FILE AT ALL
#
# DATA SAFETY: every fixture is synthetic and under tmp_path. Every credential value is an
# obviously-fake sentinel literal. No file in either owner vault is read, opened, hashed or
# pointed at; no Obsidian is launched, no relay started, no socket opened.

from __future__ import annotations

import hashlib
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

from obsidian_e2e import constants, install, ports, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

SENTINELS = {
    "encryptionPassphrase": "SENTINEL-WP77-PASSPHRASE-DO-NOT-LEAK",
    "encryptionSalt": "SENTINEL-WP77-SALT-DO-NOT-LEAK",
    "jwt": "SENTINEL-WP77-JWT-DO-NOT-LEAK",
    "serverPassword": "SENTINEL-WP77-SERVERPW-DO-NOT-LEAK",
    "token": "SENTINEL-WP77-TOKEN-DO-NOT-LEAK",
}

# Deliberately exotic: tabs, CRLF, a BOM, a non-ASCII escape and an unusual key order, so
# "the oracle compares content" is tested against a file a parse/serialise round trip
# would silently normalise.
ORIGINAL_TEXT = (
    "\ufeff{\r\n"
    '\t"serverPassword": "%s",\r\n'
    '\t"jwt": "%s",\r\n'
    '\t"encryptionSalt": "%s",\r\n'
    '\t"encryptionPassphrase": "%s",\r\n'
    '\t"token": "%s",\r\n'
    '\t"note": "caf\\u00e9 \\u2014 tab\\tand more"\r\n'
    "}\r\n"
) % (
    SENTINELS["serverPassword"],
    SENTINELS["jwt"],
    SENTINELS["encryptionSalt"],
    SENTINELS["encryptionPassphrase"],
    SENTINELS["token"],
)
ORIGINAL = ORIGINAL_TEXT.encode("utf-8")

#: The one-byte perturbation. Exactly one byte differs and the length is unchanged, which
#: is the harder case for a length-only oracle and the reason a sha is checked as well. It
#: lands inside a string VALUE so the file stays structurally valid JSON: a perturbation
#: that breaks the parse would be refused by the splice for the wrong reason and would
#: prove nothing about the byte oracles.
PERTURBED = ORIGINAL.replace(b"and more", b"and mors")


def _one_byte_apart(a: bytes, b: bytes) -> bool:
    return len(a) == len(b) and sum(x != y for x, y in zip(a, b)) == 1


def make_vault(tmp_path: Path, name: str, content: bytes) -> Path:
    vault = tmp_path / name
    for owner in OWNER_VAULTS:
        assert owner.resolve() != vault.resolve()
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(content)
    return vault


def test_the_perturbation_is_genuinely_one_byte() -> None:
    """The premise of every test below, asserted once rather than assumed five times."""
    assert _one_byte_apart(ORIGINAL, PERTURBED)
    assert hashlib.sha256(ORIGINAL).hexdigest() != hashlib.sha256(PERTURBED).hexdigest()


# --- C1/C2/C3: the three reads inside provision_port ------------------------------


def test_c1_c2_c3_a_one_byte_perturbation_moves_the_splice_the_backup_and_the_record(
    tmp_path: Path,
) -> None:
    clean = make_vault(tmp_path, "clean", ORIGINAL)
    dirty = make_vault(tmp_path, "dirty", PERTURBED)

    record_clean = ports.provision_port(clean, "a", run_id="wp77-clean")
    record_dirty = ports.provision_port(dirty, "a", run_id="wp77-dirty")

    # POSITIVE CONTROL — the objects really did carry content, and the clean run really
    # did reproduce the fixture. An oracle over an empty borrow agrees about nothing.
    assert record_clean.had_original is True and record_dirty.had_original is True
    assert record_clean.original_sha256 == hashlib.sha256(ORIGINAL).hexdigest()
    assert record_clean.original_size == len(ORIGINAL)
    assert (clean / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL

    # C1 — the splice input. One byte in, a different provisioned file out.
    spliced_clean = (clean / constants.PLUGIN_DATA_REL).read_bytes()
    spliced_dirty = (dirty / constants.PLUGIN_DATA_REL).read_bytes()
    assert spliced_clean != spliced_dirty
    assert _one_byte_apart(spliced_clean, spliced_dirty)

    # C2 — the backup write. The saved original is the perturbed file, byte for byte.
    assert (dirty / constants.SETTINGS_BACKUP_REL).read_bytes() == PERTURBED
    assert (clean / constants.SETTINGS_BACKUP_REL).read_bytes() != PERTURBED

    # C3 — the recorded fingerprint. Length is unchanged by design, so it is the sha that
    # has to move, and it does.
    assert record_dirty.original_sha256 == hashlib.sha256(PERTURBED).hexdigest()
    assert record_dirty.original_sha256 != record_clean.original_sha256
    assert record_dirty.original_size == record_clean.original_size == len(ORIGINAL)


# --- C4: capture_state's own verification of the saved original -------------------


def test_c4_capture_state_refuses_when_the_saved_original_is_one_byte_off(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault", ORIGINAL)
    ports.provision_port(vault, "a", run_id="wp77-c4")

    # POSITIVE CONTROL — untouched, the borrow re-captures cleanly and holds the content.
    state = ports.capture_state(vault)
    assert state.reveal_original_bytes() == ORIGINAL
    assert state.original_sha256 == hashlib.sha256(ORIGINAL).hexdigest()

    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(PERTURBED)
    with pytest.raises(ports.ProvisionConflict) as caught:
        ports.capture_state(vault)
    assert caught.value.reason == constants.PROVISION_CONFLICT
    for sentinel in SENTINELS.values():
        assert sentinel not in str(caught.value)


# --- C5: restore_port's sha256 AND exact-length verification ----------------------


def test_c5_restore_refuses_when_the_saved_original_is_one_byte_off(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault", ORIGINAL)
    ports.provision_port(vault, "a", run_id="wp77-c5")

    # POSITIVE CONTROL — on the untouched borrow, restore reproduces the file byte-exactly.
    control = make_vault(tmp_path, "control", ORIGINAL)
    ports.provision_port(control, "a", run_id="wp77-c5-control")
    assert (control / constants.PLUGIN_DATA_REL).read_bytes() != ORIGINAL  # it was borrowed
    result = ports.restore_port(control)
    assert result.restored is True
    assert (control / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL

    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(PERTURBED)
    borrowed_now = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    with pytest.raises(ports.SettingsRestoreMismatch) as caught:
        ports.restore_port(vault)
    assert caught.value.reason == constants.SETTINGS_RESTORE_MISMATCH
    # Verified BEFORE anything is written: the settings file is untouched and the evidence
    # is still on disk for a human.
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == borrowed_now
    assert (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert (vault / constants.PROVISION_MARKER_REL).exists()
    for sentinel in SENTINELS.values():
        assert sentinel not in str(caught.value)


# --- C6: install_bundle's restore-point verification ------------------------------

BUNDLE = b"// synthetic main.js fixture\nconsole.log('wp77');\n" + b"x" * 64
BUNDLE_PERTURBED = BUNDLE[:10] + bytes([BUNDLE[10] ^ 0x01]) + BUNDLE[11:]


def make_bundle_vault(tmp_path: Path, name: str, content: bytes) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True)
    (vault / constants.PLUGIN_MAIN_REL).write_bytes(content)
    return vault


def test_c6_the_bundle_restore_point_verification_still_decides_on_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "built-main.js"
    source.write_bytes(
        b"// e2e bundle\n"
        + b"".join(m.encode("utf-8") + b"\n" for m in constants.E2E_BUILD_MARKERS)
        + b"y" * 128
    )

    # POSITIVE CONTROL — unperturbed, the install establishes its restore point and the
    # backup is the displaced bundle byte for byte.
    control = make_bundle_vault(tmp_path, "control", BUNDLE)
    record = install.install_bundle(control, "a", source, run_id="wp77-c6-control")
    assert record.had_original is True
    assert record.original_size == len(BUNDLE)
    assert (control / constants.BUNDLE_BACKUP_REL).read_bytes() == BUNDLE

    # Targeted injection (rule 2 — one thing, not a global): the backup write drops one
    # bit. Everything else about the call is unchanged.
    vault = make_bundle_vault(tmp_path, "vault", BUNDLE)
    real_write = install._atomic_write_bytes
    backup_path = vault / constants.BUNDLE_BACKUP_REL

    def perturbing_write(path, data):
        if Path(path) == backup_path:
            data = BUNDLE_PERTURBED
        return real_write(path, data)

    monkeypatch.setattr(install, "_atomic_write_bytes", perturbing_write)
    with pytest.raises(install.BundleRestoreMismatch):
        install.install_bundle(vault, "a", source, run_id="wp77-c6")
    monkeypatch.undo()
    # "An install that cannot establish its restore point does not install."
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == BUNDLE


def test_c6b_the_length_clause_compares_content_lengths_not_wrappers() -> None:
    """The one sub-clause a content perturbation cannot isolate, evaluated directly.

    `install_bundle`'s reconciliation is `sha256 mismatch OR presence mismatch OR length
    mismatch`, and a one-byte perturbation always trips the sha clause first — so the
    length clause is exercised here on constructed records instead of by pretending a
    perturbation reached it. The point of the assertion is the failure mode AC2 names: a
    comparison that resolves to a wrapper identity check and therefore always agrees.
    """
    state = install.BundleState(
        has_marker=True, had_original=True,
        original_sha256=hashlib.sha256(BUNDLE).hexdigest(),
        original_bytes=BUNDLE, marker=None,
    )
    shorter = install.BundleState(
        has_marker=True, had_original=True,
        original_sha256=hashlib.sha256(BUNDLE[:-1]).hexdigest(),
        original_bytes=BUNDLE[:-1], marker=None,
    )
    # POSITIVE CONTROL — both really hold their content.
    assert state.reveal_original_bytes() == BUNDLE
    assert shorter.reveal_original_bytes() == BUNDLE[:-1]

    original_size = len(state.reveal_original_bytes())
    assert len(shorter.reveal_original_bytes()) != original_size   # goes RED
    assert len(state.reveal_original_bytes()) == original_size     # and GREEN when equal

    # And the shape that would have been the silent failure: a length taken off the
    # wrapper is a TypeError, not a number that happens to agree.
    with pytest.raises(TypeError):
        len(state.original_bytes)


# --- C7: the community-plugins borrow ---------------------------------------------

ENABLED = b'[\r\n\t"obsidian-git",\r\n\t"dataview"\r\n]\r\n'
ENABLED_PERTURBED = ENABLED[:5] + bytes([ENABLED[5] ^ 0x01]) + ENABLED[6:]


def make_community_vault(tmp_path: Path, name: str, content: bytes) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(content)
    return vault


def test_c7_the_community_borrow_still_decides_on_content(tmp_path: Path) -> None:
    clean = make_community_vault(tmp_path, "c7-clean", ENABLED)
    record = provisioning.disable_community_plugins(clean, "a", run_id="wp77-c7")

    # POSITIVE CONTROL — the borrow captured content and the backup is byte-exact.
    assert record.had_original is True
    assert record.original_sha256 == hashlib.sha256(ENABLED).hexdigest()
    assert record.original_size == len(ENABLED)
    assert (clean / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == ENABLED

    # A one-byte perturbation of the OWNER'S file moves the recorded fingerprint.
    dirty = make_community_vault(tmp_path, "c7-dirty", ENABLED_PERTURBED)
    dirty_record = provisioning.disable_community_plugins(dirty, "a", run_id="wp77-c7d")
    assert dirty_record.original_sha256 != record.original_sha256
    assert (dirty / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == ENABLED_PERTURBED

    # And restore verifies on content: perturb the saved list and it refuses.
    assert provisioning.restore_community_plugins(clean).restored is True
    assert (clean / constants.COMMUNITY_PLUGINS_REL).read_bytes() == ENABLED

    (dirty / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(ENABLED)
    with pytest.raises(provisioning.CommunityPluginsRestoreMismatch):
        provisioning.restore_community_plugins(dirty)


# --- C8: the wrapper does not make different contents agree -----------------------


def test_c8_two_wrappers_with_different_content_are_not_equal() -> None:
    """The failure AC2 calls an abort criterion, asserted directly.

    `Secret.__eq__` is content-based on purpose, so even a comparison site that was
    *missed* still compares content rather than identity. This is the assertion that
    would go red if someone replaced it with an identity check.
    """
    a = constants.Secret(ORIGINAL)
    b = constants.Secret(ORIGINAL)
    c = constants.Secret(PERTURBED)
    assert a is not b            # two distinct wrapper objects
    assert a == b                # that agree, because their CONTENT agrees
    assert a != c                # and disagree over one byte
    assert a == ORIGINAL and c == PERTURBED
    assert hashlib.sha256(a.reveal()).hexdigest() != hashlib.sha256(c.reveal()).hexdigest()


# --- C9: the invariants AC2 pins --------------------------------------------------


def test_c9a_restore_is_independent_of_the_modify_path(tmp_path: Path) -> None:
    """Restore copies the backup verbatim; it never re-runs the splice.

    Proved by making the modify path unusable after the provisioning: if restore
    consulted it, this would raise instead of reproducing the file.
    """
    vault = make_vault(tmp_path, "vault", ORIGINAL)
    ports.provision_port(vault, "a", run_id="wp77-c9a")

    def exploding_with_port(*args, **kwargs):
        raise AssertionError("restore_port consulted the modify path")

    saved = ports._with_port
    ports._with_port = exploding_with_port
    try:
        result = ports.restore_port(vault)
    finally:
        ports._with_port = saved
    assert result.restored is True
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL


def test_c9b_no_parse_serialise_round_trip_survives_bom_crlf_tabs_and_escapes(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault", ORIGINAL)
    ports.provision_port(vault, "a", run_id="wp77-c9b")
    ports.restore_port(vault)
    restored = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert restored == ORIGINAL
    assert restored.startswith(b"\xef\xbb\xbf")     # BOM survived
    assert b"\r\n" in restored                      # CRLF survived
    assert b"\t" in restored                        # tabs survived
    assert b"caf\\u00e9" in restored                # the escape was never re-encoded


def test_c9c_the_no_prior_file_case_restores_to_no_file_at_all(tmp_path: Path) -> None:
    vault = tmp_path / "empty-vault"
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True)
    settings = vault / constants.PLUGIN_DATA_REL
    assert not settings.exists()

    record = ports.provision_port(vault, "a", run_id="wp77-c9c")
    assert record.had_original is False
    assert settings.is_file()                       # POSITIVE CONTROL — it really appeared

    result = ports.restore_port(vault)
    assert result.restored is True
    assert result.settings_file_present is False
    assert not settings.exists()                    # not empty, not "{}" — gone
