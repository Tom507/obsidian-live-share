"""WP48 · TP12 (blind 1) — idempotence per artefact kind, in isolation.

Angle: each kind is reclaimed twice on its own, so a kind whose second pass is
destructive cannot hide behind the other two. Adds the interleaved case: reclaim,
recreate a *new* stale artefact, reclaim again — the second pass must act on the
new artefact but not re-act on the old one.

DATA SAFETY: fixture vaults under `tmp_path`; injected fakes only.
"""
from __future__ import annotations

import hashlib
import json
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

RIG_PID = 555
ORIGINAL = b'{"roomId":"blind1"}\n'


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _files(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): _sha(p.read_bytes())
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds


class Ports:
    def __init__(self, table) -> None:
        self.table = table

    def is_bound(self, port):
        return self.table.get(port, {}).get("bound", False)

    def answers_control(self, port):
        return self.table.get(port, {}).get("answers", False)

    def owner_pid(self, port):
        return self.table.get(port, {}).get("owner_pid")


class Procs:
    def __init__(self, ports) -> None:
        self.ports = ports
        self.terminated: list[int] = []

    def is_alive(self, pid):
        return True

    def terminate(self, pid):
        self.terminated.append(pid)
        for entry in self.ports.table.values():
            if entry.get("owner_pid") == pid:
                entry["bound"] = False
                entry["owner_pid"] = None


def _marker(port: int, had_original: bool) -> bytes:
    return json.dumps(
        {
            "runId": "20260731T070000Z-555-aabbcc",
            "role": constants.ROLE_A,
            "port": port,
            "hadOriginal": had_original,
            "originalSha256": _sha(ORIGINAL) if had_original else None,
            "pid": RIG_PID,
            "createdAt": "2026-07-31T07:00:00Z",
        }
    ).encode("utf-8")


def test_settings_only_reclaim_is_idempotent(tmp_path: Path) -> None:
    vault = tmp_path / "SettingsOnly"
    _write(vault / "Notes" / "n.md", b"n")
    _write(vault / constants.PLUGIN_DATA_REL, b'{"roomId":"blind1","e2eControlPort":39431}\n')
    _write(vault / constants.SETTINGS_BACKUP_REL, ORIGINAL)
    _write(vault / constants.PROVISION_MARKER_REL, _marker(constants.REAL_CONTROL_PORT_A, True))

    first = teardown.reclaim_stale_state(vault)
    snapshot = _files(vault)
    second = teardown.reclaim_stale_state(vault)

    assert first.actions >= 1
    assert second.actions == 0
    assert _files(vault) == snapshot
    assert _sha((vault / constants.PLUGIN_DATA_REL).read_bytes()) == _sha(ORIGINAL)


def test_scratch_only_reclaim_is_idempotent(tmp_path: Path) -> None:
    vault = tmp_path / "ScratchOnly"
    _write(vault / "Notes" / "n.md", b"n")
    _write(
        vault
        / constants.SCRATCH_FOLDER
        / f"{constants.SCRATCH_PREFIX}old{constants.SCRATCH_EXT}",
        b"{}",
    )

    first = teardown.reclaim_stale_state(vault)
    snapshot = _files(vault)
    second = teardown.reclaim_stale_state(vault)

    assert first.actions == 1
    assert second.actions == 0
    assert _files(vault) == snapshot
    assert not (vault / constants.SCRATCH_FOLDER).exists()


def test_port_only_reclaim_is_idempotent(tmp_path: Path) -> None:
    vault = tmp_path / "PortOnly"
    _write(vault / "Notes" / "n.md", b"n")
    _write(vault / constants.PROVISION_MARKER_REL, _marker(constants.REAL_CONTROL_PORT_B, False))
    ports = Ports(
        {constants.REAL_CONTROL_PORT_B: {"bound": True, "answers": False, "owner_pid": RIG_PID}}
    )
    procs = Procs(ports)
    clock = Clock()

    def run():
        return teardown.reclaim_stale_state(
            vault,
            ports=(constants.REAL_CONTROL_PORT_B,),
            port_probe=ports,
            process_control=procs,
            clock=clock.now,
            sleep=clock.sleep,
        )

    first = run()
    second = run()

    assert any(a.kind == teardown.RECLAIM_KIND_PORT and a.reclaimed for a in first.artefacts)
    assert [a for a in second.artefacts if a.kind == teardown.RECLAIM_KIND_PORT] == []
    assert procs.terminated == [RIG_PID]


def test_a_new_stale_artefact_after_a_reclaim_is_still_picked_up(tmp_path: Path) -> None:
    vault = tmp_path / "Interleaved"
    _write(vault / "Notes" / "n.md", b"n")
    _write(
        vault
        / constants.SCRATCH_FOLDER
        / f"{constants.SCRATCH_PREFIX}first{constants.SCRATCH_EXT}",
        b"{}",
    )

    first = teardown.reclaim_stale_state(vault)
    _write(
        vault
        / constants.SCRATCH_FOLDER
        / f"{constants.SCRATCH_PREFIX}second{constants.SCRATCH_EXT}",
        b"{}",
    )
    second = teardown.reclaim_stale_state(vault)
    third = teardown.reclaim_stale_state(vault)

    assert first.actions == 1
    assert second.actions == 1
    assert third.actions == 0
    assert not (vault / constants.SCRATCH_FOLDER).exists()
