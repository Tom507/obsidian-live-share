"""WP48 · TP11 (visible) — all three crash artefacts present at once are
reclaimed in a single start-up pass.

Verifies AC4 ("...are detected at start-up and reclaimed") for the combination,
not just the three kinds in isolation. A crashed run leaves all three together;
an implementation that reclaims one kind and returns early would pass TP08–TP10
and still leave a dirty vault.

DATA SAFETY: fixture vault under `tmp_path`; port probe and process control are
injected fakes; settings compared by sha256 only (S4).
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
ORIGINAL = b'{"roomId":"fixture","serverPassword":"<fixture-not-a-secret>"}\n'
PROVISIONED = b'{"roomId":"fixture","serverPassword":"<fixture-not-a-secret>","e2eControlPort":39431}\n'
STALE_RUN_ID = "20260731T235959Z-4242-deadbe"
SCRATCH_REL = (
    f"{constants.SCRATCH_FOLDER}/"
    f"{constants.SCRATCH_PREFIX}{STALE_RUN_ID}{constants.SCRATCH_EXT}"
)


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
    vault = tmp_path / "CrashedVault"
    _write(vault / "Notes" / "keep.md", b"# owner note\n")
    _write(vault / "Canvases" / "owner.canvas", b'{"nodes":[],"edges":[]}')
    _write(vault / SCRATCH_REL, b'{"nodes":[{"id":"ghost"}],"edges":[]}')
    _write(vault / constants.PLUGIN_DATA_REL, PROVISIONED)
    _write(vault / constants.SETTINGS_BACKUP_REL, ORIGINAL)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": STALE_RUN_ID,
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


def test_the_three_artefact_kinds_are_all_reclaimed_in_one_pass(tmp_path: Path) -> None:
    vault = _crashed_vault(tmp_path)
    ports = Ports(
        {constants.REAL_CONTROL_PORT_A: {"bound": True, "answers": False, "owner_pid": RIG_PID}}
    )
    procs = Procs(ports)
    clock = Clock()

    report = teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_A,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    kinds = {a.kind for a in report.artefacts if a.reclaimed}
    assert kinds == {
        teardown.RECLAIM_KIND_SETTINGS,
        teardown.RECLAIM_KIND_SCRATCH,
        teardown.RECLAIM_KIND_PORT,
    }
    assert report.actions == 3

    # end state, per kind
    assert _sha((vault / constants.PLUGIN_DATA_REL).read_bytes()) == _sha(ORIGINAL)
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
    assert not (vault / constants.SCRATCH_FOLDER).exists()
    assert ports.is_bound(constants.REAL_CONTROL_PORT_A) is False
    assert procs.terminated == [RIG_PID]

    # the owner's content is untouched
    assert (vault / "Notes" / "keep.md").read_bytes() == b"# owner note\n"
    assert (vault / "Canvases" / "owner.canvas").exists()


def test_the_reclaim_kind_names_are_the_three_pinned_strings() -> None:
    assert teardown.RECLAIM_KIND_SETTINGS == "settings"
    assert teardown.RECLAIM_KIND_SCRATCH == "scratch"
    assert teardown.RECLAIM_KIND_PORT == "port"


def test_the_port_step_still_runs_when_the_settings_step_found_nothing(
    tmp_path: Path,
) -> None:
    vault = tmp_path / "PortOnlyVault"
    _write(vault / "Notes" / "n.md", b"n")
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": STALE_RUN_ID,
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": False,
                "originalSha256": None,
                "pid": RIG_PID,
                "createdAt": "2026-07-31T23:59:59Z",
            }
        ).encode("utf-8"),
    )
    ports = Ports(
        {constants.REAL_CONTROL_PORT_A: {"bound": True, "answers": False, "owner_pid": RIG_PID}}
    )
    procs = Procs(ports)
    clock = Clock()

    report = teardown.reclaim_stale_state(
        vault,
        ports=(constants.REAL_CONTROL_PORT_A,),
        port_probe=ports,
        process_control=procs,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert procs.terminated == [RIG_PID]
    assert any(
        a.kind == teardown.RECLAIM_KIND_PORT and a.reclaimed for a in report.artefacts
    )
