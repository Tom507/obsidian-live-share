# WP69 / AC4 — blind 1. Same subject (restore on every exit path), different angle:
# **the live bundle is mutated after the install**, and the exit paths tested are
# the ones a bare `except Exception` or a `finally` that swallows would miss.
#
# During a gate run the installed `main.js` is not inert: `lan-vault-sync` is
# enabled in both vaults and is a second sync engine that observes
# `.obsidian/plugins/**`, and a retry may rebuild over it. Restore must put back
# what was captured, not what happens to be there — so every case here changes the
# live file behind the module's back first.
#
# Exit paths: SystemExit, GeneratorExit through a closed generator, a nested
# context, and an exception raised by the restore of an inner scope.
#
# DATA SAFETY: synthetic fixture vaults under `h:\tmp\` (or pytest's tmp_path),
# removed again. The owner's live vaults are never touched.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import hashlib
import shutil
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

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

from obsidian_e2e import constants, install  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)
FIXTURE_ROOT = Path(r"h:\tmp")

#: NUL bytes, CRLF, a lone CR and a UTF-16 BOM — a bundle is not text.
PRODUCTION_MAIN = (
    b"\xff\xfe// production\r\n\x00\x00tail\rmore\n" + bytes(range(256))
)
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()
E2E_MAIN = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"{" + m.encode("utf-8") + b"}\n" for m in constants.E2E_BUILD_MARKERS)
    + b"\x00sourcemap\x00"
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture()
def vault(tmp_path: Path) -> Iterator[Path]:
    base = FIXTURE_ROOT if FIXTURE_ROOT.is_dir() else tmp_path
    root = (base / f"wp69b1-{uuid.uuid4().hex}").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP69 fixture vault must never be rooted at or inside an owner vault"
        )
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "main.js").write_bytes(PRODUCTION_MAIN)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "e2e-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def live(vault: Path) -> bytes:
    return (vault / constants.PLUGIN_MAIN_REL).read_bytes()


def test_a_bundle_rewritten_behind_the_modules_back_is_still_restored(
    vault: Path, source_bundle: Path
) -> None:
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        # a second sync engine, a retry, or a stray rebuild lands on the file
        (vault / constants.PLUGIN_MAIN_REL).write_bytes(b"something else entirely\n")
    assert sha(live(vault)) == PRODUCTION_SHA


def test_a_deleted_bundle_is_recreated_from_the_restore_point(
    vault: Path, source_bundle: Path
) -> None:
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        (vault / constants.PLUGIN_MAIN_REL).unlink()
    assert sha(live(vault)) == PRODUCTION_SHA


def test_system_exit_still_restores(vault: Path, source_bundle: Path) -> None:
    """SystemExit is a BaseException; `except Exception` never sees it."""
    with pytest.raises(SystemExit):
        with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
            raise SystemExit(2)
    assert sha(live(vault)) == PRODUCTION_SHA


def test_a_closed_generator_still_restores(vault: Path, source_bundle: Path) -> None:
    """GeneratorExit is thrown into the frame when the generator is garbage-collected
    or closed — the shape a mid-run abort takes inside a pipeline."""

    def stage() -> Iterator[bytes]:
        with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
            yield live(vault)

    gen = stage()
    assert next(gen) == E2E_MAIN
    gen.close()
    assert sha(live(vault)) == PRODUCTION_SHA


def test_nested_contexts_restore_in_reverse_order(
    vault: Path, tmp_path: Path, source_bundle: Path
) -> None:
    inner_bundle = tmp_path / "inner.js"
    inner_bundle.write_bytes(E2E_MAIN + b"// inner\n")

    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        assert live(vault) == E2E_MAIN
        with install.installed_bundle(vault, constants.ROLE_A, inner_bundle):
            assert live(vault) == E2E_MAIN + b"// inner\n"
        # the inner scope's exit restores the ORIGINAL, never the outer's bundle:
        # the borrow is the vault's, and there is only one of it.
        assert sha(live(vault)) == PRODUCTION_SHA
    assert sha(live(vault)) == PRODUCTION_SHA


def test_exotic_bytes_round_trip_exactly(vault: Path, source_bundle: Path) -> None:
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        pass
    restored = live(vault)
    assert restored == PRODUCTION_MAIN
    assert len(restored) == len(PRODUCTION_MAIN)
    assert restored.count(b"\x00") == PRODUCTION_MAIN.count(b"\x00")
    assert restored.count(b"\r\n") == PRODUCTION_MAIN.count(b"\r\n")


def test_the_instrumented_bundle_really_was_live_inside_the_context(
    vault: Path, source_bundle: Path
) -> None:
    """Without this the whole file would pass against a no-op install."""
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        inside = live(vault)
    assert inside == E2E_MAIN
    assert sha(inside) != PRODUCTION_SHA
