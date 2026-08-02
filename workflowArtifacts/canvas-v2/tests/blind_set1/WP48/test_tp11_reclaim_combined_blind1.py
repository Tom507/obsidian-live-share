"""WP48 · TP11 (blind 1) — partial combinations: two kinds present, one absent.

Angle: every 2-of-3 subset. An implementation that only handles the full house,
or that aborts the remaining kinds when one kind finds nothing, is caught here.
The foreign process must still be left alone in every combination.

DATA SAFETY: fixture vault under `tmp_path`; injected port/process fakes; only
hashes are compared.
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

import pytest  # noqa: E402
from obsidian_e2e import constants, teardown  # noqa: E402

RIG_PID = 8484
FOREIGN_PID = 606
ORIGINAL = b'{"roomId":"blindfix"}\n'


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


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


def _marker_bytes(had_original: bool) -> bytes:
    return json.dumps(
        {
            "runId": "20260731T060000Z-8484-0a0b0c",
            "role": constants.ROLE_B,
            "port": constants.REAL_CONTROL_PORT_B,
            "hadOriginal": had_original,
            "originalSha256": _sha(ORIGINAL) if had_original else None,
            "pid": RIG_PID,
            "createdAt": "2026-07-31T06:00:00Z",
        }
    ).encode("utf-8")


def _build(tmp_path: Path, *, settings: bool, scratch: bool) -> Path:
    vault = tmp_path / "ComboVault"
    _write(vault / "Notes" / "n.md", b"n")
    if settings:
        _write(vault / constants.PLUGIN_DATA_REL, b'{"roomId":"blindfix","e2eControlPort":39432}\n')
        _write(vault / constants.SETTINGS_BACKUP_REL, ORIGINAL)
        _write(vault / constants.PROVISION_MARKER_REL, _marker_bytes(True))
    else:
        # the marker is what records rig ownership of the port; keep it even when
        # there is no settings artefact left to restore
        _write(vault / constants.PROVISION_MARKER_REL, _marker_bytes(False))
    if scratch:
        _write(
            vault
            / constants.SCRATCH_FOLDER
            / f"{constants.SCRATCH_PREFIX}20260731T060000Z-8484-0a0b0c{constants.SCRATCH_EXT}",
            b"{}",
        )
    return vault


@pytest.mark.parametrize(
    "settings,scratch,port",
    [(True, True, False), (True, False, True), (False, True, True)],
    ids=["settings+scratch", "settings+port", "scratch+port"],
)
def test_two_of_three_kinds_are_both_reclaimed(
    tmp_path: Path, settings: bool, scratch: bool, port: bool
) -> None:
    vault = _build(tmp_path, settings=settings, scratch=scratch)
    table = {}
    if port:
        table[constants.REAL_CONTROL_PORT_B] = {
            "bound": True,
            "answers": False,
            "owner_pid": RIG_PID,
        }
    table[constants.REAL_CONTROL_PORT_A] = {
        "bound": True,
        "answers": False,
        "owner_pid": FOREIGN_PID,
    }
    ports = Ports(table)
    procs = Procs(ports)
    clock = Clock()

    report = teardown.reclaim_stale_state(
        vault,
        ports=tuple(table),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    reclaimed_kinds = {a.kind for a in report.artefacts if a.reclaimed}
    if scratch:
        assert teardown.RECLAIM_KIND_SCRATCH in reclaimed_kinds
        assert not (vault / constants.SCRATCH_FOLDER).exists()
    if settings:
        assert teardown.RECLAIM_KIND_SETTINGS in reclaimed_kinds
        assert _sha((vault / constants.PLUGIN_DATA_REL).read_bytes()) == _sha(ORIGINAL)
    if port:
        assert teardown.RECLAIM_KIND_PORT in reclaimed_kinds
        assert procs.terminated == [RIG_PID]
    else:
        assert procs.terminated == []

    # D15 in every combination
    assert FOREIGN_PID not in procs.terminated
    assert ports.is_bound(constants.REAL_CONTROL_PORT_A) is True


def test_nothing_stale_at_all_yields_an_empty_report(tmp_path: Path) -> None:
    vault = tmp_path / "PristineVault"
    _write(vault / "Notes" / "n.md", b"n")
    ports = Ports({})
    procs = Procs(ports)

    report = teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_A,),
        port_probe=ports,
        process_control=procs,
        clock=Clock().now,
        sleep=Clock().sleep,
    )

    assert report.actions == 0
    assert report.reclaimed == []
    assert procs.terminated == []
