"""WP48 · TP11 (blind 2) — both vaults crashed, both carry all three artefacts.

Angle: the real scenario. Role a and role b each have a leftover provisioned
setting, a stale scratch file and a bound-dead port. Reclaiming one vault must
not reach into the other, and the two originals must not be swapped — the vault
names differ only in a suffix (mirroring `ObsidianOrga` vs `ObsidianOrga - Kopie`,
including the spaces).

DATA SAFETY: two fixture vaults under `tmp_path`; the owner's vaults are never
referenced. Settings compared by sha256 only.
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

PID_A = 1001
PID_B = 1002
ORIGINAL_A = b'{"roomId":"vault-a-original"}\n'
ORIGINAL_B = b'{"roomId":"vault-b-original","extra":true}\n'


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


def _build(root: Path, name: str, *, role: str, pid: int, port: int, original: bytes) -> Path:
    vault = root / name
    _write(vault / "Notes" / f"{role}.md", f"note for {role}\n".encode("utf-8"))
    _write(vault / constants.PLUGIN_DATA_REL, original[:-1] + b',"e2eControlPort":%d}\n' % port)
    _write(vault / constants.SETTINGS_BACKUP_REL, original)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": f"20260801T030303Z-{pid}-abcdef",
                "role": role,
                "port": port,
                "hadOriginal": True,
                "originalSha256": _sha(original),
                "pid": pid,
                "createdAt": "2026-08-01T03:03:03Z",
            }
        ).encode("utf-8"),
    )
    _write(
        vault
        / constants.SCRATCH_FOLDER
        / f"{constants.SCRATCH_PREFIX}20260801T030303Z-{pid}-abcdef{constants.SCRATCH_EXT}",
        b'{"nodes":[],"edges":[]}',
    )
    return vault


def test_both_vaults_are_reclaimed_independently_and_originals_are_not_swapped(
    tmp_path: Path,
) -> None:
    vault_a = _build(
        tmp_path,
        "FixtureOrga",
        role=constants.ROLE_A,
        pid=PID_A,
        port=constants.REAL_CONTROL_PORT_A,
        original=ORIGINAL_A,
    )
    vault_b = _build(
        tmp_path,
        "FixtureOrga - Kopie",
        role=constants.ROLE_B,
        pid=PID_B,
        port=constants.REAL_CONTROL_PORT_B,
        original=ORIGINAL_B,
    )
    ports = Ports(
        {
            constants.REAL_CONTROL_PORT_A: {"bound": True, "answers": False, "owner_pid": PID_A},
            constants.REAL_CONTROL_PORT_B: {"bound": True, "answers": False, "owner_pid": PID_B},
        }
    )
    procs = Procs(ports)
    clock = Clock()

    report_a = teardown.reclaim_stale_state(
        vault_a,
        ports=(constants.REAL_CONTROL_PORT_A,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )
    report_b = teardown.reclaim_stale_state(
        vault_b,
        ports=(constants.REAL_CONTROL_PORT_B,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert report_a.actions == 3
    assert report_b.actions == 3
    assert _sha((vault_a / constants.PLUGIN_DATA_REL).read_bytes()) == _sha(ORIGINAL_A)
    assert _sha((vault_b / constants.PLUGIN_DATA_REL).read_bytes()) == _sha(ORIGINAL_B)
    assert _sha(ORIGINAL_A) != _sha(ORIGINAL_B)
    assert not (vault_a / constants.SCRATCH_FOLDER).exists()
    assert not (vault_b / constants.SCRATCH_FOLDER).exists()
    assert procs.terminated == [PID_A, PID_B]


def test_reclaiming_vault_a_leaves_vault_b_completely_untouched(tmp_path: Path) -> None:
    vault_a = _build(
        tmp_path,
        "FixtureOrga",
        role=constants.ROLE_A,
        pid=PID_A,
        port=constants.REAL_CONTROL_PORT_A,
        original=ORIGINAL_A,
    )
    vault_b = _build(
        tmp_path,
        "FixtureOrga - Kopie",
        role=constants.ROLE_B,
        pid=PID_B,
        port=constants.REAL_CONTROL_PORT_B,
        original=ORIGINAL_B,
    )
    before_b = {
        p.relative_to(vault_b).as_posix(): _sha(p.read_bytes())
        for p in sorted(vault_b.rglob("*"))
        if p.is_file()
    }
    ports = Ports(
        {constants.REAL_CONTROL_PORT_A: {"bound": True, "answers": False, "owner_pid": PID_A}}
    )
    procs = Procs(ports)
    clock = Clock()

    teardown.reclaim_stale_state(
        vault_a,
        ports=(constants.REAL_CONTROL_PORT_A,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    after_b = {
        p.relative_to(vault_b).as_posix(): _sha(p.read_bytes())
        for p in sorted(vault_b.rglob("*"))
        if p.is_file()
    }
    assert after_b == before_b
    assert procs.terminated == [PID_A]
    assert PID_B not in procs.terminated
