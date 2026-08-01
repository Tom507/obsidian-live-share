# WP44 / AC1 — provisioning does NOT go through a process environment variable,
# and the reason for that is recorded at the provisioning site.
#
# The failure this guards against is silent and total: if the port travelled via
# `process.env.LIVESHARE_E2E`, both vault windows of the single Obsidian process
# would receive the same port, one control server would win the bind, and the rig
# would happily drive one vault twice while believing it drove two.
#
#   ├── T1 provisioning mutates no environment variable at all.
#   ├── T2 a pre-existing LIVESHARE_E2E in the environment is neither read as the
#   │      provisioning channel nor rewritten.
#   ├── T3 the module never writes to os.environ / putenv (structural, not incidental).
#   └── T4 the D14 rationale is recorded at the provisioning site.
#
# Data safety: fixture vault under tmp_path only.

from __future__ import annotations

import inspect
import json
import os
import re
from pathlib import Path

from obsidian_e2e import constants, ports

FAKE_SETTINGS = {
    "serverUrl": "wss://example.invalid/ws-mux/",
    "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",
    "roomId": "fixture-room",
}


def make_vault(tmp_path: Path, name: str = "vault-a") -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps(FAKE_SETTINGS, indent=2).encode("utf-8")
    )
    return vault


def test_provisioning_mutates_no_environment_variable(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    before = dict(os.environ)

    ports.provision_port(vault, constants.ROLE_A)
    assert dict(os.environ) == before, "provisioning must not touch the process environment"

    ports.restore_port(vault)
    assert dict(os.environ) == before, "restore must not touch the process environment"

    assert "LIVESHARE_E2E" not in os.environ


def test_a_preexisting_env_flag_is_neither_used_nor_rewritten(
    tmp_path: Path, monkeypatch
) -> None:
    # A leftover flag from a headless run must not become the provisioning channel.
    monkeypatch.setenv("LIVESHARE_E2E", "39421")
    vault = make_vault(tmp_path)

    record = ports.provision_port(vault, constants.ROLE_B)

    assert os.environ["LIVESHARE_E2E"] == "39421", "the rig must not rewrite the env flag"
    assert record.port == constants.REAL_CONTROL_PORT_B
    settings = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    assert int(settings[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_B


def test_the_module_never_writes_to_the_environment(tmp_path: Path) -> None:
    source = inspect.getsource(ports)

    assert "putenv" not in source
    assert not re.search(r"os\.environ\s*\[[^\]]+\]\s*=", source), (
        "os.environ[...] = ... in the provisioning module means the port has a second, "
        "process-wide channel — which is exactly what D14 forbids"
    )
    assert not re.search(r"os\.environ\.(update|setdefault|pop)\s*\(", source)


def test_the_d14_rationale_is_recorded_at_the_provisioning_site() -> None:
    module_source = inspect.getsource(ports)
    assert "D14" in module_source, (
        "AC1 requires the reason to be recorded at the provisioning site, "
        "not only in the BUILD_SPEC"
    )

    # The rationale must sit where a reader of the provisioning code will find it:
    # the module docstring or the provisioning function itself.
    site = (ports.__doc__ or "") + inspect.getsource(ports.provision_port)
    lowered = site.lower()
    assert "d14" in lowered
    assert "env" in lowered, "the rationale must name the channel it rejects (process env)"
    assert any(
        phrase in lowered
        for phrase in ("one obsidian process", "single process", "same process", "one process")
    ), "the rationale must name WHY env cannot work: both windows share one process"
