"""WP48 · TP10 (blind 2) — three ports, one rig orphan; the terminate call list
is the oracle.

Angle: the two real-rig ports plus the legacy headless-rig port 39421 are all
bound. Only the one whose holder the rig's own marker names may be terminated.
This is the port-level expression of D13 (disjoint port pairs) meeting D15
(attach, never kill): a stale headless process must never be killed by the real
rig.

DATA SAFETY: injected fakes; nothing real is bound or signalled.
"""
from __future__ import annotations

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

HEADLESS_PORT = 39421  # existing headless rig port, NOT owned by the real rig
RIG_PID = 2600
HEADLESS_PID = 1300
OWNER_PID = 700


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


class Ports:
    def __init__(self, table: dict[int, dict]) -> None:
        self.table = table

    def is_bound(self, port: int) -> bool:
        return self.table.get(port, {}).get("bound", False)

    def answers_control(self, port: int) -> bool:
        return self.table.get(port, {}).get("answers", False)

    def owner_pid(self, port: int):
        return self.table.get(port, {}).get("owner_pid")


class Procs:
    def __init__(self, ports: Ports) -> None:
        self.ports = ports
        self.terminated: list[int] = []
        self.alive_queries: list[int] = []

    def is_alive(self, pid: int) -> bool:
        self.alive_queries.append(pid)
        return True

    def terminate(self, pid: int) -> None:
        self.terminated.append(pid)
        for entry in self.ports.table.values():
            if entry.get("owner_pid") == pid:
                entry["bound"] = False
                entry["owner_pid"] = None


def _vault(tmp_path: Path) -> Path:
    vault = tmp_path / "ThreePortVault"
    _write(vault / "Notes" / "n.md", b"n")
    _write(vault / constants.PLUGIN_DATA_REL, b'{"e2eControlPort":39431}\n')
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": "20260801T010101Z-2600-aabbcc",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": False,
                "originalSha256": None,
                "pid": RIG_PID,
                "createdAt": "2026-08-01T01:01:01Z",
            }
        ).encode("utf-8"),
    )
    return vault


def test_only_the_marker_owned_holder_is_terminated_across_three_ports(tmp_path: Path) -> None:
    ports = Ports(
        {
            constants.REAL_CONTROL_PORT_A: {"bound": True, "answers": False, "owner_pid": RIG_PID},
            constants.REAL_CONTROL_PORT_B: {
                "bound": True,
                "answers": False,
                "owner_pid": OWNER_PID,
            },
            HEADLESS_PORT: {"bound": True, "answers": False, "owner_pid": HEADLESS_PID},
        }
    )
    procs = Procs(ports)
    clock = Clock()

    report = teardown.reclaim_stale_state(
        _vault(tmp_path),
        ports=(constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B, HEADLESS_PORT),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert procs.terminated == [RIG_PID]
    assert HEADLESS_PID not in procs.terminated
    assert OWNER_PID not in procs.terminated
    assert ports.is_bound(HEADLESS_PORT) is True
    assert ports.is_bound(constants.REAL_CONTROL_PORT_B) is True

    by_port = {int(a.target): a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_PORT}
    assert by_port[constants.REAL_CONTROL_PORT_A].reclaimed is True
    assert by_port[constants.REAL_CONTROL_PORT_B].reclaimed is False
    assert by_port[HEADLESS_PORT].reclaimed is False


def test_the_two_real_rig_ports_are_disjoint_from_the_headless_pair() -> None:
    assert constants.REAL_CONTROL_PORT_A != HEADLESS_PORT
    assert constants.REAL_CONTROL_PORT_B != HEADLESS_PORT
    assert constants.REAL_CONTROL_PORT_A != constants.REAL_CONTROL_PORT_B


def test_terminate_is_never_called_when_every_port_still_answers(tmp_path: Path) -> None:
    ports = Ports(
        {
            constants.REAL_CONTROL_PORT_A: {"bound": True, "answers": True, "owner_pid": RIG_PID},
            constants.REAL_CONTROL_PORT_B: {
                "bound": True,
                "answers": True,
                "owner_pid": OWNER_PID,
            },
        }
    )
    procs = Procs(ports)
    clock = Clock()

    teardown.reclaim_stale_state(
        _vault(tmp_path),
        ports=(constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert procs.terminated == []
