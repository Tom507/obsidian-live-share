# WP78 / AC2 — "no process spawn is reachable anywhere in `tools/obsidian_e2e/` without a
# runner the caller supplied explicitly, and the assertion is made over the PARSED package
# rather than over its text."
#
# This is the honest, satisfiable form of C71 AC4, and it is what WP71 will re-assert.
#
#   ├── T1  (a) every spawn primitive in the package, enumerated by module/function/line,
#   │           attributed to the one opt-in runner, with the total node count PINNED
#   ├── T2  (b) that runner is the default value of no parameter anywhere, and no `or` /
#   │           if-else substitution names it — in fact nothing in the package names it
#   ├── T3  (c) `build_e2e_bundle`'s `runner` is keyword-only with no default, read from
#   │           the parsed signature (not from `inspect`, which reads an imported object)
#   ├── T4  (d) every call to `build_e2e_bundle` in the repository supplies `runner`
#   ├── T5  the oracle catches what a grep cannot — alias, `importlib.import_module`,
#   │       `getattr(os, "system")`, `from subprocess import run as r`. THIS IS A CONTROL
#   │       ON THE DETECTOR: without it, T1's "only two nodes" could mean "the walk only
#   │       knows two spellings"
#   └── T6  the package has no module-scope `subprocess` binding at all, so there is no
#           `install.subprocess.run(...)` back door around the required parameter
#
# EVERY ABSENCE ASSERTION BELOW IS PRECEDED, IN THE SAME TEST, BY `report.assert_found(...)`.
# `assert not bare_calls` passes when the walk found nothing at all — wrong module path, a
# rename, an empty parse, a stale `__pycache__` — and that is the specific vacuity this
# criterion names. AC4's injection (iii) reddens the control to prove it is load-bearing.
#
# DATA SAFETY: parses `.py` source only. Nothing is imported from the package under test in
# the AST assertions, nothing is executed, no build is run, no vault is read, no socket is
# opened.

from __future__ import annotations

import ast
import sys
import tempfile
import textwrap
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))

import _spawn_oracle as oracle  # noqa: E402

PACKAGE = _TOOLS / "obsidian_e2e"

#: PINNED. The package holds exactly this many spawn primitives, and both are inside the one
#: opt-in runner. Pinning the count is what stops a second one appearing silently: an
#: assertion of the form "they are all in function F" is satisfied by a tree with a hundred
#: of them as long as they are all in F, and by a tree with none at all.
EXPECTED_SPAWN_NODES = 2
EXPECTED_SPAWN_SPELLINGS = {"import subprocess", "subprocess.run"}

#: The 11 modules of the package. Named so that a walk that silently visited fewer — because
#: the path was wrong, or a module was deleted — is a failure rather than a smaller pass.
EXPECTED_MODULES = {
    "__init__.py",
    "constants.py",
    "install.py",
    "lifecycle.py",
    "ports.py",
    "provisioning.py",
    "readiness.py",
    "relay.py",
    "scratch.py",
    "teardown.py",
    "vaults.py",
}


@pytest.fixture()
def report() -> oracle.PackageReport:
    return oracle.scan_package(PACKAGE)


def _tmp_control_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="wp78-control-"))


def _synthetic_default_package(root: Path) -> Path:
    """A two-line package whose parameter default names a module-level callable."""
    package = root / "control_pkg"
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "m.py").write_text(
        "def _a_module_level_default(x):\n    return x\n\n\n"
        "def consumer(value, *, hook=_a_module_level_default):\n    return hook(value)\n",
        encoding="utf-8",
    )
    return package


# ---------------------------------------------------------------------------------
# T1 — (a) the enumerated, attributed, pinned spawn census
# ---------------------------------------------------------------------------------


def test_t1a_every_spawn_primitive_is_inside_the_one_opt_in_runner(
    report: oracle.PackageReport,
) -> None:
    report.assert_found(
        functions=[oracle.BUILD_FN, oracle.OPT_IN_RUNNER], min_spawn_nodes=EXPECTED_SPAWN_NODES
    )
    assert set(report.modules) == EXPECTED_MODULES, (
        f"the walk visited {sorted(report.modules)}, not the 11 modules of the package"
    )

    enumerated = sorted(
        (n.module, n.function, n.line, n.spelling) for n in report.spawn_nodes
    )
    assert len(enumerated) == EXPECTED_SPAWN_NODES, (
        f"the package holds {len(enumerated)} spawn primitive(s), pinned at "
        f"{EXPECTED_SPAWN_NODES}:\n"
        + "\n".join(f"  {m}:{ln} in {fn}() -> {sp}" for m, fn, ln, sp in enumerated)
    )
    for module, function, line, spelling in enumerated:
        assert module == oracle.INSTALL_MODULE, (
            f"a spawn primitive appeared outside install.py: {module}:{line} -> {spelling}"
        )
        assert function == oracle.OPT_IN_RUNNER, (
            f"a spawn primitive is reachable outside the opt-in runner: {module}:{line} in "
            f"{function}() -> {spelling}"
        )
    assert {sp for _, _, _, sp in enumerated} == EXPECTED_SPAWN_SPELLINGS


# ---------------------------------------------------------------------------------
# T2 — (b) the opt-in runner defaults nothing, anywhere
# ---------------------------------------------------------------------------------


def test_t2b_the_opt_in_runner_is_the_default_of_no_parameter_in_the_package(
    report: oracle.PackageReport,
) -> None:
    report.assert_found(functions=[oracle.OPT_IN_RUNNER], min_spawn_nodes=EXPECTED_SPAWN_NODES)
    # POSITIVE CONTROL for the substitution scanner: it must SEE an `x or <module default>`
    # where one really exists, or "no substitution names the runner" is a statement about a
    # scanner that finds nothing. `lifecycle.plan_endpoints(probe=None)` → `probe or
    # default_probe` is one of the fourteen sites the charter enumerates and leaves alone
    # (S17), and it is used here as a live control rather than a synthetic one.
    assert report.substitutions_naming("default_probe"), (
        "POSITIVE CONTROL FAILED: the substitution scanner found no `probe or default_probe` "
        "in lifecycle.py, so it cannot see the shape it is about to declare absent"
    )
    # POSITIVE CONTROL for the parameter-default scanner. It has no live control inside this
    # package — MEASURED, and it is a finding rather than a gap: not one of the package's
    # 42 optional-injectable sites puts the fallback IN the default; all of them default to
    # `None` and substitute in the body. So the control is synthetic, and it is here because
    # a scanner with no control is exactly what makes an absence assertion hollow.
    assert report.param_defaults_naming("default_probe") == (), (
        "the package's own defaults changed shape; re-derive this control"
    )
    control_pkg = _synthetic_default_package(_tmp_control_dir())
    control = oracle.scan_package(control_pkg)
    assert control.param_defaults_naming("_a_module_level_default"), (
        "POSITIVE CONTROL FAILED: the parameter-default scanner cannot see a parameter whose "
        "default names a module-level function, so 'no parameter defaults to the runner' is "
        "a statement about a scanner that finds nothing"
    )

    assert report.param_defaults_naming(oracle.OPT_IN_RUNNER) == ()
    assert report.substitutions_naming(oracle.OPT_IN_RUNNER) == ()
    assert report.name_references(oracle.OPT_IN_RUNNER) == ()
    assert report.param_defaults_naming(oracle.SUPERSEDED_RUNNER) == ()
    assert report.substitutions_naming(oracle.SUPERSEDED_RUNNER) == ()


# ---------------------------------------------------------------------------------
# T3 — (c) the parsed signature
# ---------------------------------------------------------------------------------


def test_t3c_the_parsed_signature_carries_no_default(report: oracle.PackageReport) -> None:
    report.assert_found(functions=[oracle.BUILD_FN], min_spawn_nodes=EXPECTED_SPAWN_NODES)
    # POSITIVE CONTROL for the signature reader: it must report a default where one really
    # exists, or "has_default is False" is a constant.
    control = report.parameter(oracle.BUILD_FN, "plugin_dir")
    assert control is not None
    other = report.parameter("install_bundle", "run_id")
    assert other is not None and other.has_default is True, (
        "POSITIVE CONTROL FAILED: the signature reader reports no default for "
        "`install_bundle(run_id=None)`, which has one"
    )

    runner = report.parameter(oracle.BUILD_FN, "runner")
    assert runner is not None
    assert (runner.kind, runner.has_default, runner.default_source) == (
        "keyword-only",
        False,
        None,
    )


# ---------------------------------------------------------------------------------
# T4 — (d) every call site in the repository supplies `runner`
# ---------------------------------------------------------------------------------


def test_t4d_every_repository_call_site_supplies_runner() -> None:
    sites = oracle.scan_call_sites(_REPO, oracle.BUILD_FN)
    # POSITIVE CONTROL: an absence over an empty list is not evidence. The scanner must have
    # found call sites at all, and it must have found the ones this WP's own suite adds.
    assert len(sites) > 0, (
        "POSITIVE CONTROL FAILED: zero call sites of `build_e2e_bundle` found in the whole "
        "repository. Either the function was renamed or the scan root is wrong — and "
        "'no bare call site' would then pass trivially."
    )
    assert any("WP69" in s.path for s in sites), (
        "POSITIVE CONTROL FAILED: none of WP69's 22 call sites was found"
    )
    assert any("WP78" in s.path for s in sites), (
        "POSITIVE CONTROL FAILED: this WP's own call sites were not found"
    )

    # THE ONE ADMISSIBLE BARE CALL, stated rather than quietly excluded. AC1 T6 has to write
    # `build_e2e_bundle(plugin_dir)` in order to assert that it is refused — the criterion is
    # unassertable otherwise. It is admitted STRUCTURALLY (the call is lexically inside a
    # `with pytest.raises(TypeError):`), never by a file-name allowlist, because an allowlist
    # would also cover a real bare call that happened to live in the same file. Such a call
    # cannot spawn: the TypeError is raised at the call, before the body runs.
    guarded = [s for s in sites if not s.supplies_runner and s.inside_raises_typeerror]
    assert len(guarded) == 1, (
        f"expected exactly one bare-call-under-assertion; found {len(guarded)}: {guarded}"
    )
    assert guarded[0].path.endswith(
        "workflowArtifacts/canvas-v2/tests/visible/WP78/"
        "test_ac1_runner_required_no_substitution_visible.py"
    ), guarded[0].path

    bare = [
        s for s in sites if not s.supplies_runner and not s.inside_raises_typeerror
    ]
    assert bare == [], (
        "call sites reach `build_e2e_bundle` without an explicit runner:\n"
        + "\n".join(f"  {s.path}:{s.line} keywords={s.keywords}" for s in bare)
    )
    spread = [s for s in sites if s.double_star or s.star_args]
    assert spread == [], (
        "a call site passes `*args`/`**kwargs`, which makes the argument list undecidable "
        f"from the AST — the exact property this criterion asserts: {spread}"
    )
    # WP69's 22 are all keyword-supplied and all under its own test tree (charter §3 V4).
    wp69 = [s for s in sites if "/WP69/" in s.path]
    assert len(wp69) == 22, f"WP69's call-site census moved: {len(wp69)} != 22"
    assert all(s.positional == 1 and "runner" in s.keywords for s in wp69)


def test_t4e_the_bare_call_exemption_is_not_a_blanket(tmp_path: Path) -> None:
    """Control on the exemption itself: an unguarded bare call is still reported as bare.

    Without this, `inside_raises_typeerror` could be a field that is always `True`, and T4d's
    exclusion would silently admit every bare call in the repository.
    """
    (tmp_path / "sample.py").write_text(
        "import pytest\n"
        "from obsidian_e2e import install\n\n\n"
        "def guarded():\n"
        "    with pytest.raises(TypeError):\n"
        "        install.build_e2e_bundle('dir')\n\n\n"
        "def unguarded():\n"
        "    install.build_e2e_bundle('dir')\n\n\n"
        "def caught_but_wrong_exception():\n"
        "    with pytest.raises(ValueError):\n"
        "        install.build_e2e_bundle('dir')\n",
        encoding="utf-8",
    )
    sites = sorted(oracle.scan_call_sites(tmp_path, oracle.BUILD_FN), key=lambda s: s.line)
    assert len(sites) == 3, sites
    guarded, unguarded, wrong_exception = sites
    assert guarded.inside_raises_typeerror is True
    assert unguarded.inside_raises_typeerror is False
    assert wrong_exception.inside_raises_typeerror is False, (
        "a `pytest.raises(ValueError)` block must not license a bare call"
    )


# ---------------------------------------------------------------------------------
# T5 — the control on the detector: a grep-defeating spelling is still caught
# ---------------------------------------------------------------------------------


EVASIONS = {
    "alias_import": "from subprocess import run as _r\n_r(['npm'])\n",
    "bare_alias": "import subprocess\nsp = subprocess\nsp.run(['npm'])\n",
    "dynamic_import": "import importlib\nimportlib.import_module('subprocess').run(['npm'])\n",
    "getattr_os": "import os\ngetattr(os, 'system')('npm run build')\n",
    "os_system": "import os\nos.system('npm run build')\n",
    "os_spawnv": "import os\nos.spawnv(os.P_WAIT, 'npm', ['npm'])\n",
    "popen_direct": "from subprocess import Popen\nPopen(['npm'])\n",
}


@pytest.mark.parametrize("label", sorted(EVASIONS))
def test_t5_the_detector_catches_spellings_a_grep_would_miss(
    tmp_path: Path, label: str
) -> None:
    """AC2 says a grep is not sufficient evidence. This shows why, and shows the walk sees it.

    Without this control, T1's "exactly two nodes, both in the opt-in runner" is compatible
    with a detector that only knows two spellings.
    """
    package = tmp_path / "synthetic_pkg"
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "evasive.py").write_text(textwrap.dedent(EVASIONS[label]), encoding="utf-8")

    found = oracle.scan_package(package).spawn_nodes
    assert found, f"the detector missed the {label} spelling: {EVASIONS[label]!r}"
    assert any(n.module == "evasive.py" for n in found)


def test_t5b_the_detector_does_not_fire_on_an_innocent_module(tmp_path: Path) -> None:
    """The other half of the control: a detector that flags everything proves nothing."""
    package = tmp_path / "innocent_pkg"
    package.mkdir()
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "quiet.py").write_text(
        "import os\nfrom pathlib import Path\n\n\ndef listing(root):\n"
        "    return sorted(os.listdir(root)) + [Path(root).name]\n",
        encoding="utf-8",
    )
    assert oracle.scan_package(package).spawn_nodes == ()


# ---------------------------------------------------------------------------------
# T6 — no module-scope `subprocess` binding, so no back door around the parameter
# ---------------------------------------------------------------------------------


def test_t6_the_package_binds_subprocess_nowhere_at_module_scope() -> None:
    """`install.subprocess.run(...)` must not be reachable by anyone who imports the module.

    Removing the parameter default closes the accidental path through `build_e2e_bundle`.
    A module-level `import subprocess` would leave a second one open beside it, needing no
    runner and no call to `build_e2e_bundle` at all — so the import is function-local, and
    this test is what holds it there.
    """
    module_scope_imports = []
    for path in sorted(PACKAGE.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        # POSITIVE CONTROL: the module-scope walk must see the imports that ARE there.
        top_level_imports = [
            n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))
        ]
        if path.name == oracle.INSTALL_MODULE:
            assert top_level_imports, (
                "POSITIVE CONTROL FAILED: no module-scope import found in install.py, so "
                "'no module-scope subprocess import' would pass on an empty list"
            )
        for node in top_level_imports:
            names = (
                [a.name for a in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
            )
            if any(n.split(".")[0] == "subprocess" for n in names):
                module_scope_imports.append(f"{path.name}:{node.lineno}")

    assert module_scope_imports == [], (
        "`subprocess` is bound at module scope in " + ", ".join(module_scope_imports) + " — "
        "that is a spawn seam reachable without naming the runner and without calling "
        "`build_e2e_bundle` at all"
    )
