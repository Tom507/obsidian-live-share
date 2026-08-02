# WP47 / AC3 — before == after, third angle: the vault is large enough that the
# fingerprint has to be a real walk (100+ files), the exclusion set is checked by
# construction (each excluded tree gets a file that WOULD show up if the
# exclusion were missing), and the digest is verified against hashlib per file.

import hashlib
import sys
from pathlib import Path

import pytest

for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, scratch  # noqa: E402

EXCLUDED_PROBES = [
    f"{constants.PLUGIN_DIR_REL}/data.json",
    f"{constants.PLUGIN_DIR_REL}/main.js",
    f"{constants.PLUGIN_DIR_REL}/nested/deep.json",
    ".git/HEAD",
    ".git/objects/aa/bbccdd",
    ".trash/geloescht.md",
    ".trash/tief/auch-weg.md",
]

INCLUDED_PROBES = [
    ".obsidian/app.json",
    ".obsidian/plugins/other-plugin/main.js",
    ".obsidian/plugins/other-plugin/data.json",
    "sub/nested.canvas",
    "sub/bild.png",
]


def build_vault(root: Path) -> list[str]:
    included = []
    for rel, data in (
        (".obsidian/app.json", b"{}\n"),
        (".obsidian/plugins/other-plugin/main.js", b"// other plugin\n"),
        (".obsidian/plugins/other-plugin/data.json", b'{"harmless":true}\n'),
        ("sub/nested.canvas", b'{"nodes":[],"edges":[]}'),
        ("sub/bild.png", bytes(range(90))),
    ):
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        included.append(rel)

    for i in range(100):
        rel = f"vault-notes/note-{i:03d}.md"
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(f"# note {i}\n{'x' * (i % 7)}\n".encode("utf-8"))
        included.append(rel)

    for rel in EXCLUDED_PROBES:
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"must never be fingerprinted\n")
    return included


@pytest.fixture()
def vault(tmp_path: Path):
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    included = build_vault(v)
    return v, included


def test_the_walk_covers_every_included_file(vault) -> None:
    v, included = vault
    fp = scratch.fingerprint_vault(v)
    assert set(fp) == set(included)
    assert len(fp) >= 100


@pytest.mark.parametrize("probe", EXCLUDED_PROBES)
def test_each_excluded_tree_really_is_excluded(vault, probe: str) -> None:
    v, _ = vault
    assert (v / probe).is_file(), "the probe must exist, or the test proves nothing"
    assert probe not in scratch.fingerprint_vault(v)


@pytest.mark.parametrize("probe", INCLUDED_PROBES)
def test_neighbouring_trees_are_not_over_excluded(vault, probe: str) -> None:
    v, _ = vault
    assert probe in scratch.fingerprint_vault(v)


def test_every_digest_matches_hashlib(vault) -> None:
    v, included = vault
    fp = scratch.fingerprint_vault(v)
    for rel in included:
        raw = (v / rel).read_bytes()
        assert fp[rel] == (len(raw), hashlib.sha256(raw).hexdigest())


def test_before_equals_after_over_a_hundred_file_vault(vault) -> None:
    v, _ = vault
    with scratch.scratch_run(v) as run:
        run.write('{"nodes":[{"id":"only-scratch"}],"edges":[]}')
    assert run.after == run.before
    assert run.verdict.ok is True
    assert run.verdict.changed == ()


def test_a_change_inside_an_excluded_tree_does_not_fail_the_run(vault) -> None:
    """The plugin dir is provisioned by WP44 and is deliberately out of scope
    here — a change there must not be attributed to WP47."""
    v, _ = vault
    with scratch.scratch_run(v) as run:
        (v / constants.PLUGIN_DIR_REL / "data.json").write_bytes(b'{"changed":true}\n')
    assert run.verdict.ok is True


def test_the_fingerprint_never_holds_bytes(vault) -> None:
    v, _ = vault
    dumped = repr(scratch.fingerprint_vault(v))
    assert "must never be fingerprinted" not in dumped
    assert "# note 0" not in dumped
