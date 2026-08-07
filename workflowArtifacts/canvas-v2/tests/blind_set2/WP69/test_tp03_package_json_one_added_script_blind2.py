# WP69 / AC1 — blind 2. Same subject (`plugin/package.json`), different angle:
# the file is compared to a **frozen whole-object baseline** with the `scripts` key
# lifted out, rather than key by key.
#
# `package.json` is the manifest of what ships. A key-by-key test says nothing about
# a key nobody thought to name — `overrides`, `resolutions`, `engines`, a
# `pnpm.onlyBuiltDependencies`, a second `main`. This WP is allowed to add exactly
# one script and nothing else, so the correct assertion is over the whole document.
#
# Baseline: the B9b batch baseline `fcb229523d90d13b676059b8533ef1be6405a7de`,
# measured on a clean tree.
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

BASELINE = {
    "name": "live-share",
    "version": "0.6.1",
    "private": True,
    "main": "main.js",
    "scripts": {
        "dev": "node esbuild.config.mjs",
        "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
        "test": "vitest run",
        "test:watch": "vitest",
        "lint": "biome check .",
        "format": "biome check --write .",
    },
    "dependencies": {
        "lib0": "^0.2.97",
        "minimatch": "^10.2.0",
        "y-codemirror.next": "^0.3.5",
        "y-protocols": "^1.0.6",
        "yjs": "^13.6.0",
    },
    "devDependencies": {
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
    },
}


def pkg() -> dict:
    return json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))


def test_scripts_is_the_only_top_level_key_that_changed() -> None:
    current = pkg()
    assert set(current) == set(BASELINE), (
        f"top-level keys changed: added {set(current) - set(BASELINE)}, "
        f"removed {set(BASELINE) - set(current)}"
    )
    for key, expected in BASELINE.items():
        if key == "scripts":
            continue
        assert current[key] == expected, f"top-level key {key!r} was modified"


def test_the_scripts_object_is_the_baseline_plus_one_entry() -> None:
    scripts = pkg()["scripts"]
    added = {k: v for k, v in scripts.items() if k not in BASELINE["scripts"]}
    assert len(added) == 1
    assert set(added) == {constants.E2E_BUILD_SCRIPT}
    assert {k: v for k, v in scripts.items() if k in BASELINE["scripts"]} == BASELINE["scripts"]


def test_the_dependency_graph_is_untouched_in_both_directions() -> None:
    current = pkg()
    for section in ("dependencies", "devDependencies"):
        assert set(current[section]) == set(BASELINE[section]), (
            f"{section}: added {set(current[section]) - set(BASELINE[section])}, "
            f"removed {set(BASELINE[section]) - set(current[section])}"
        )
        for name, spec in BASELINE[section].items():
            assert current[section][name] == spec, f"{section}.{name} was re-pinned"


def test_the_shipped_identity_is_unchanged() -> None:
    current = pkg()
    assert current["version"] == BASELINE["version"], "the plugin version was bumped"
    assert current["name"] == BASELINE["name"]
    assert current["main"] == BASELINE["main"]
    assert current["private"] is True


def test_the_new_script_name_and_token_are_the_pinned_constants() -> None:
    scripts = pkg()["scripts"]
    assert constants.E2E_BUILD_SCRIPT in scripts
    tail = scripts[constants.E2E_BUILD_SCRIPT].split("esbuild.config.mjs", 1)[1].split()
    assert tail[:1] == [constants.E2E_BUILD_ARGV]


def test_no_literal_of_the_argv_token_is_spelled_twice_in_the_scripts() -> None:
    """Shared-ownership rule 3: every argv token appears in constants.py, and the
    package.json script is its single other spelling."""
    scripts = pkg()["scripts"]
    hits = [name for name, cmd in scripts.items() if constants.E2E_BUILD_ARGV in cmd.split()]
    assert hits == [constants.E2E_BUILD_SCRIPT]


def test_the_file_is_still_a_single_json_object_with_no_duplicate_keys() -> None:
    def reject_duplicates(pairs):  # noqa: ANN001, ANN202
        seen = {}
        for key, value in pairs:
            assert key not in seen, f"duplicate key {key!r} in package.json"
            seen[key] = value
        return seen

    json.loads(PACKAGE_JSON.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates)
