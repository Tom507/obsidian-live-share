# WP44 / AC2 (blind 1) — byte-exact restore measured over the whole plugin
# directory, not just over data.json.
#
# Angle: the visible set hashes one file. Here the oracle is a manifest of the
# entire plugin folder — every relative path, every size, every sha256 — taken
# before the run and after teardown. That catches a restore that is byte-exact
# for data.json while leaving a stray temp file, a `.bak`, or a changed sibling.

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

ORIGINAL = (
    b'{"serverUrl":"wss://example.invalid/ws-mux/","serverPassword":"FAKE-PW-BLIND1-3333",'
    b'"roomId":"blind-room","nested":{"list":[1,2,3],"flag":false}}'
)


def manifest(root: Path) -> dict[str, tuple[int, str]]:
    out: dict[str, tuple[int, str]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            blob = path.read_bytes()
            out[path.relative_to(root).as_posix()] = (
                len(blob),
                hashlib.sha256(blob).hexdigest(),
            )
    return out


def make_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault with spaces"
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    (plugin_dir / "main.js").write_bytes(b"// fixture build\nconsole.log(1);\n")
    (plugin_dir / "styles.css").write_bytes(b".ls {}\n")
    (plugin_dir / "manifest.json").write_bytes(b'{"id":"live-share","version":"0.6.1"}')
    return vault


def test_the_plugin_directory_is_identical_after_teardown(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    before = manifest(plugin_dir)

    ports.provision_port(vault, constants.ROLE_B)
    during = manifest(plugin_dir)
    assert during != before  # the run really did borrow the file

    ports.restore_port(vault)

    assert manifest(plugin_dir) == before


def test_the_siblings_are_never_opened_for_writing(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    siblings = {
        name: (plugin_dir / name).read_bytes()
        for name in ("main.js", "styles.css", "manifest.json")
    }

    ports.provision_port(vault, constants.ROLE_A)

    for name, blob in siblings.items():
        assert (plugin_dir / name).read_bytes() == blob, f"{name} was modified"

    ports.restore_port(vault)
    for name, blob in siblings.items():
        assert (plugin_dir / name).read_bytes() == blob


def test_a_minified_original_with_no_trailing_newline_returns_exactly(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    ports.provision_port(vault, constants.ROLE_A)
    ports.restore_port(vault)

    restored = settings_path.read_bytes()
    assert restored == ORIGINAL
    assert len(restored) == len(ORIGINAL)
    assert not restored.endswith(b"\n")
    assert hashlib.sha256(restored).hexdigest() == hashlib.sha256(ORIGINAL).hexdigest()
