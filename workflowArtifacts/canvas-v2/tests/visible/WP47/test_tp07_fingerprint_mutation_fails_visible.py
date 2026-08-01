# WP47 / AC3 — a deliberate mutation of ONE pre-existing byte between the before
# and after fingerprints must make the run FAIL with FINGERPRINT_MISMATCH.
#
# D16: the comparison is an acceptance criterion, not a diagnostic. A run that
# merely logs the mismatch and returns green is exactly the defect this test
# exists to catch, so every assertion here is about the run FAILING.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

import hashlib
import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3 shared contract): <repo>/tools on sys.path, top-level pkg ---
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, scratch  # noqa: E402

TARGET = "Daily/2026-07-31.md"
ORIGINAL = b"# 2026-07-31\n\nAAAA pre-existing note bytes\n"


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n",
        TARGET: ORIGINAL,
        "Projects/Nested/Deep/plan.md": b"deep nested note\n",
        "boards/board.canvas": b'{"nodes":[{"id":"n1"}],"edges":[]}\n',
        "attachments/diagram.png": bytes(range(256)),
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "FixtureVault"
    v.mkdir()
    build_vault(v)
    return v


def flip_one_byte(path: Path) -> None:
    """Mutate exactly one byte — same length, different content."""
    raw = bytearray(path.read_bytes())
    raw[14] = raw[14] ^ 0x01
    path.write_bytes(bytes(raw))


def test_one_flipped_byte_fails_the_run_with_the_named_reason(vault: Path) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            flip_one_byte(vault / TARGET)

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH
    assert TARGET in excinfo.value.changed


def test_the_mismatch_is_a_verdict_not_a_log_line(vault: Path, capsys) -> None:
    """The run must not be able to end successfully. If the implementation ever
    downgrades this to a warning, this test is the one that dies."""
    ended_normally = False
    try:
        with scratch.scratch_run(vault):
            flip_one_byte(vault / TARGET)
        ended_normally = True
    except scratch.ScratchError:
        pass

    assert ended_normally is False, "a mutated vault must never yield a green run"
    # And nothing about the file's content may have been printed (S4).
    out = capsys.readouterr()
    assert "pre-existing note bytes" not in (out.out + out.err)


def test_the_verdict_object_names_the_changed_path_and_only_that_path(vault: Path) -> None:
    run_ref: dict[str, object] = {}
    with pytest.raises(scratch.ScratchError):
        with scratch.scratch_run(vault) as run:
            run_ref["run"] = run
            flip_one_byte(vault / TARGET)

    run = run_ref["run"]
    assert run.verdict.ok is False
    assert run.verdict.reason == constants.FINGERPRINT_MISMATCH
    assert run.verdict.changed == (TARGET,)


def test_artefacts_are_still_removed_when_the_fingerprint_fails(vault: Path) -> None:
    run_ref: dict[str, object] = {}
    with pytest.raises(scratch.ScratchError):
        with scratch.scratch_run(vault) as run:
            run_ref["run"] = run
            flip_one_byte(vault / TARGET)

    run = run_ref["run"]
    assert not run.path.exists()
    assert not run.folder.exists()


def test_a_mutation_by_the_run_body_itself_is_caught_the_same_way(vault: Path) -> None:
    """Provenance is irrelevant: the vault changed, so the run failed."""
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            (vault / "Inbox.md").write_bytes(b"# Inbox\n\nappended by the run\n")

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH
    assert "Inbox.md" in excinfo.value.changed


def test_an_untouched_vault_after_the_same_fixture_still_passes(vault: Path) -> None:
    """Control case — the mismatch must come from the mutation, not the fixture."""
    digest_before = hashlib.sha256((vault / TARGET).read_bytes()).hexdigest()
    with scratch.scratch_run(vault) as run:
        pass
    assert run.verdict.ok is True
    assert hashlib.sha256((vault / TARGET).read_bytes()).hexdigest() == digest_before
