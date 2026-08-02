"""WP48 · TP10 (visible) — a bound-but-dead control port is reclaimed, and D15
still holds while doing it.

Verifies AC4 (artefact kind 3 of 3). "Bound but dead" = the port is held but the
control protocol no longer answers. It is reclaimable ONLY when the holder is a
process this rig started (recorded in the rig's own provision marker). A port
held by anything else is reported, never killed — attach-never-kill binds reclaim
exactly as it binds teardown.

DATA SAFETY: no socket is opened and no process is signalled — the port probe and
the process control are injected fakes; the vault is a `tmp_path` fixture.
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
FOREIGN_PID = 9999


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


class FakePorts:
    def __init__(self, state: dict[int, dict]) -> None:
        self.state = state

    def is_bound(self, port: int) -> bool:
        return self.state.get(port, {}).get("bound", False)

    def answers_control(self, port: int) -> bool:
        return self.state.get(port, {}).get("answers", False)

    def owner_pid(self, port: int):
        return self.state.get(port, {}).get("owner_pid")


class FakeProcesses:
    def __init__(self, ports: FakePorts, alive: set[int]) -> None:
        self.ports = ports
        self.alive = set(alive)
        self.terminated: list[int] = []

    def is_alive(self, pid: int) -> bool:
        return pid in self.alive

    def terminate(self, pid: int) -> None:
        self.terminated.append(pid)
        self.alive.discard(pid)
        for entry in self.ports.state.values():
            if entry.get("owner_pid") == pid:
                entry["bound"] = False
                entry["owner_pid"] = None


def _vault_with_marker(tmp_path: Path, *, pid: int = RIG_PID) -> Path:
    vault = tmp_path / "PortVault"
    original = b'{"roomId":"fx"}\n'
    _write(vault / "Notes" / "n.md", b"n")
    _write(vault / constants.PLUGIN_DATA_REL, b'{"roomId":"fx","e2eControlPort":39431}\n')
    _write(vault / constants.SETTINGS_BACKUP_REL, original)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": "20260731T220000Z-4242-abcdef",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": _sha(original),
                "pid": pid,
                "createdAt": "2026-07-31T22:00:00Z",
            }
        ).encode("utf-8"),
    )
    return vault


def test_rig_owned_dead_port_is_reclaimed_and_foreign_one_is_left_alone(
    tmp_path: Path,
) -> None:
    vault = _vault_with_marker(tmp_path)
    ports = FakePorts(
        {
            constants.REAL_CONTROL_PORT_A: {
                "bound": True,
                "answers": False,
                "owner_pid": RIG_PID,
            },
            constants.REAL_CONTROL_PORT_B: {
                "bound": True,
                "answers": False,
                "owner_pid": FOREIGN_PID,
            },
        }
    )
    procs = FakeProcesses(ports, alive={RIG_PID, FOREIGN_PID})
    clock = FakeClock()

    report = teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    port_artefacts = {
        int(a.target): a
        for a in report.artefacts
        if a.kind == teardown.RECLAIM_KIND_PORT
    }
    assert set(port_artefacts) == {constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B}

    assert port_artefacts[constants.REAL_CONTROL_PORT_A].reclaimed is True
    assert port_artefacts[constants.REAL_CONTROL_PORT_B].reclaimed is False

    # D15: exactly one terminate, and never the foreign holder
    assert procs.terminated == [RIG_PID]
    assert FOREIGN_PID not in procs.terminated


def test_a_port_that_still_answers_is_never_touched(tmp_path: Path) -> None:
    """An answering endpoint is a live instance to attach to, not an orphan."""
    vault = _vault_with_marker(tmp_path)
    ports = FakePorts(
        {
            constants.REAL_CONTROL_PORT_A: {
                "bound": True,
                "answers": True,
                "owner_pid": RIG_PID,
            }
        }
    )
    procs = FakeProcesses(ports, alive={RIG_PID})
    clock = FakeClock()

    report = teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_A,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert procs.terminated == []
    assert ports.is_bound(constants.REAL_CONTROL_PORT_A) is True
    assert [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_PORT and a.reclaimed] == []


def test_an_unbound_port_produces_no_port_artefact(tmp_path: Path) -> None:
    vault = _vault_with_marker(tmp_path)
    ports = FakePorts(
        {constants.REAL_CONTROL_PORT_A: {"bound": False, "answers": False, "owner_pid": None}}
    )
    procs = FakeProcesses(ports, alive=set())
    clock = FakeClock()

    report = teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_A,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_PORT] == []
    assert procs.terminated == []
