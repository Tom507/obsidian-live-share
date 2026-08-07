# WP78 — the "before" harness: a BYTE COPY of the pre-repair package.
#
# AC4 requires every injection to be shown producing the pre-repair outcome "against a byte
# copy of the pre-repair module under an identical harness". A re-typed excerpt or a
# hand-written stand-in would be a *model* of the pre-repair code, and a model that is wrong
# in the interesting direction is exactly how a falsification stops falsifying anything.
#
# So the bytes come out of git's object store: `git ls-tree` gives the blob sha of every
# module of `tools/obsidian_e2e/` at the baseline commit, `git cat-file blob <sha>` gives
# that blob's bytes verbatim, and git's own object id is re-derived from the file that was
# written — so "byte copy" is MEASURED here rather than asserted in the report.
#
# The copy is only ever PARSED, never imported and never executed. WP78's whole subject is a
# module that can start a process, and the pre-repair copy is the version in which starting
# one takes no argument at all; importing it would be the one thing this WP exists to make
# impossible. `_spawn_oracle` reads the directory this module materialises with `ast.parse`
# and nothing else.
#
# The mechanism is WP77's `_prerepair.py`, reused rather than reinvented (rule 10); the
# baseline commit and the no-import rule are this WP's.
#
# DATA SAFETY: this reads git blobs of this repository's own source. It reads no vault, no
# `data.json` and no credential of any kind.

from __future__ import annotations

import hashlib
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Tuple

#: The batch baseline — the last commit before WP78 touched `tools/obsidian_e2e/`.
#: Pinned rather than `HEAD`, because this WP commits and `HEAD` would drift onto the
#: repaired code, at which point the "before" harness would silently become the "after" one
#: and every falsification in AC4 would go quietly vacuous.
BASELINE_COMMIT = "d9390bad587a8ec5d2738166f7f291a47dfbdef4"

_SOURCE_DIR_REL = "tools/obsidian_e2e"

_CACHE: Dict[str, Tuple[Path, Dict[str, str]]] = {}


def repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "tools").is_dir() and (parent / "plugin").is_dir():
            return parent
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")


def _git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(["git", *args], cwd=str(repo), capture_output=True, check=True)
    return result.stdout


def materialise() -> Tuple[Path, Dict[str, str]]:
    """Write the baseline package to a temp dir; return ``(dir, {name: blob_sha})``."""
    if BASELINE_COMMIT in _CACHE:
        return _CACHE[BASELINE_COMMIT]

    repo = repo_root()
    listing = _git(repo, "ls-tree", "-r", BASELINE_COMMIT, _SOURCE_DIR_REL).decode("utf-8")
    target = Path(tempfile.mkdtemp(prefix="wp78-prerepair-")) / "obsidian_e2e"
    target.mkdir(parents=True)

    blobs: Dict[str, str] = {}
    for line in listing.splitlines():
        if not line.strip():
            continue
        meta, path = line.split("\t", 1)
        _mode, kind, sha = meta.split()
        if kind != "blob" or not path.endswith(".py"):
            continue
        raw = _git(repo, "cat-file", "blob", sha)
        name = path.rsplit("/", 1)[-1]
        (target / name).write_bytes(raw)
        # Re-derive git's own object id from the file that was written. This is what makes
        # "byte copy" a measurement: if one byte differed, this would not match.
        header = f"blob {len(raw)}\0".encode("utf-8")
        assert hashlib.sha1(header + raw).hexdigest() == sha, name
        blobs[name] = sha

    assert "install.py" in blobs, "the baseline package must contain install.py"
    _CACHE[BASELINE_COMMIT] = (target, blobs)
    return _CACHE[BASELINE_COMMIT]


def package_dir() -> Path:
    """The directory holding the byte-copied pre-repair package. Parse it; never import it."""
    return materialise()[0]


def blob_shas() -> Dict[str, str]:
    """``{module filename: git blob sha}`` for the byte copy, as written and re-derived."""
    return dict(materialise()[1])
