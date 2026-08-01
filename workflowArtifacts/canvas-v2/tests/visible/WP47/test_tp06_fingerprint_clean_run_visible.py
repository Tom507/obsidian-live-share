# WP47 / AC3 — before-run and after-teardown fingerprints are EQUAL apart from
# the scratch artefacts, and the fingerprint is (path, size, sha256-of-bytes)
# only — never content (S4).
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

import hashlib
import re
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

SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")


def build_vault(root: Path) -> dict[str, bytes]:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        ".obsidian/community-plugins.json": b'["live-share"]\n',
        f"{constants.PLUGIN_DIR_REL}/main.js": b"// synthetic build marker\n",
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n\n- [ ] pre-existing\n",
        "Daily/2026-07-31.md": b"# 2026-07-31\n\nnote bytes\n",
        "Projects/Nested/Deep/plan.md": b"deep nested note\n",
        "boards/board.canvas": b'{"nodes":[{"id":"n1"}],"edges":[]}\n',
        "attachments/diagram.png": bytes(range(256)),
        ".git/HEAD": b"ref: refs/heads/main\n",
        ".trash/deleted-note.md": b"in the trash\n",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return files


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "FixtureVault"
    v.mkdir()
    build_vault(v)
    return v


def test_fingerprint_entries_are_size_plus_sha256_of_bytes(vault: Path) -> None:
    fp = scratch.fingerprint_vault(vault)
    for rel, entry in fp.items():
        size, digest = entry
        assert isinstance(size, int)
        assert SHA256_HEX.match(digest), f"{rel} entry is not a sha256 hex digest"
        raw = (vault / rel).read_bytes()
        assert size == len(raw)
        assert digest == hashlib.sha256(raw).hexdigest()


def test_fingerprint_excludes_the_rig_and_plugin_and_vcs_folders(vault: Path) -> None:
    (vault / constants.SCRATCH_FOLDER).mkdir()
    (vault / scratch.scratch_relpath("20260101T000000Z-7-cccccc")).write_bytes(b"{}\n")

    fp = scratch.fingerprint_vault(vault)
    keys = set(fp)

    assert "Inbox.md" in keys
    assert "attachments/diagram.png" in keys
    assert not any(k.startswith(constants.SCRATCH_FOLDER + "/") for k in keys)
    assert not any(k.startswith(constants.PLUGIN_DIR_REL + "/") for k in keys)
    assert not any(k.startswith(".git/") for k in keys)
    assert not any(k.startswith(".trash/") for k in keys)
    # .obsidian itself is still covered outside the live-share plugin dir.
    assert ".obsidian/app.json" in keys


def test_before_and_after_are_equal_across_a_clean_run(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    with scratch.scratch_run(vault) as run:
        run.write('{"nodes":[{"id":"a","x":1,"y":2}],"edges":[]}')
    after = scratch.fingerprint_vault(vault)

    assert after == before
    assert scratch.diff_fingerprints(before, after) == ()


def test_the_run_reports_a_green_verdict_and_carries_both_fingerprints(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        assert run.before, "the before-fingerprint must be taken at start-up"
        assert run.after is None, "the after-fingerprint belongs to teardown"

    assert run.after is not None
    assert run.after == run.before
    assert run.verdict.ok is True
    assert run.verdict.reason is None
    assert run.verdict.changed == ()


def test_the_scratch_artefacts_never_appear_in_either_fingerprint(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        assert run.relpath not in run.before
        live = scratch.fingerprint_vault(vault)
        assert run.relpath not in live
        assert constants.SCRATCH_FOLDER not in live
    assert run.relpath not in run.after


def test_the_fingerprint_holds_no_file_content(vault: Path) -> None:
    """S4: a fingerprint that leaked bytes would leak a production secret."""
    fp = scratch.fingerprint_vault(vault)
    blob = repr(fp)
    for marker in (b"pre-existing", b"note bytes", b"deep nested note"):
        assert marker.decode() not in blob
