"""WP48 · TP10 (blind 1) — the port that refuses to be released.

Angle: the rig-owned holder is terminated but the port stays bound. The wait for
release must be bounded and must name its condition; the artefact must come back
unreclaimed rather than the reclaim hanging or lying. Also covers a port with no
identifiable owner.

DATA SAFETY: injected clock, injected port probe, injected process control; the
vault is a `tmp_path` fixture. Nothing real is bound or signalled.
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

RIG_PID = 31337


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


class StubbornPorts:
    """Bound, silent, and never releases."""

    def __init__(self, port: int, owner_pid) -> None:
        self.port = port
        self._owner = owner_pid
        self.probe_calls = 0

    def is_bound(self, port: int) -> bool:
        self.probe_calls += 1
        return port == self.port

    def answers_control(self, port: int) -> bool:
        return False

    def owner_pid(self, port: int):
        return self._owner if port == self.port else None


class Procs:
    def __init__(self, alive) -> None:
        self.alive = set(alive)
        self.terminated: list[int] = []

    def is_alive(self, pid: int) -> bool:
        return pid in self.alive

    def terminate(self, pid: int) -> None:
        self.terminated.append(pid)


def _vault(tmp_path: Path, pid: int) -> Path:
    vault = tmp_path / "StubbornVault"
    _write(vault / "Notes" / "n.md", b"n")
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": "20260731T230000Z-31337-abc",
                "role": constants.ROLE_B,
                "port": constants.REAL_CONTROL_PORT_B,
                "hadOriginal": False,
                "originalSha256": None,
                "pid": pid,
                "createdAt": "2026-07-31T23:00:00Z",
            }
        ).encode("utf-8"),
    )
    _write(vault / constants.PLUGIN_DATA_REL, b'{"e2eControlPort":39432}\n')
    return vault


def test_port_that_never_releases_is_reported_unreclaimed_and_the_wait_is_bounded(
    tmp_path: Path,
) -> None:
    vault = _vault(tmp_path, RIG_PID)
    ports = StubbornPorts(constants.REAL_CONTROL_PORT_B, RIG_PID)
    procs = Procs({RIG_PID})
    clock = Clock()

    report = teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_B,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
        timeout_s=8.0,
    )

    port_artefacts = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_PORT]
    assert len(port_artefacts) == 1
    assert port_artefacts[0].reclaimed is False
    assert port_artefacts[0].reason == constants.WAIT_TIMEOUT
    assert procs.terminated == [RIG_PID]
    # bounded: the reclaim gave up rather than spinning forever
    assert clock.t <= 8.0 * 2
    assert ports.probe_calls >= 2


def test_port_with_no_identifiable_owner_is_never_terminated(tmp_path: Path) -> None:
    vault = _vault(tmp_path, RIG_PID)
    ports = StubbornPorts(constants.REAL_CONTROL_PORT_B, None)
    procs = Procs(set())
    clock = Clock()

    report = teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_B,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert procs.terminated == []
    port_artefacts = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_PORT]
    assert len(port_artefacts) == 1
    assert port_artefacts[0].reclaimed is False


def test_owner_pid_that_is_not_the_marker_pid_is_never_terminated(tmp_path: Path) -> None:
    vault = _vault(tmp_path, RIG_PID)
    ports = StubbornPorts(constants.REAL_CONTROL_PORT_B, 5150)
    procs = Procs({5150})
    clock = Clock()

    teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_B,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert procs.terminated == []


def test_reclaim_without_a_port_probe_does_not_invent_port_artefacts(tmp_path: Path) -> None:
    vault = _vault(tmp_path, RIG_PID)

    report = teardown.reclaim_stale_state(vault)

    assert [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_PORT] == []
