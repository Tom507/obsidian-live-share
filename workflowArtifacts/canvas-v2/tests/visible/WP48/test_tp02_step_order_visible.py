"""WP48 · TP02 (visible) — the teardown step sequence is IDENTICAL and ORDERED
on all four exit paths.

Verifies AC1 (the "same steps, same order" half). The ordered list is asserted
literally — set membership would pass on a reordered teardown, which is exactly
the defect this test exists to catch.

DATA SAFETY: no vault, no process, no disk.
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

# AC1 names the three steps and their order in prose; this is that prose pinned
# as data. WP48 owns these names (they are not shared-contract constants).
EXPECTED_ORDER = (
    "restore_provisioned_settings",
    "remove_scratch_artefacts",
    "stop_rig_started_processes",
)


class OrderIO:
    def __init__(self) -> None:
        self.order: list[str] = []

    def restore_setting(self, record: object) -> None:
        self.order.append("restore_setting")

    def remove_scratch(self, path: object) -> None:
        self.order.append("remove_scratch")

    def terminate_process(self, pid: int) -> None:
        self.order.append("terminate_process")


def _runner(steps: list[str], io: OrderIO):
    return teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_A, "backup": constants.SETTINGS_BACKUP_REL}],
        scratch_artefacts=[
            f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}ord{constants.SCRATCH_EXT}"
        ],
        processes=[teardown.ProcessRecord(pid=3131, role=constants.ROLE_A, rig_started=True)],
        io=io,
        recorder=steps.append,
    )


def _raise(exc: BaseException):
    def _body():
        raise exc

    return _body


PATHS = {
    "success": lambda: "ok",
    "assertion_failure": _raise(AssertionError("nodes diverged")),
    "raised_exception": _raise(RuntimeError("control server closed")),
    "keyboard_interrupt": _raise(KeyboardInterrupt()),
}


def test_module_pins_the_step_order_declared_by_ac1() -> None:
    assert tuple(teardown.TEARDOWN_STEP_ORDER) == EXPECTED_ORDER


def test_recorded_sequence_is_the_same_ordered_list_on_all_four_paths() -> None:
    sequences: dict[str, list[str]] = {}
    for name, body in PATHS.items():
        steps: list[str] = []
        io = OrderIO()
        outcome = teardown.run_with_teardown(body, _runner(steps, io))
        sequences[name] = steps
        assert steps == list(EXPECTED_ORDER), f"{name}: {steps}"
        assert outcome.teardown_result.steps_run == list(EXPECTED_ORDER), name
        assert io.order == ["restore_setting", "remove_scratch", "terminate_process"], name

    distinct = {tuple(seq) for seq in sequences.values()}
    assert len(distinct) == 1, f"exit paths disagree on teardown order: {sequences}"


def test_order_assertion_is_positional_not_set_membership() -> None:
    """Guard on the guard: a permutation of the same steps must not compare equal."""
    steps: list[str] = []
    teardown.run_with_teardown(lambda: None, _runner(steps, OrderIO()))

    permuted = [EXPECTED_ORDER[2], EXPECTED_ORDER[0], EXPECTED_ORDER[1]]
    assert set(steps) == set(permuted)
    assert steps != permuted
