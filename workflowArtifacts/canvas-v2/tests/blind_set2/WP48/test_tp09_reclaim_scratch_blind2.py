"""WP48 · TP09 (blind 2) — a stale scratch artefact is RECLAIMED, never REUSED.

Angle: the crashed run left a scratch canvas with real content. The failure mode
under test is an implementation that decides "there is already a scratch file, I
will reuse it" — which would silently carry a previous run's state into the new
one. Also asserts the unreclaimable case surfaces SCRATCH_STALE_UNRECLAIMED
without aborting the reclaim of the other artefact kinds.

DATA SAFETY: fixture vault under `tmp_path` only.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path


def _tools_dir() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "tools").is_dir() and (parent / "plugin").is_dir():
            return parent / "tools"
    raise RuntimeError(f"obsidian-live-share repo root not found above {here}")


sys.path.insert(0, str(_tools_dir()))

from obsidian_e2e import constants, teardown  # noqa: E402

STALE_CONTENT = json.dumps(
    {"nodes": [{"id": "ghost", "x": 10, "y": 20, "width": 30, "height": 40}], "edges": []}
).encode("utf-8")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _scratch_rel(run_id: str) -> str:
    return (
        f"{constants.SCRATCH_FOLDER}/"
        f"{constants.SCRATCH_PREFIX}{run_id}{constants.SCRATCH_EXT}"
    )


def test_previous_run_state_cannot_survive_into_the_next_run(tmp_path: Path) -> None:
    vault = tmp_path / "GhostVault"
    rel = _scratch_rel("20260730T120000Z-4242-999999")
    _write(vault / rel, STALE_CONTENT)
    _write(vault / "Notes" / "ok.md", b"ok\n")

    teardown.reclaim_stale_state(vault)

    assert not (vault / rel).exists()
    survivors = [p for p in vault.rglob("*") if p.is_file()]
    assert [p.name for p in survivors] == ["ok.md"]
    assert all(_sha(p.read_bytes()) != _sha(STALE_CONTENT) for p in survivors)


def test_unremovable_scratch_does_not_block_the_settings_artefact(
    tmp_path: Path, monkeypatch
) -> None:
    vault = tmp_path / "PartlyStuckVault"
    original = b'{"roomId":"fx"}\n'
    _write(vault / _scratch_rel("20260730T130000Z-1-aaaaaa"), STALE_CONTENT)
    _write(vault / constants.PLUGIN_DATA_REL, b'{"roomId":"fx","e2eControlPort":39431}\n')
    _write(vault / constants.SETTINGS_BACKUP_REL, original)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": "20260730T130000Z-1-aaaaaa",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": _sha(original),
                "pid": 1,
                "createdAt": "2026-07-30T13:00:00Z",
            }
        ).encode("utf-8"),
    )

    stuck = str((vault / constants.SCRATCH_FOLDER).resolve())

    def _guard(fn):
        def wrapper(target, *a, **kw):
            if str(Path(target).resolve()).startswith(stuck):
                raise PermissionError("locked by the crashed editor")
            return fn(target, *a, **kw)

        return wrapper

    real_unlink = Path.unlink

    def guard_unlink(self, *a, **kw):
        if str(self.resolve()).startswith(stuck):
            raise PermissionError("locked by the crashed editor")
        return real_unlink(self, *a, **kw)

    monkeypatch.setattr(Path, "unlink", guard_unlink)
    monkeypatch.setattr(os, "remove", _guard(os.remove))
    monkeypatch.setattr(os, "rmdir", _guard(os.rmdir))
    monkeypatch.setattr(shutil, "rmtree", _guard(shutil.rmtree))

    report = teardown.reclaim_stale_state(vault)

    scratch = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SCRATCH]
    settings = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SETTINGS]
    assert scratch and scratch[0].reclaimed is False
    assert scratch[0].reason == constants.SCRATCH_STALE_UNRECLAIMED
    assert settings and settings[0].reclaimed is True
    assert _sha((vault / constants.PLUGIN_DATA_REL).read_bytes()) == _sha(original)


def test_scratch_naming_scheme_comes_from_the_shared_contract(tmp_path: Path) -> None:
    vault = tmp_path / "NamingVault"
    rel = _scratch_rel("20260730T140000Z-2-bbbbbb")
    _write(vault / rel, b"{}")

    assert rel.startswith(constants.SCRATCH_FOLDER + "/")
    assert constants.SCRATCH_PREFIX in rel
    assert rel.endswith(constants.SCRATCH_EXT)

    report = teardown.reclaim_stale_state(vault)

    targets = " ".join(str(a.target) for a in report.artefacts)
    assert constants.SCRATCH_PREFIX in targets
