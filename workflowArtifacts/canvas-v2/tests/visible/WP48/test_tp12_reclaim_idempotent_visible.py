"""WP48 · TP12 (visible) — reclaiming is idempotent.

Verifies AC4 ("...and reclaiming is idempotent"). The second pass must be a
no-op: no further actions, no further terminate calls, and byte-identical end
state. A reclaim that "restores" a second time would overwrite the settings the
first pass just put back.

DATA SAFETY: fixture vault under `tmp_path`; injected port/process fakes; state
compared as a relative-path → sha256 map, never as content.
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

RIG_PID = 4242
ORIGINAL = b'{"roomId":"fixture"}\n'
RUN_ID = "20260731T235959Z-4242-deadbe"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _state(root: Path) -> dict[str, str]:
    files = {
        p.relative_to(root).as_posix(): _sha(p.read_bytes())
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }
    dirs = {p.relative_to(root).as_posix() + "/": "<dir>" for p in sorted(root.rglob("*")) if p.is_dir()}
    return {**files, **dirs}


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


def _crashed_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "IdempotentVault"
    _write(vault / "Notes" / "keep.md", b"# owner note\n")
    _write(
        vault
        / constants.SCRATCH_FOLDER
        / f"{constants.SCRATCH_PREFIX}{RUN_ID}{constants.SCRATCH_EXT}",
        b"{}",
    )
    _write(vault / constants.PLUGIN_DATA_REL, b'{"roomId":"fixture","e2eControlPort":39431}\n')
    _write(vault / constants.SETTINGS_BACKUP_REL, ORIGINAL)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": RUN_ID,
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": _sha(ORIGINAL),
                "pid": RIG_PID,
                "createdAt": "2026-07-31T23:59:59Z",
            }
        ).encode("utf-8"),
    )
    return vault


def _reclaim(vault, ports, procs, clock):
    return teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_A,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )


def test_second_reclaim_is_a_no_op_with_the_same_end_state(tmp_path: Path) -> None:
    vault = _crashed_vault(tmp_path)
    ports = Ports(
        {constants.REAL_CONTROL_PORT_A: {"bound": True, "answers": False, "owner_pid": RIG_PID}}
    )
    procs = Procs(ports)
    clock = Clock()

    first = _reclaim(vault, ports, procs, clock)
    state_after_first = _state(vault)
    terminated_after_first = list(procs.terminated)

    second = _reclaim(vault, ports, procs, clock)

    assert first.actions == 3
    assert second.actions == 0
    assert second.reclaimed == []
    assert _state(vault) == state_after_first
    assert procs.terminated == terminated_after_first == [RIG_PID]
    # the restored original was not overwritten by a second "restore"
    assert _sha((vault / constants.PLUGIN_DATA_REL).read_bytes()) == _sha(ORIGINAL)


def test_idempotence_holds_for_three_consecutive_passes(tmp_path: Path) -> None:
    vault = _crashed_vault(tmp_path)
    ports = Ports(
        {constants.REAL_CONTROL_PORT_A: {"bound": True, "answers": False, "owner_pid": RIG_PID}}
    )
    procs = Procs(ports)
    clock = Clock()

    _reclaim(vault, ports, procs, clock)
    baseline = _state(vault)
    reports = [_reclaim(vault, ports, procs, clock) for _ in range(2)]

    assert [r.actions for r in reports] == [0, 0]
    assert _state(vault) == baseline
    assert procs.terminated == [RIG_PID]


def test_reclaim_on_an_already_clean_vault_is_a_no_op_from_the_start(tmp_path: Path) -> None:
    vault = tmp_path / "CleanFromTheStart"
    _write(vault / "Notes" / "keep.md", b"# owner note\n")
    _write(vault / constants.PLUGIN_DATA_REL, ORIGINAL)
    ports = Ports({})
    procs = Procs(ports)
    clock = Clock()
    before = _state(vault)

    report = _reclaim(vault, ports, procs, clock)

    assert report.actions == 0
    assert _state(vault) == before
    assert procs.terminated == []
