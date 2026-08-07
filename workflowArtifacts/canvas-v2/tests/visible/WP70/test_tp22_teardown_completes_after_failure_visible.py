# WP70 / AC4 — "Teardown reverses it, and runs to completion even when a step fails."
#
# The failure this forbids is the ordinary one: a teardown written as a straight-line
# sequence, where the first raising step abandons every later one — leaving the settings
# borrowed, the community-plugins list modified, or the relay holding the port. Every
# action must be ATTEMPTED, and the report must say which ones failed and why.
#
#   ├── T1 a failure in the middle does not stop the later teardown actions
#   ├── T2 the report names every attempted action, in teardown order
#   ├── T3 the report separates succeeded from failed and records a reason for each
#   ├── T4 a BaseException (KeyboardInterrupt) in a step does not abandon the rest
#   ├── T5 several failing steps are all attempted and all reported
#   └── T6 an all-green teardown reports complete with no failures — T1 is not vacuous
#
# DATA SAFETY: pure in-memory bookkeeping over injected callables. Nothing is written,
# started or opened.

from __future__ import annotations

import sys
from pathlib import Path

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, provisioning  # noqa: E402


class Boom(RuntimeError):
    pass


def actions(log: list, failing: dict) -> list:
    def make(name: str):
        def run():
            log.append(name)
            if name in failing:
                raise failing[name]
            return name

        return (name, run)

    return [
        make("restore_settings_a"),
        make("restore_settings_b"),
        make("restore_community_plugins_a"),
        make("restore_community_plugins_b"),
        make("release_relay"),
    ]


NAMES = (
    "restore_settings_a",
    "restore_settings_b",
    "restore_community_plugins_a",
    "restore_community_plugins_b",
    "release_relay",
)


def test_a_failure_in_the_middle_does_not_stop_the_later_actions() -> None:
    log: list = []
    provisioning.run_teardown(actions(log, {"restore_community_plugins_a": Boom("stuck")}))
    assert log == list(NAMES), "teardown abandoned the steps after the failing one"


def test_the_report_names_every_attempted_action_in_teardown_order() -> None:
    log: list = []
    report = provisioning.run_teardown(actions(log, {"restore_settings_b": Boom("stuck")}))
    assert report.attempted == NAMES
    assert report.complete is True


def test_the_report_separates_succeeded_from_failed_and_records_a_reason() -> None:
    log: list = []
    error = provisioning.CommunityPluginsRestoreMismatch("not byte-exact")
    report = provisioning.run_teardown(actions(log, {"release_relay": error}))

    assert report.failed == ("release_relay",)
    assert set(report.succeeded) == set(NAMES) - {"release_relay"}
    assert report.reasons["release_relay"] == constants.COMMUNITY_PLUGINS_RESTORE_MISMATCH


def test_a_base_exception_in_a_step_does_not_abandon_the_rest() -> None:
    # KeyboardInterrupt derives from BaseException; a bare `except Exception:` around a
    # teardown action would let it escape and abandon everything after it.
    log: list = []
    report = provisioning.run_teardown(actions(log, {"restore_settings_a": KeyboardInterrupt()}))
    assert log == list(NAMES)
    assert report.failed == ("restore_settings_a",)
    assert report.complete is True


def test_several_failing_steps_are_all_attempted_and_all_reported() -> None:
    log: list = []
    report = provisioning.run_teardown(
        actions(
            log,
            {
                "restore_settings_a": Boom("a"),
                "restore_community_plugins_b": Boom("b"),
                "release_relay": Boom("c"),
            },
        )
    )
    assert log == list(NAMES)
    assert report.failed == ("restore_settings_a", "restore_community_plugins_b", "release_relay")
    assert report.succeeded == ("restore_settings_b", "restore_community_plugins_a")
    assert set(report.reasons) == set(report.failed)


def test_an_all_green_teardown_reports_complete_with_no_failures() -> None:
    log: list = []
    report = provisioning.run_teardown(actions(log, {}))
    assert log == list(NAMES)
    assert report.failed == ()
    assert report.succeeded == NAMES
    assert report.reasons == {}
    assert report.complete is True
