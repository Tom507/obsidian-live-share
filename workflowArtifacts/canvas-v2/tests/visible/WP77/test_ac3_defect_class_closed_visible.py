# WP77 / AC3 — "the defect class is closed across the PACKAGE, not repaired at its one
# reported instance."
#
# AC3 names its own vacuity risk: a sweep delivered as a claim ("checked, none others")
# without the enumeration it was derived from. So the enumeration is not written down
# here — it is DERIVED, by walking the AST of every module in `tools/obsidian_e2e/` for a
# `@dataclass` field that is `bytes`-typed, `Secret`-typed or credential-named — and the
# derived set is compared against a pinned disposition table. A record added later that
# holds file bytes behind a generated repr therefore fails this test instead of quietly
# joining the class.
#
#   ├── T1 the enumeration is derived from the source and matches the disposition table
#   ├── T2 install.BundleState — asdict cannot unwrap it (positive control first)
#   ├── T3 provisioning._CommunityState — the S12 hole, measured before and after
#   ├── T4 relay.RelayRoom.token — WP70's, still closed, not re-derived here
#   ├── T5 readiness.RawAnswer.body — the carried-up record, and the MEASURED answer for
#   │      the report: it is still renderable, deliberately, and nothing here touches it
#   └── T6 nothing outside tools/obsidian_e2e/ was modified by this WP
#
# DATA SAFETY: every fixture is synthetic. Every value is an obviously-fake sentinel
# literal. No file in either owner vault is read, opened, hashed or pointed at; no
# Obsidian is launched, no relay started, no socket opened.

from __future__ import annotations

import ast
import dataclasses
import json
import subprocess
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
from obsidian_e2e import constants, install, provisioning, readiness, relay  # noqa: E402

SENTINEL = "SENTINEL-WP77-SWEEP-DO-NOT-LEAK"
PAYLOAD = f'["obsidian-git", "{SENTINEL}"]\n'.encode("utf-8")

_CREDENTIAL_NAME_PARTS = ("token", "passphrase", "salt", "jwt", "password", "secret",
                          "credential")

#: The pinned dispositions. Every entry says what was DONE and why, so a later reader can
#: tell an absence from an oversight. `Optional[Secret]` is the repaired shape;
#: `Optional[bytes]` on `RawAnswer.body` is the deliberate carry-up (S14).
DISPOSITIONS = {
    ("install.py", "BundleState", "original_bytes"): ("repaired", "Optional[Secret]"),
    ("ports.py", "BorrowState", "original_bytes"): ("repaired", "Optional[Secret]"),
    ("provisioning.py", "_CommunityState", "original_bytes"): ("repaired", "Optional[Secret]"),
    ("readiness.py", "RawAnswer", "body"): ("carried-up (S14)", "Optional[bytes]"),
    ("relay.py", "RelayRoom", "token"): ("already closed by WP70", "Secret"),
}


def enumerate_byte_bearing_fields():
    """Walk the package's AST for every dataclass field that could hold file bytes."""
    found = {}
    for path in sorted((_TOOLS / "obsidian_e2e").glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            if not any("dataclass" in ast.unparse(d) for d in node.decorator_list):
                continue
            for stmt in node.body:
                if not isinstance(stmt, ast.AnnAssign) or not isinstance(stmt.target, ast.Name):
                    continue
                annotation = ast.unparse(stmt.annotation)
                name = stmt.target.id
                if (
                    "bytes" in annotation
                    or "Secret" in annotation
                    or any(part in name.lower() for part in _CREDENTIAL_NAME_PARTS)
                ):
                    found[(path.name, node.name, name)] = annotation
    return found


def test_t1_the_enumeration_is_derived_from_the_source_and_matches_the_dispositions() -> None:
    found = enumerate_byte_bearing_fields()
    assert set(found) == set(DISPOSITIONS), (
        "the package's byte-bearing dataclass fields no longer match the pinned sweep; "
        f"unexpected={sorted(set(found) - set(DISPOSITIONS))} "
        f"missing={sorted(set(DISPOSITIONS) - set(found))}"
    )
    for key, annotation in found.items():
        _disposition, expected = DISPOSITIONS[key]
        assert annotation == expected, (key, annotation, expected)

    # The sweep is non-vacuous: it really did look at more than one module, and it really
    # did find the record WP70 already closed.
    assert len({key[0] for key in found}) == 5
    assert DISPOSITIONS[("relay.py", "RelayRoom", "token")][0].endswith("WP70")


def test_t2_install_bundle_state_cannot_be_unwrapped_by_asdict() -> None:
    state = install.BundleState(
        has_marker=False, had_original=True, original_sha256="deadbeef",
        original_bytes=PAYLOAD, marker=None,
    )
    # POSITIVE CONTROL — it really holds the sentinel.
    assert SENTINEL.encode("utf-8") in state.reveal_original_bytes()

    walked = dataclasses.asdict(state)
    assert walked["original_bytes"] is state.original_bytes
    assert SENTINEL not in repr(walked)
    assert SENTINEL not in repr(state)
    assert SENTINEL not in str(state)
    assert SENTINEL not in "%s" % (state,)
    assert SENTINEL not in json.dumps(walked, default=str)


def test_t3_the_community_state_asdict_hole_is_closed_and_was_measured_open_before() -> None:
    """S12 — the charter's central evidence, re-measured here rather than quoted.

    `provisioning._CommunityState` carried `repr=False` plus a HANDWRITTEN `__repr__`.
    That closes `repr()`; `dataclasses.asdict` does not consult `__repr__` at all — it
    walks the fields and deep-copies each leaf. The before/after is the whole argument for
    repairing this with a type instead of a second handwritten method.
    """
    prerepair, _blobs = _prerepair.load()

    before = prerepair.provisioning._CommunityState(
        has_marker=False, had_original=True, original_sha256="deadbeef",
        original_bytes=PAYLOAD,
    )
    # POSITIVE CONTROL on the "before" side, in this same test.
    assert before.original_bytes == PAYLOAD
    assert SENTINEL not in repr(before), "the handwritten repr was already clean"
    assert SENTINEL.encode("utf-8") in dataclasses.asdict(before)["original_bytes"], (
        "the pre-repair asdict hole did not reproduce — the before harness is wrong"
    )

    after = provisioning._CommunityState(
        has_marker=False, had_original=True, original_sha256="deadbeef",
        original_bytes=PAYLOAD,
    )
    # POSITIVE CONTROL on the "after" side, in this same test.
    assert SENTINEL.encode("utf-8") in after.reveal_original_bytes()

    walked = dataclasses.asdict(after)
    assert walked["original_bytes"] is after.original_bytes
    assert not isinstance(walked["original_bytes"], (bytes, bytearray))
    assert SENTINEL not in repr(walked)
    assert SENTINEL not in json.dumps(walked, default=str)
    # The handwritten repr is kept — its fingerprint-and-size output is more useful than
    # `Secret(<redacted>)` — but it is no longer what makes this record safe.
    assert SENTINEL not in repr(after)
    assert "original_size" in repr(after)


def test_t4_the_room_token_is_still_closed_by_wp70s_type() -> None:
    room = relay.RelayRoom(id="room-1", token=SENTINEL, name="n", base_url="http://x")
    assert room.reveal_token() == SENTINEL          # POSITIVE CONTROL
    assert isinstance(room.token, constants.Secret)
    assert SENTINEL not in repr(room)
    assert SENTINEL not in repr(dataclasses.asdict(room))
    assert constants.REDACTED in repr(room)


def test_t5_raw_answer_is_the_carried_up_record_and_its_state_is_measured_not_claimed() -> None:
    """S14 — named, justified and carried up, with the measurement the report quotes.

    `readiness.RawAnswer.body` is the same SHAPE — bytes in a dataclass field behind a
    generated repr — and it is deliberately NOT repaired here: it carries what a control
    endpoint answered, not a file the rig borrowed from the owner, its consumers are a
    different contract, and `readiness.py` is on this charter's may-not-touch list. The
    assertion below is what makes the carry-up honest: it records that the record is still
    renderable, so a later reader can tell a decision from an oversight.
    """
    answer = readiness.RawAnswer(status=200, body=PAYLOAD, error="")
    assert answer.body == PAYLOAD                   # POSITIVE CONTROL
    # MEASURED, and reported as-is: still renderable on the six unconditional paths.
    assert SENTINEL in repr(answer)
    assert SENTINEL in str(answer)
    assert SENTINEL.encode("utf-8") in dataclasses.asdict(answer)["body"]
    # And unmodified by this WP. Asked of git rather than by comparing raw bytes: this
    # checkout normalises line endings, so a byte comparison against the stored blob would
    # report CRLF-vs-LF as a modification.
    diff = subprocess.run(
        ["git", "diff", "--name-only", _prerepair.BASELINE_COMMIT, "--",
         "tools/obsidian_e2e/readiness.py"],
        cwd=str(_REPO), capture_output=True, text=True, check=True,
    ).stdout.split()
    assert diff == []


def test_t6_nothing_outside_tools_obsidian_e2e_was_modified_by_this_wp() -> None:
    """The charter's hard constraint, checked against git rather than asserted."""
    changed = subprocess.run(
        ["git", "diff", "--name-only", _prerepair.BASELINE_COMMIT, "--", "tools/", "server/",
         "plugin/"],
        cwd=str(_REPO), capture_output=True, text=True, check=True,
    ).stdout.split()
    offenders = [
        path
        for path in changed
        if not path.startswith("tools/obsidian_e2e/")
        # `plugin/src/**` belongs to a sibling agent working in this same tree; it is not
        # this WP's and is explicitly excluded rather than silently tolerated.
        and not path.startswith("plugin/src/")
    ]
    assert offenders == [], offenders
    # And no suite was mirrored into the plugin's TypeScript tests.
    assert not list((_REPO / "plugin" / "src" / "__tests__").glob("*[Ww][Pp]77*"))


@pytest.mark.parametrize("module_name", ["ports", "install", "provisioning", "relay",
                                         "constants", "readiness"])
def test_t7_the_package_still_imports_and_gains_no_runtime_dependency(module_name) -> None:
    """A relocation that breaks an import is an abort. Every module still loads."""
    result = subprocess.run(
        [sys.executable, "-c",
         f"import sys; sys.path.insert(0, {str(_TOOLS)!r}); "
         f"from obsidian_e2e import {module_name}; print({module_name}.__name__)"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert f"obsidian_e2e.{module_name}" in result.stdout
