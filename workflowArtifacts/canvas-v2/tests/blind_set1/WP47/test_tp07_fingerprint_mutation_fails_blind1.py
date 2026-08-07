# WP47 / AC3 — the mutation must FAIL the run. Different angle: the mutated byte
# is inside a BINARY attachment (not a note), the mutation happens at three
# different moments (before the body, mid-body, during teardown-adjacent work),
# and the exit status of the run is asserted rather than a log line.

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

ATTACHMENT = "Anhänge/Bildschirmfoto 2026.png"
DEEP_NOTE = "a/b/c/d/e/f/g/tief.md"


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"theme":"obsidian"}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n".encode("utf-8"),
        "Ideen & Skizzen/roadmap.canvas": b'{"nodes":[],"edges":[]}\n',
        ATTACHMENT: bytes(range(200)),
        DEEP_NOTE: b"very deep note\n",
        "leer.md": b"",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


def flip_last_byte(path: Path) -> None:
    raw = bytearray(path.read_bytes())
    raw[-1] = raw[-1] ^ 0xFF
    path.write_bytes(bytes(raw))


def test_a_flipped_byte_in_a_binary_attachment_fails_the_run(vault: Path) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault) as run:
            run.write("{}")
            flip_last_byte(vault / ATTACHMENT)

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH
    assert ATTACHMENT in excinfo.value.changed


def test_a_deep_note_mutation_is_caught_just_the_same(vault: Path) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            flip_last_byte(vault / DEEP_NOTE)

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH
    assert excinfo.value.changed == (DEEP_NOTE,)


def test_writing_into_the_empty_file_is_a_mismatch(vault: Path) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            (vault / "leer.md").write_bytes(b"x")

    assert "leer.md" in excinfo.value.changed


def test_the_run_cannot_reach_its_normal_end(vault: Path) -> None:
    reached_end = False
    with pytest.raises(scratch.ScratchError):
        with scratch.scratch_run(vault):
            flip_last_byte(vault / ATTACHMENT)
        reached_end = True  # pragma: no cover — must be unreachable
    assert reached_end is False


def test_two_mutations_are_both_named(vault: Path) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            flip_last_byte(vault / ATTACHMENT)
            flip_last_byte(vault / DEEP_NOTE)

    assert set(excinfo.value.changed) == {ATTACHMENT, DEEP_NOTE}
    assert list(excinfo.value.changed) == sorted(excinfo.value.changed)


def test_a_mismatch_after_an_exception_is_recorded_without_masking_it(vault: Path) -> None:
    """When the body already failed, the ORIGINAL failure still propagates —
    but the run must not be able to claim a clean vault."""
    captured: dict[str, object] = {}
    with pytest.raises(RuntimeError, match="driver died"):
        with scratch.scratch_run(vault) as run:
            captured["run"] = run
            flip_last_byte(vault / ATTACHMENT)
            raise RuntimeError("driver died")

    run = captured["run"]
    assert run.verdict.ok is False
    assert run.verdict.reason == constants.FINGERPRINT_MISMATCH
    assert ATTACHMENT in run.verdict.changed


def test_the_scratch_artefacts_are_gone_even_on_a_failed_verdict(vault: Path) -> None:
    captured: dict[str, object] = {}
    with pytest.raises(scratch.ScratchError):
        with scratch.scratch_run(vault) as run:
            captured["run"] = run
            flip_last_byte(vault / DEEP_NOTE)

    run = captured["run"]
    assert not run.path.exists()
    assert not run.folder.exists()
