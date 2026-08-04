# WP77 / AC5 — "every criterion is falsified separately and headless, with a positive
# control first, no Obsidian, no vault and no socket."
#
# The other four files assert the repaired behaviour. This one is the falsification: for
# each injection, the SAME harness is run twice — once against a byte copy of the
# pre-repair code, once against the repaired code — and both outcomes are asserted. An
# absence assertion whose vector was never shown to fire is indistinguishable from an
# assertion about nothing, and that is the class this whole run exists to sweep.
#
#   ├── I1  the six unconditional render paths, before and after, one table
#   ├── I2  the one-byte perturbation: the oracle was RED before and is RED after
#   ├── I3  the `asdict` hole in the record whose handwritten repr already passed
#   ├── I4  a RedactedMapping sentinel through `provision_port`
#   └── I5  the before harness IS a byte copy — verified against git's own object ids
#
# "A perturbation that changes nothing is a finding, not a null result": I2 records the one
# place where before and after agree, and says why that agreement is the point.
#
# Injections are targeted, one at a time, never global (rule 2).
#
# DATA SAFETY: every fixture is synthetic and under tmp_path. Every credential value is an
# obviously-fake sentinel literal. No file in either owner vault is read, opened, hashed or
# pointed at; no Obsidian is launched, no relay started, no socket opened.

from __future__ import annotations

import dataclasses
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
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))

import _prerepair  # noqa: E402
import obsidian_e2e as repaired  # noqa: E402
from obsidian_e2e import constants, ports, provisioning, relay  # noqa: E402, F401

SENTINEL = "SENTINEL-WP77-FALSIFY-DO-NOT-LEAK"
ORIGINAL = ('{"encryptionPassphrase": "%s", "existing": 1}\n' % SENTINEL).encode("utf-8")
PERTURBED = ORIGINAL.replace(b'"existing": 1', b'"existing": 2')


def make_vault(module, tmp_path: Path, name: str, content: bytes) -> Path:
    consts = module.constants
    vault = tmp_path / name
    (vault / consts.PLUGIN_DIR_REL).mkdir(parents=True)
    (vault / consts.PLUGIN_DATA_REL).write_bytes(content)
    return vault


#: The six vectors the charter measured as unconditional. Each is a callable over a
#: `BorrowState`, so the identical harness runs against both packages.
RENDER_PATHS = {
    "repr": lambda state: repr(state),
    "str": lambda state: str(state),
    "format": lambda state: format(state),
    "percent_s": lambda state: "%s" % (state,),
    "asdict": lambda state: repr(dataclasses.asdict(state)),
    "asdict_json": lambda state: json.dumps(dataclasses.asdict(state), default=str),
}


def _state_for(module, tmp_path: Path, name: str):
    vault = make_vault(module, tmp_path, name, ORIGINAL)
    return module.ports.capture_state(vault)


def _held_bytes(state):
    """The one accessor, or the raw field on the pre-repair shape — same harness, both."""
    reveal = getattr(state, "reveal_original_bytes", None)
    return reveal() if reveal is not None else state.original_bytes


@pytest.mark.parametrize("vector", sorted(RENDER_PATHS))
def test_i1_each_unconditional_render_path_leaked_before_and_is_redacted_after(
    vector: str, tmp_path: Path
) -> None:
    prerepair, _blobs = _prerepair.load()

    before_state = _state_for(prerepair, tmp_path, f"before-{vector}")
    after_state = _state_for(repaired, tmp_path, f"after-{vector}")

    # POSITIVE CONTROL, both sides, in this same test: each object really holds the value.
    assert _held_bytes(before_state) == ORIGINAL
    assert _held_bytes(after_state) == ORIGINAL
    assert SENTINEL.encode("utf-8") in _held_bytes(after_state)

    before = RENDER_PATHS[vector](before_state)
    after = RENDER_PATHS[vector](after_state)

    assert SENTINEL in before, f"the pre-repair leak on {vector} did not reproduce"
    assert SENTINEL not in after, f"{vector} still leaks after the repair"
    if vector != "asdict_json":
        assert constants.REDACTED in after


def test_i2_the_one_byte_perturbation_was_red_before_and_is_still_red_after(
    tmp_path: Path,
) -> None:
    """The oracle is not weakened by one bit — the agreement here IS the finding.

    Every other injection is a before/after DIFFERENCE. This one must be a before/after
    SAMENESS: the byte oracle was able to fail before WP77 and must still be able to fail
    after it. A difference here would mean the repair changed what the module decides,
    which is an abort criterion rather than a result.
    """
    prerepair, _blobs = _prerepair.load()
    outcomes = {}
    for label, module in (("before", prerepair), ("after", repaired)):
        vault = make_vault(module, tmp_path, f"perturb-{label}", ORIGINAL)
        mod_ports = module.ports
        consts = module.constants
        record = mod_ports.provision_port(vault, "a", run_id=f"wp77-i2-{label}")

        # POSITIVE CONTROL — the unperturbed borrow restores byte-exactly.
        clean = make_vault(module, tmp_path, f"perturb-{label}-clean", ORIGINAL)
        mod_ports.provision_port(clean, "a", run_id=f"wp77-i2-{label}-clean")
        assert mod_ports.restore_port(clean).restored is True
        assert (clean / consts.PLUGIN_DATA_REL).read_bytes() == ORIGINAL

        # THE INJECTION — one byte of the saved original, and nothing else.
        (vault / consts.SETTINGS_BACKUP_REL).write_bytes(PERTURBED)
        try:
            mod_ports.restore_port(vault)
            outcomes[label] = "GREEN — the oracle agreed with differing content"
        except Exception as err:  # noqa: BLE001 — the type is the outcome being recorded
            outcomes[label] = type(err).__name__
        assert record.original_sha256 == hashlib.sha256(ORIGINAL).hexdigest()

    assert outcomes["before"] == "SettingsRestoreMismatch"
    assert outcomes["after"] == "SettingsRestoreMismatch"
    assert outcomes["before"] == outcomes["after"]


def test_i3_the_asdict_hole_in_the_handwritten_repr_record_closed(tmp_path: Path) -> None:
    prerepair, _blobs = _prerepair.load()
    payload = f'["obsidian-git", "{SENTINEL}"]\n'.encode("utf-8")

    before = prerepair.provisioning._CommunityState(
        has_marker=False, had_original=True, original_sha256="x", original_bytes=payload
    )
    after = provisioning._CommunityState(
        has_marker=False, had_original=True, original_sha256="x", original_bytes=payload
    )
    # POSITIVE CONTROL, both sides.
    assert _held_bytes(before) == payload
    assert _held_bytes(after) == payload

    # The `repr` check was ALREADY green before the repair — which is exactly why a test
    # over `repr` alone would have declared this record safe.
    assert SENTINEL not in repr(before)
    assert SENTINEL not in repr(after)
    # And the hole the `repr` check could not see.
    assert SENTINEL.encode("utf-8") in dataclasses.asdict(before)["original_bytes"]
    assert SENTINEL not in repr(dataclasses.asdict(after))


def test_i4_a_redacted_member_set_through_provision_port(tmp_path: Path) -> None:
    prerepair, _blobs = _prerepair.load()
    outcomes = {}
    for label, module in (("before", prerepair), ("after", repaired)):
        consts = module.constants
        members = module.relay.RedactedMapping(
            {consts.SETTINGS_PORT_KEY: 39431, consts.SETTINGS_TOKEN_KEY: SENTINEL}
        )
        mod_ports = module.ports
        vault = make_vault(module, tmp_path, f"members-{label}", ORIGINAL)

        seen = {}
        real = mod_ports._with_port

        def recording(original, member_set, _seen=seen, _real=real):
            _seen["subscript"] = member_set[consts.SETTINGS_TOKEN_KEY]
            _seen["repr"] = repr(member_set)
            _seen["type"] = type(member_set).__name__
            return _real(original, member_set)

        mod_ports._with_port = recording
        try:
            mod_ports.provision_port(vault, "a", run_id=f"wp77-i4-{label}", members=members)
        finally:
            mod_ports._with_port = real

        # POSITIVE CONTROL — present under subscript at the point the assertion is made.
        assert seen["subscript"] == SENTINEL
        outcomes[label] = (seen["type"], SENTINEL in seen["repr"])

    assert outcomes["before"] == ("dict", True), outcomes["before"]
    assert outcomes["after"] == ("RedactedMapping", False), outcomes["after"]


def test_i5_the_before_harness_is_a_byte_copy_of_the_pre_repair_code() -> None:
    """AC5's own vacuity clause: a "before" that is not the pre-repair code proves nothing."""
    root, blobs = _prerepair.materialise()
    package = Path(root) / _prerepair.PACKAGE_NAME
    assert set(blobs) >= {"ports.py", "install.py", "provisioning.py", "relay.py",
                          "constants.py", "readiness.py"}
    for name, sha in blobs.items():
        raw = (package / name).read_bytes()
        header = f"blob {len(raw)}\0".encode("utf-8")
        assert hashlib.sha1(header + raw).hexdigest() == sha, name

    # And it really is the PRE-repair code: the defect is present in it.
    prerepair, _ = _prerepair.load()
    source = (package / "ports.py").read_text(encoding="utf-8")
    assert "resolved_members = dict(members)" in source
    assert "reveal_original_bytes" not in source
    assert "original_bytes: Optional[bytes]" in source
    # …and the repaired code is not that code.
    repaired = (_TOOLS / "obsidian_e2e" / "ports.py").read_text(encoding="utf-8")
    assert "resolved_members = dict(members)" not in repaired
    assert "reveal_original_bytes" in repaired


def test_i6_the_whole_verification_is_headless() -> None:
    """No Obsidian, no vault, no socket — a structural claim about this WP's own tests."""
    for path in sorted(Path(__file__).parent.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        assert "ObsidianOrga" not in text or "OWNER_VAULTS" in text, path.name
        # Assembled from parts so this list does not match itself.
        for forbidden in ("socket" + ".socket", "http" + ".client", "Pop" + "en",
                          "os" + ".system", "Obsidian" + ".exe", "launch" + "_agent",
                          "time" + ".sleep"):
            assert forbidden not in text, f"{path.name} reaches for {forbidden}"
