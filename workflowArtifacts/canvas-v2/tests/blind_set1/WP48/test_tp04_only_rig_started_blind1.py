"""WP48 · TP04 (blind 1) — D15 with a mixed process ledger.

Angle: three processes, only one rig-started, and the rig-started one sits in the
MIDDLE of the ledger so a naive "stop the first/last one" implementation is
caught. Also asserts the skipped (attached) processes are reported, not silently
dropped.

DATA SAFETY: fakes only; nothing is signalled.
"""
from __future__ import annotations

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


class Spy:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def restore_setting(self, record) -> None:
        self.calls.append(("restore", record))

    def remove_scratch(self, path) -> None:
        self.calls.append(("remove", path))

    def terminate_process(self, pid: int) -> None:
        self.calls.append(("terminate", pid))

    @property
    def terminated(self) -> list[int]:
        return [pid for kind, pid in self.calls if kind == "terminate"]


LEDGER = [
    teardown.ProcessRecord(pid=5551, role=constants.ROLE_A, rig_started=False),
    teardown.ProcessRecord(pid=5552, role=constants.ROLE_B, rig_started=True),
    teardown.ProcessRecord(pid=5553, role=constants.ROLE_A, rig_started=False),
]


def _drive(processes, body=lambda: None):
    io = Spy()
    steps: list[str] = []
    runner = teardown.TeardownRunner(
        provisioned_settings=[],
        scratch_artefacts=[],
        processes=list(processes),
        io=io,
        recorder=steps.append,
    )
    return io, steps, teardown.run_with_teardown(body, runner)


def test_only_the_middle_rig_started_entry_is_terminated() -> None:
    io, _, _ = _drive(LEDGER)

    assert io.terminated == [5552]
    for attached_pid in (5551, 5553):
        assert attached_pid not in io.terminated


def test_attached_processes_are_reported_as_skipped_not_dropped() -> None:
    io, _, outcome = _drive(LEDGER)
    record = outcome.teardown_result.to_dict()

    assert sorted(record["stopped_pids"]) == [5552]
    assert sorted(record["skipped_pids"]) == [5551, 5553]


def test_duplicate_pid_entries_are_not_terminated_twice() -> None:
    ledger = [
        teardown.ProcessRecord(pid=6060, role=constants.ROLE_A, rig_started=True),
        teardown.ProcessRecord(pid=6060, role=constants.ROLE_A, rig_started=True),
        teardown.ProcessRecord(pid=6060, role=constants.ROLE_B, rig_started=True),
    ]
    io, _, _ = _drive(ledger)

    assert io.terminated == [6060]


def test_an_entry_that_is_attached_wins_over_a_rig_started_duplicate() -> None:
    """Ambiguity must resolve towards NOT killing (D15 is fail-closed)."""
    ledger = [
        teardown.ProcessRecord(pid=7070, role=constants.ROLE_B, rig_started=False),
        teardown.ProcessRecord(pid=7070, role=constants.ROLE_B, rig_started=True),
    ]
    io, _, _ = _drive(ledger)

    assert io.terminated == []
