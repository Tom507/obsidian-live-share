# WP47 / AC3 — the mutation must fail the run, third angle: the mutation is a
# SINGLE BIT in one of a hundred otherwise identical notes, so the verdict can
# only be right if every file is really hashed; and the failure is asserted as a
# non-zero outcome for a caller that does NOT use the context manager's return.

import sys
from pathlib import Path

import pytest

for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, scratch  # noqa: E402

IDENTICAL = b"# same content everywhere\n"
COUNT = 100
VICTIM = "vault-notes/note-073.md"


def build_vault(root: Path) -> None:
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "app.json").write_bytes(b"{}\n")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "data.json").write_bytes(b'{"e2e-fixture":"synthetic"}\n')
    for i in range(COUNT):
        target = root / "vault-notes" / f"note-{i:03d}.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(IDENTICAL)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    build_vault(v)
    return v


def flip_one_bit(path: Path) -> None:
    raw = bytearray(path.read_bytes())
    raw[2] = raw[2] ^ 0b0000_0001
    path.write_bytes(bytes(raw))
    assert len(raw) == len(IDENTICAL)


def test_one_flipped_bit_among_a_hundred_identical_notes_fails_the_run(vault: Path) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault) as run:
            run.write("{}")
            flip_one_bit(vault / VICTIM)

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH
    assert excinfo.value.changed == (VICTIM,)


def test_the_size_is_unchanged_so_only_the_hash_can_have_caught_it(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    flip_one_bit(vault / VICTIM)
    after = scratch.fingerprint_vault(vault)

    assert before[VICTIM][0] == after[VICTIM][0] == len(IDENTICAL)
    assert before[VICTIM][1] != after[VICTIM][1]
    assert scratch.diff_fingerprints(before, after) == (VICTIM,)


def test_the_other_ninety_nine_notes_are_not_implicated(vault: Path) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            flip_one_bit(vault / VICTIM)

    assert len(excinfo.value.changed) == 1


def test_a_caller_that_ignores_the_return_still_cannot_pass(vault: Path) -> None:
    """The verdict is raised, so a caller that never inspects a result object
    still fails — this is what makes it an acceptance criterion (D16)."""
    outcome = "not-run"
    try:
        with scratch.scratch_run(vault):
            flip_one_bit(vault / VICTIM)
        outcome = "green"
    except scratch.ScratchError:
        outcome = "failed"

    assert outcome == "failed"


def test_the_error_message_names_no_file_content(vault: Path, capsys) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            flip_one_bit(vault / VICTIM)

    rendered = str(excinfo.value)
    assert "same content everywhere" not in rendered
    captured = capsys.readouterr()
    assert "same content everywhere" not in (captured.out + captured.err)


def test_deleting_one_of_the_hundred_also_fails(vault: Path) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            (vault / VICTIM).unlink()

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH
    assert VICTIM in excinfo.value.changed


def test_an_untouched_run_over_the_same_vault_is_green(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        run.write("{}")
    assert run.verdict.ok is True
    assert run.verdict.reason is None
