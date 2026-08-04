# WP69 / AC1 — the mode is reachable through EXACTLY ONE added package.json
# script, and `dev`, `build`, `test`, `test:watch`, `lint` and `format` keep their
# current definitions verbatim. No dependency is added, and the plugin version is
# not bumped.
#
# `plugin/package.json` is a file whose content ships. The baselines below are the
# measured B9b batch baseline (commit fcb2295, tree clean); a test that read the
# current file and compared it to itself could not fail, so the expected values are
# frozen here as literals.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import json
import sys
from pathlib import Path

# --- repo bootstrap (T3 shared contract §0.2): <repo>/tools on sys.path, top-level pkg ---
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover - only fires if the file is moved outside the repo
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants  # noqa: E402

PACKAGE_JSON = _REPO / "plugin" / "package.json"

#: Frozen at the B9b baseline. Every one of these must survive character for character.
BASELINE_SCRIPTS = {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "format": "biome check --write .",
}

BASELINE_DEPENDENCIES = {
    "lib0": "^0.2.97",
    "minimatch": "^10.2.0",
    "y-codemirror.next": "^0.3.5",
    "y-protocols": "^1.0.6",
    "yjs": "^13.6.0",
}

BASELINE_DEV_DEPENDENCIES = {
    "@biomejs/biome": "^1.9.0",
    "@types/node": "^22.0.0",
    "@typescript-eslint/parser": "^8.56.1",
    "esbuild": "^0.24.0",
    "eslint": "^9.39.3",
    "eslint-plugin-obsidianmd": "^0.1.9",
    "obsidian": "latest",
    "tslib": "^2.7.0",
    "typescript": "^5.5.0",
    "vitest": "^4.0.18",
}

BASELINE_VERSION = "0.6.1"


def manifest() -> dict:
    return json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))


def test_every_pre_existing_script_is_verbatim() -> None:
    scripts = manifest()["scripts"]
    for name, command in BASELINE_SCRIPTS.items():
        assert scripts.get(name) == command, f"script {name!r} was rewritten"


def test_exactly_one_script_was_added() -> None:
    scripts = manifest()["scripts"]
    added = set(scripts) - set(BASELINE_SCRIPTS)
    assert added == {constants.E2E_BUILD_SCRIPT}
    assert len(scripts) == len(BASELINE_SCRIPTS) + 1


def test_the_added_script_invokes_the_config_with_the_e2e_argv_token() -> None:
    command = manifest()["scripts"][constants.E2E_BUILD_SCRIPT]
    assert "esbuild.config.mjs" in command
    tail = command.split("esbuild.config.mjs", 1)[1].split()
    assert tail and tail[0] == constants.E2E_BUILD_ARGV, (
        f"the added script must pass {constants.E2E_BUILD_ARGV!r} as argv[2]; "
        f"got {command!r}"
    )
    # `production` is the other terminating mode — the new script must not be it.
    assert "production" not in tail


def test_no_dependency_is_added_or_changed() -> None:
    pkg = manifest()
    assert pkg["dependencies"] == BASELINE_DEPENDENCIES
    assert pkg["devDependencies"] == BASELINE_DEV_DEPENDENCIES


def test_the_plugin_version_is_not_bumped() -> None:
    pkg = manifest()
    assert pkg["version"] == BASELINE_VERSION
    assert pkg["name"] == constants.PLUGIN_ID
    assert pkg["main"] == "main.js"
