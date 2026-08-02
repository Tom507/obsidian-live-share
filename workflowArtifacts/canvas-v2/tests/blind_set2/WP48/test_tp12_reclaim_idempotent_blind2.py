"""WP48 · TP12 (blind 2) — idempotence proved by report equality, and the
"reclaim then run then teardown" round trip.

Angle: the second pass is compared to the first via its serialised report, and
the whole start-up → run → teardown cycle is exercised so that a reclaim which
leaves a partial marker behind (making the NEXT start-up act again) is caught.
Also asserts an unreclaimable artefact stays unreclaimable rather than flipping.

DATA SAFETY: fixture vault under `tmp_path`; injected fakes only; hashes only.
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

FOREIGN_PID = 4711
ORIGINAL = b'{"roomId":"blind2"}\n'


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
    def __init__(self) -> None:
        self.terminated: list[int] = []

    def is_alive(self, pid):
        return True

    def terminate(self, pid):
        self.terminated.append(pid)


class NoopIO:
    def __init__(self) -> None:
        self.terminated: list[int] = []

    def restore_setting(self, record) -> None:
        pass

    def remove_scratch(self, path) -> None:
        pass

    def terminate_process(self, pid) -> None:
        self.terminated.append(pid)


def _vault(tmp_path: Path) -> Path:
    vault = tmp_path / "RoundTripVault"
    _write(vault / "Notes" / "keep.md", b"# keep\n")
    _write(vault / constants.PLUGIN_DATA_REL, b'{"roomId":"blind2","e2eControlPort":39431}\n')
    _write(vault / constants.SETTINGS_BACKUP_REL, ORIGINAL)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": "20260801T044444Z-99-ababab",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": _sha(ORIGINAL),
                "pid": 99,
                "createdAt": "2026-08-01T04:44:44Z",
            }
        ).encode("utf-8"),
    )
    _write(
        vault
        / constants.SCRATCH_FOLDER
        / f"{constants.SCRATCH_PREFIX}20260801T044444Z-99-ababab{constants.SCRATCH_EXT}",
        b"{}",
    )
    return vault


def test_second_report_is_structurally_empty_where_the_first_was_not(tmp_path: Path) -> None:
    vault = _vault(tmp_path)

    first = teardown.reclaim_stale_state(vault).to_dict()
    second = teardown.reclaim_stale_state(vault).to_dict()

    assert first["artefacts"] != []
    assert all(a["reclaimed"] for a in first["artefacts"])
    assert [a for a in second["artefacts"] if a["reclaimed"]] == []
    assert json.dumps(second) != json.dumps(first)


def test_start_up_run_teardown_leaves_a_vault_that_needs_no_further_reclaim(
    tmp_path: Path,
) -> None:
    vault = _vault(tmp_path)
    teardown.reclaim_stale_state(vault)
    clean_state = _files(vault)

    io = NoopIO()
    steps: list[str] = []
    runner = teardown.TeardownRunner(
        provisioned_settings=[],
        scratch_artefacts=[],
        processes=[teardown.ProcessRecord(pid=321, role=constants.ROLE_A, rig_started=True)],
        io=io,
        recorder=steps.append,
    )
    outcome = teardown.run_with_teardown(lambda: "green", runner)

    assert outcome.green is True
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)

    next_startup = teardown.reclaim_stale_state(vault)
    assert next_startup.actions == 0
    assert _files(vault) == clean_state


def test_an_unreclaimable_port_stays_unreclaimable_and_is_never_killed(
    tmp_path: Path,
) -> None:
    vault = _vault(tmp_path)
    ports = Ports(
        {
            constants.REAL_CONTROL_PORT_B: {
                "bound": True,
                "answers": False,
                "owner_pid": FOREIGN_PID,
            }
        }
    )
    procs = Procs()
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

    def port_flags(report):
        return [a.reclaimed for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_PORT]

    assert port_flags(first) == [False]
    assert port_flags(second) == [False]
    assert procs.terminated == []
    assert ports.is_bound(constants.REAL_CONTROL_PORT_B) is True
