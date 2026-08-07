# WP77 — the "before" harness: a BYTE COPY of the pre-repair package.
#
# AC5 requires every injection to be shown producing the pre-repair outcome "against a
# byte copy of the pre-repair code under an identical harness". A re-typed excerpt, a
# hand-built stand-in dataclass or a monkeypatched field would all be a *model* of the
# pre-repair code, and a model that is wrong in the interesting direction is exactly how
# a falsification stops falsifying anything.
#
# So the bytes come out of git's object store: `git ls-tree` gives the blob sha of every
# module of `tools/obsidian_e2e/` at the baseline commit, `git cat-file blob <sha>` gives
# that blob's bytes verbatim, and the sha is re-derived from the written file so "byte
# copy" is *measured* here rather than asserted in the report. The copy is imported under
# a different package name so both the pre-repair and the repaired package can be live in
# one interpreter, side by side, in one test.
#
# One honest qualification, stated because AC5 turns on the word "byte": the copy is of
# the COMMITTED BLOB. This checkout normalises line endings, so the worktree file at the
# baseline had CRLF where the blob has LF. Python's tokenizer treats the two identically
# and no assertion in this WP depends on a line ending, but the phrase "byte copy" means
# "byte-identical to what git stored", verified against git's own object id, and not
# "byte-identical to the bytes that happened to be on this disk".
#
# DATA SAFETY: this reads git blobs of this repository's own source. It reads no vault,
# no `data.json` and no credential of any kind.

from __future__ import annotations

import hashlib
import importlib
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, Tuple

#: The batch baseline — the last commit before WP77 touched `tools/obsidian_e2e/`.
#: Pinned rather than `HEAD`, because this WP commits and `HEAD` would drift onto the
#: repaired code, at which point the "before" harness would silently become the "after"
#: one and every falsification would go quietly vacuous.
BASELINE_COMMIT = "02aef92d251ac7a5fd6a764fd4204331dc934973"

PACKAGE_NAME = "obsidian_e2e_prerepair"
_SOURCE_DIR_REL = "tools/obsidian_e2e"

_CACHE: Dict[str, Tuple[Path, Dict[str, str]]] = {}


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "tools").is_dir() and (parent / "plugin").is_dir():
            return parent
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")


def _git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", *args], cwd=str(repo), capture_output=True, check=True
    )
    return result.stdout


def materialise() -> Tuple[Path, Dict[str, str]]:
    """Write the baseline package to a temp dir and return ``(dir, {name: blob_sha})``."""
    if PACKAGE_NAME in _CACHE:
        return _CACHE[PACKAGE_NAME]

    repo = _repo_root()
    listing = _git(repo, "ls-tree", "-r", BASELINE_COMMIT, _SOURCE_DIR_REL).decode("utf-8")
    root = Path(tempfile.mkdtemp(prefix="wp77-prerepair-"))
    target = root / PACKAGE_NAME
    target.mkdir()

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
        # Re-derive git's own object id from the file that was written. This is what
        # makes "byte copy" a measurement: if one byte differed, this would not match.
        header = f"blob {len(raw)}\0".encode("utf-8")
        assert hashlib.sha1(header + raw).hexdigest() == sha, name
        blobs[name] = sha

    assert "ports.py" in blobs and "install.py" in blobs and "provisioning.py" in blobs
    _CACHE[PACKAGE_NAME] = (root, blobs)
    return _CACHE[PACKAGE_NAME]


def load():
    """Import the pre-repair package and return ``(module, {name: blob_sha})``."""
    root, blobs = materialise()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    module = importlib.import_module(PACKAGE_NAME)
    for sub in ("constants", "ports", "install", "provisioning", "relay", "readiness"):
        importlib.import_module(f"{PACKAGE_NAME}.{sub}")
    return module, blobs


def package_root() -> str:
    """The directory to put on ``sys.path`` so a subprocess can import the copy."""
    return str(materialise()[0])
