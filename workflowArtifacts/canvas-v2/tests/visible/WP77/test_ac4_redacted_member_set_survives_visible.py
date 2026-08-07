# WP77 / AC4 — "`ports.py` no longer downgrades a redacted member set to a plain `dict`."
#
# S13: `gate_settings_members` deliberately returns a `relay.RedactedMapping` because the
# member set carries the MINTED ROOM TOKEN and "the member set it is about to provision"
# is exactly what a caller prints while debugging a provisioning. `ports.py:677` met it
# with `resolved_members = dict(members)`, and `dict(x)` builds a PLAIN dict rather than a
# copy of the subclass — so the protection was gone, in two live frames.
#
# AC4 names its own vacuity risk explicitly, and this file obeys it to the letter: the
# test passes a `RedactedMapping` carrying a SENTINEL under a secret-bearing key, asserts
# the sentinel is absent from the rendering of the value AT THE POINT IT REACHES THE
# SPLICE, and carries a positive control proving the sentinel is retrievable by subscript
# at that same point. Passing a plain dict in and asserting the output is redacted would
# test nothing about the downgrade at all.
#
#   ├── T1 the member set is still redacting where it reaches `_with_port` (+ subscript
#   │      positive control, at that same point, in the same test)
#   ├── T2 the downgrade is measured: the pre-repair code renders the token there
#   ├── T3 use is unchanged — subscripting, iteration, ordering, the emitted JSON and the
#   │      byte identity of the provisioned file
#   ├── T4 the frame locals of both frames render redacted
#   └── T5 the empty-member-set refusal and the None-means-port-only default are unchanged
#
# DATA SAFETY: every fixture is synthetic and under tmp_path. Every credential value is an
# obviously-fake sentinel literal. No file in either owner vault is read, opened, hashed or
# pointed at; no Obsidian is launched, no relay started, no socket opened.

from __future__ import annotations

import json
import sys
import traceback
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
from obsidian_e2e import constants, ports, relay  # noqa: E402

SENTINEL_TOKEN = "SENTINEL-WP77-ROOM-TOKEN-DO-NOT-LEAK"
ORIGINAL = b'{\n  "existing": 1\n}\n'


def members_with_the_token() -> relay.RedactedMapping:
    """The shape `gate_settings_members` hands to `provision_port` — token and all."""
    return relay.RedactedMapping(
        {
            constants.SETTINGS_PORT_KEY: 39431,
            constants.SETTINGS_TOKEN_KEY: SENTINEL_TOKEN,
            "sharedFolder": constants.SETTINGS_SHARED_FOLDER,
        }
    )


def make_vault(tmp_path: Path, name: str = "vault") -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    return vault


def _capture_at_the_splice(module, vault: Path, members, monkeypatch):
    """Record what `_with_port` actually received, without changing what it does."""
    seen = {}
    real = module.ports._with_port if hasattr(module, "ports") else module._with_port
    target = module.ports if hasattr(module, "ports") else module

    def recording_with_port(original, member_set):
        seen["members"] = member_set
        seen["type"] = type(member_set)
        seen["repr"] = repr(member_set)
        seen["str"] = str(member_set)
        seen["percent_s"] = "%s" % (member_set,)
        seen["format"] = format(member_set)
        seen["json"] = json.dumps(dict(member_set))
        seen["keys"] = list(member_set)
        seen["subscript"] = member_set[constants.SETTINGS_TOKEN_KEY]
        return real(original, member_set)

    monkeypatch.setattr(target, "_with_port", recording_with_port)
    record = target.provision_port(vault, "a", run_id="wp77-ac4", members=members)
    monkeypatch.undo()
    return seen, record


def test_t1_the_member_set_still_redacts_where_it_reaches_the_splice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    vault = make_vault(tmp_path)
    seen, record = _capture_at_the_splice(ports, vault, members_with_the_token(), monkeypatch)

    # POSITIVE CONTROL, at the same point and in the same test: the sentinel really is in
    # the object that reached the splice, and it is retrievable by subscript. Without
    # this, every assertion below also passes for a member set that dropped the key.
    assert seen["subscript"] == SENTINEL_TOKEN
    assert seen["members"][constants.SETTINGS_TOKEN_KEY] == SENTINEL_TOKEN

    # The type survived the journey — this is the S13 defect itself.
    assert seen["type"] is relay.RedactedMapping
    assert isinstance(seen["members"], dict)

    # And every general-purpose rendering at that point is redacted.
    for path in ("repr", "str", "percent_s", "format"):
        assert SENTINEL_TOKEN not in seen[path], f"leaked through {path} at the splice"
        assert constants.REDACTED in seen[path]

    # The provisioned file itself of course carries the token — that is what provisioning
    # IS. The point of AC4 is the rendering path, not the use.
    assert SENTINEL_TOKEN.encode("utf-8") in (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert record.port == 39431


def test_t2_the_pre_repair_code_rendered_the_token_at_that_same_point(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The downgrade, measured on a byte copy of the pre-repair code."""
    prerepair, _blobs = _prerepair.load()
    vault = make_vault(tmp_path, "prerepair-vault")
    members = prerepair.relay.RedactedMapping(
        {
            prerepair.constants.SETTINGS_PORT_KEY: 39431,
            prerepair.constants.SETTINGS_TOKEN_KEY: SENTINEL_TOKEN,
        }
    )
    # POSITIVE CONTROL — before it enters, the mapping does redact.
    assert members[prerepair.constants.SETTINGS_TOKEN_KEY] == SENTINEL_TOKEN
    assert SENTINEL_TOKEN not in repr(members)

    seen, _record = _capture_at_the_splice(prerepair, vault, members, monkeypatch)
    assert seen["subscript"] == SENTINEL_TOKEN
    assert seen["type"] is dict, "the pre-repair downgrade did not reproduce"
    assert SENTINEL_TOKEN in seen["repr"], "the pre-repair leak did not reproduce"


def test_t3_use_is_unchanged_subscript_iteration_ordering_and_the_emitted_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plain = dict(members_with_the_token())
    redacted = members_with_the_token()
    assert list(plain) == list(redacted)                       # ordering
    assert plain == redacted                                   # equality, both directions
    assert json.dumps(plain) == json.dumps(redacted)           # emitted JSON

    as_plain = make_vault(tmp_path, "as-plain")
    as_redacted = make_vault(tmp_path, "as-redacted")
    ports.provision_port(as_plain, "a", run_id="wp77-t3", members=plain)
    ports.provision_port(as_redacted, "a", run_id="wp77-t3", members=redacted)

    # Byte identity of the provisioned file: the type changed, the output did not.
    assert (as_plain / constants.PLUGIN_DATA_REL).read_bytes() == (
        as_redacted / constants.PLUGIN_DATA_REL
    ).read_bytes()

    seen, _record = _capture_at_the_splice(
        ports, make_vault(tmp_path, "t3-seen"), plain, monkeypatch
    )
    assert seen["keys"] == list(plain)
    assert seen["json"] == json.dumps(plain)
    # A plain dict in is upgraded rather than left renderable: WP77 closes the class, not
    # the one instance that was reported.
    assert seen["type"] is relay.RedactedMapping


def test_t4_the_frame_locals_of_both_frames_render_redacted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A traceback out of the splice renders `members` — twice. Neither spells the token."""
    vault = make_vault(tmp_path, "t4")
    members = members_with_the_token()

    real = ports._with_port

    def exploding_with_port(original, member_set):
        assert member_set[constants.SETTINGS_TOKEN_KEY] == SENTINEL_TOKEN  # POSITIVE CONTROL
        raise RuntimeError("a failure inside the splice frame")

    monkeypatch.setattr(ports, "_with_port", exploding_with_port)
    try:
        ports.provision_port(vault, "a", run_id="wp77-t4", members=members)
    except RuntimeError as err:
        rendered = "".join(
            traceback.TracebackException(
                type(err), err, err.__traceback__, capture_locals=True
            ).format()
        )
    finally:
        monkeypatch.undo()

    assert "resolved_members" in rendered      # the provision_port frame really rendered
    assert "member_set" in rendered            # and so did the splice frame
    assert SENTINEL_TOKEN not in rendered
    assert constants.REDACTED in rendered


def test_t5_the_refusal_and_the_default_are_unchanged(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="at least one settings key"):
        ports.provision_port(make_vault(tmp_path, "t5-empty"), "a", members={})

    default_vault = make_vault(tmp_path, "t5-default")
    record = ports.provision_port(default_vault, "a", run_id="wp77-t5", members=None)
    provisioned = json.loads(
        (default_vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8")
    )
    assert provisioned[constants.SETTINGS_PORT_KEY] == record.port
    assert set(provisioned) == {"existing", constants.SETTINGS_PORT_KEY}
