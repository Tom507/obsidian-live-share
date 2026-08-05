# WP78 — the headless spawn oracle.
#
# It answers exactly one question, over a PARSED package: "can a process be started here
# without a caller having supplied a runner?" — and it answers it from the AST, never from
# the text and never by importing anything.
#
# Why parsing and not grep (C71 AC4, WP78 AC2): a text search for `subprocess`, `Popen`,
# `os.system`, `os.spawn*` is defeated by a rename, an alias, `importlib.import_module(
# "subprocess")` or `getattr(os, "system")`. Every one of those is a node here.
#
# Why parsing and not importing: importing the module under test would execute its
# module-level code, and the pre-repair copy this oracle also runs against is precisely the
# version in which starting a process takes no argument. `ast.parse` cannot run anything and
# cannot be defeated by a `getattr` at runtime.
#
# THE POSITIVE CONTROL IS PART OF THE ORACLE, not of the tests that use it. Every report
# carries `found_*` fields and `assert_found(...)` raises unless the walk actually located
# the symbols an absence assertion is about to reason over — because "no bare call to X"
# passes trivially when X was renamed, when the module path was wrong, when the parse
# returned an empty tree, or when a stale `__pycache__` artefact was visited instead of the
# source. An absence assertion that runs after a lookup returning nothing is not evidence.
#
# DATA SAFETY: reads `.py` source of this repository and of temp copies of it. No vault, no
# `data.json`, no credential, no network, no process, no build.

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

#: The one public, opt-in, spawning runner WP78 exports.
OPT_IN_RUNNER = "spawning_subprocess_runner"
#: The private name it replaced. It must not survive anywhere, as an alias or otherwise.
SUPERSEDED_RUNNER = "_default_runner"
BUILD_FN = "build_e2e_bundle"
INSTALL_MODULE = "install.py"

#: `os` members that start or replace a process. `os.fork`/`posix_spawn` are included for
#: completeness even though neither exists on this host's platform in any form this package
#: could use — an oracle that only looks for what it expects to find is the same mistake as
#: an absence assertion with no control.
OS_SPAWN_ATTRS = frozenset(
    {
        "system",
        "popen",
        "fork",
        "forkpty",
        "posix_spawn",
        "posix_spawnp",
        "startfile",
        *(f"spawn{s}" for s in ("l", "le", "lp", "lpe", "v", "ve", "vp", "vpe")),
        *(f"exec{s}" for s in ("l", "le", "lp", "lpe", "v", "ve", "vp", "vpe")),
    }
)
#: Attribute names on `subprocess` that a `getattr` could reach.
SUBPROCESS_CALLABLES = frozenset(
    {"run", "Popen", "call", "check_call", "check_output", "getoutput", "getstatusoutput"}
)

SKIP_DIRS = frozenset({"node_modules", "__pycache__", ".git", ".venv", "dist", "build"})


@dataclass(frozen=True)
class SpawnNode:
    module: str
    function: str
    line: int
    spelling: str
    kind: str

    def __str__(self) -> str:  # pragma: no cover - diagnostics only
        return f"{self.module}:{self.line} in {self.function}() -> {self.spelling} [{self.kind}]"


@dataclass(frozen=True)
class Site:
    module: str
    function: str
    line: int
    source: str


@dataclass(frozen=True)
class ParamInfo:
    name: str
    kind: str  # "positional-or-keyword" | "keyword-only" | "positional-only"
    has_default: bool
    default_source: Optional[str]
    annotation: Optional[str]


@dataclass(frozen=True)
class CallSite:
    path: str
    line: int
    positional: int
    keywords: Tuple[str, ...]
    star_args: bool
    double_star: bool
    #: True when the call is lexically inside `with pytest.raises(TypeError):`. A bare call
    #: written to ASSERT that a bare call is refused is the one admissible bare call, and it
    #: is recognised structurally rather than by an allowlist of file names — an allowlist
    #: would also cover a real bare call that happened to live in the same file.
    inside_raises_typeerror: bool = False

    @property
    def supplies_runner(self) -> bool:
        # `**kwargs` is deliberately NOT accepted as supplying `runner`: it makes the
        # argument list undecidable from the AST, which is the property this oracle is
        # asserting. A spread call site is reported, never silently counted as compliant.
        return "runner" in self.keywords


@dataclass
class PackageReport:
    package_dir: Path
    modules: Tuple[str, ...] = ()
    source_bytes: int = 0
    spawn_nodes: Tuple[SpawnNode, ...] = ()
    functions: Dict[str, Tuple[str, int]] = field(default_factory=dict)
    exported: Dict[str, Tuple[str, ...]] = field(default_factory=dict)
    module_level_bindings: Dict[str, List[Site]] = field(default_factory=dict)
    _trees: Dict[str, ast.Module] = field(default_factory=dict, repr=False)
    _enclosing: Dict[str, Dict[int, str]] = field(default_factory=dict, repr=False)

    # ---- positive controls -------------------------------------------------------
    def found_function(self, name: str, module: str = INSTALL_MODULE) -> bool:
        return f"{module}:{name}" in self.functions

    def assert_found(self, *, functions: Sequence[str] = (), min_spawn_nodes: int = 1) -> None:
        """Positive control. Raise unless the walk located what is about to be asserted.

        Called at the TOP of every test that asserts an absence, in that same test.
        """
        assert self.modules, (
            f"POSITIVE CONTROL FAILED: no module was parsed under {self.package_dir}. "
            "Every absence assertion below would pass vacuously."
        )
        assert self.source_bytes > 0, "POSITIVE CONTROL FAILED: zero bytes of source parsed"
        for qualified in functions:
            module, _, name = qualified.rpartition(":")
            module = module or INSTALL_MODULE
            assert self.found_function(name, module), (
                f"POSITIVE CONTROL FAILED: {name!r} was not found in {module} under "
                f"{self.package_dir}. It was renamed, moved, or the wrong tree was parsed — "
                "so an absence assertion about it would pass on an empty lookup."
            )
        assert len(self.spawn_nodes) >= min_spawn_nodes, (
            f"POSITIVE CONTROL FAILED: the walk found {len(self.spawn_nodes)} spawn "
            f"primitive(s), expected at least {min_spawn_nodes}. The oracle cannot see the "
            "thing it is about to attribute, so attributing it proves nothing."
        )

    # ---- queries -----------------------------------------------------------------
    def name_references(self, name: str) -> Tuple[Site, ...]:
        """Every `Name`/`Attribute` reference to ``name``, excluding its own definition."""
        out: List[Site] = []
        for module, tree in self._trees.items():
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
                    continue  # the definition itself is not a reference
                hit = (
                    (isinstance(node, ast.Name) and node.id == name)
                    or (isinstance(node, ast.Attribute) and node.attr == name)
                )
                if hit:
                    out.append(self._site(module, node))
        return tuple(out)

    def param_defaults_naming(self, name: str) -> Tuple[Site, ...]:
        """Every parameter anywhere in the package whose default names ``name``."""
        out: List[Site] = []
        for module, tree in self._trees.items():
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                defaults = list(node.args.defaults) + [d for d in node.args.kw_defaults if d]
                for default in defaults:
                    if name in _names_in(default):
                        out.append(self._site(module, default))
        return tuple(out)

    def substitutions_naming(self, name: str) -> Tuple[Site, ...]:
        """`x or NAME`, `NAME if … else`, `… is None` comparisons naming ``name``."""
        out: List[Site] = []
        for module, tree in self._trees.items():
            for node in ast.walk(tree):
                if isinstance(node, (ast.BoolOp, ast.IfExp)) and name in _names_in(node):
                    out.append(self._site(module, node))
        return tuple(out)

    def parameters(self, func: str, module: str = INSTALL_MODULE) -> Tuple[ParamInfo, ...]:
        node = self._function_node(func, module)
        if node is None:
            return ()
        args = node.args
        out: List[ParamInfo] = []
        pos = list(args.posonlyargs) + list(args.args)
        pos_defaults: List[Optional[ast.expr]] = [None] * (len(pos) - len(args.defaults))
        pos_defaults += list(args.defaults)
        for index, arg in enumerate(pos):
            kind = "positional-only" if index < len(args.posonlyargs) else "positional-or-keyword"
            default = pos_defaults[index]
            out.append(
                ParamInfo(
                    arg.arg,
                    kind,
                    default is not None,
                    ast.unparse(default) if default is not None else None,
                    ast.unparse(arg.annotation) if arg.annotation else None,
                )
            )
        for arg, default in zip(args.kwonlyargs, args.kw_defaults):
            out.append(
                ParamInfo(
                    arg.arg,
                    "keyword-only",
                    default is not None,
                    ast.unparse(default) if default is not None else None,
                    ast.unparse(arg.annotation) if arg.annotation else None,
                )
            )
        return tuple(out)

    def parameter(self, func: str, param: str, module: str = INSTALL_MODULE) -> Optional[ParamInfo]:
        for info in self.parameters(func, module):
            if info.name == param:
                return info
        return None

    def body_usage(self, func: str, param: str, module: str = INSTALL_MODULE) -> Dict[str, List[Site]]:
        """Classify every use of ``param`` inside ``func``'s body.

        Keys: ``call-target`` (the only admissible one for WP78's ``runner``),
        ``boolop`` (``runner or X``), ``ifexp`` (``X if runner is None else runner``),
        ``compare`` (``runner is None``), ``rebound`` (``runner = …``), ``other``.
        """
        found: Dict[str, List[Site]] = {
            k: [] for k in ("call-target", "boolop", "ifexp", "compare", "rebound", "other")
        }
        node = self._function_node(func, module)
        if node is None:
            return found
        call_targets = set()
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name) and sub.func.id == param:
                call_targets.add(id(sub.func))
                found["call-target"].append(self._site(module, sub))
            if isinstance(sub, (ast.BoolOp,)) and param in _names_in(sub):
                found["boolop"].append(self._site(module, sub))
            if isinstance(sub, ast.IfExp) and param in _names_in(sub):
                found["ifexp"].append(self._site(module, sub))
            if isinstance(sub, ast.Compare) and param in _names_in(sub):
                found["compare"].append(self._site(module, sub))
            if isinstance(sub, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                targets = sub.targets if isinstance(sub, ast.Assign) else [sub.target]
                if any(isinstance(t, ast.Name) and t.id == param for t in targets):
                    found["rebound"].append(self._site(module, sub))
        for sub in ast.walk(node):
            if isinstance(sub, ast.Name) and sub.id == param and id(sub) not in call_targets:
                if isinstance(sub.ctx, ast.Load):
                    found["other"].append(self._site(module, sub))
        return found

    def calls_named(self, name: str) -> Tuple[Site, ...]:
        """Every call in the package whose callee spells ``name`` (e.g. ``partial``)."""
        out: List[Site] = []
        for module, tree in self._trees.items():
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                callee = node.func
                spelled = callee.attr if isinstance(callee, ast.Attribute) else getattr(callee, "id", None)
                if spelled == name:
                    out.append(self._site(module, node))
        return tuple(out)

    # ---- internals ---------------------------------------------------------------
    def _function_node(self, func: str, module: str):
        tree = self._trees.get(module)
        if tree is None:
            return None
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func:
                return node
        return None

    def _site(self, module: str, node: ast.AST) -> Site:
        line = getattr(node, "lineno", 0)
        try:
            source = ast.unparse(node)
        except Exception:  # pragma: no cover - unparseable node kinds
            source = type(node).__name__
        if len(source) > 160:
            source = source[:157] + "..."
        return Site(module, self._enclosing.get(module, {}).get(line, "<module>"), line, source)


def _names_in(node: ast.AST) -> set:
    out = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name):
            out.add(sub.id)
        elif isinstance(sub, ast.Attribute):
            out.add(sub.attr)
    return out


def _enclosing_map(tree: ast.Module) -> Dict[int, str]:
    """line number -> enclosing function name (innermost), `<module>` where there is none."""
    mapping: Dict[int, str] = {}

    def visit(node: ast.AST, current: str) -> None:
        for child in ast.iter_child_nodes(node):
            name = current
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = child.name
            start = getattr(child, "lineno", None)
            end = getattr(child, "end_lineno", start)
            if start is not None:
                for line in range(start, (end or start) + 1):
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        mapping[line] = child.name
                    else:
                        mapping.setdefault(line, current)
            visit(child, name)

    visit(tree, "<module>")
    return mapping


def _spawn_nodes(module: str, tree: ast.Module, enclosing: Dict[int, str]) -> List[SpawnNode]:
    out: List[SpawnNode] = []
    consumed: set = set()

    def where(node: ast.AST) -> str:
        return enclosing.get(getattr(node, "lineno", 0), "<module>")

    def add(node: ast.AST, spelling: str, kind: str) -> None:
        out.append(SpawnNode(module, where(node), getattr(node, "lineno", 0), spelling, kind))

    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            base = node.value.id
            if base == "subprocess":
                consumed.add(id(node.value))
                add(node, f"subprocess.{node.attr}", "attribute")
            elif base == "os" and node.attr in OS_SPAWN_ATTRS:
                add(node, f"os.{node.attr}", "attribute")

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] == "subprocess":
                    add(node, f"import {alias.name}", "import")
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] == "subprocess":
                add(node, f"from {node.module} import ...", "import")
        elif isinstance(node, ast.Name):
            if id(node) in consumed:
                continue
            if node.id == "subprocess":
                add(node, "subprocess (bare name)", "alias")
            elif node.id == "Popen" or node.id.endswith("Popen"):
                add(node, node.id, "popen")
        elif isinstance(node, ast.Call):
            callee = node.func
            spelled = callee.attr if isinstance(callee, ast.Attribute) else getattr(callee, "id", None)
            if spelled in {"import_module", "__import__"} and node.args:
                first = node.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    if first.value.split(".")[0] in {"subprocess", "os"}:
                        add(node, f"{spelled}({first.value!r})", "dynamic-import")
            elif spelled == "getattr" and len(node.args) >= 2:
                second = node.args[1]
                if isinstance(second, ast.Constant) and isinstance(second.value, str):
                    if second.value in OS_SPAWN_ATTRS or second.value in SUBPROCESS_CALLABLES:
                        add(node, f"getattr(..., {second.value!r})", "dynamic-attr")
    return out


def scan_package(package_dir) -> PackageReport:
    """Parse every ``.py`` module in ``package_dir`` and report. Nothing is imported."""
    package_dir = Path(package_dir)
    report = PackageReport(package_dir=package_dir)
    modules: List[str] = []
    spawn: List[SpawnNode] = []
    for path in sorted(package_dir.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        name = path.name
        modules.append(name)
        report.source_bytes += len(source)
        report._trees[name] = tree
        enclosing = _enclosing_map(tree)
        report._enclosing[name] = enclosing
        spawn.extend(_spawn_nodes(name, tree, enclosing))
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                report.functions[f"{name}:{node.name}"] = (name, node.lineno)
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        if target.id == "__all__" and isinstance(node.value, (ast.List, ast.Tuple)):
                            report.exported[name] = tuple(
                                e.value for e in node.value.elts
                                if isinstance(e, ast.Constant) and isinstance(e.value, str)
                            )
                        report.module_level_bindings.setdefault(target.id, []).append(
                            Site(name, "<module>", node.lineno, ast.unparse(node.value))
                        )
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                report.module_level_bindings.setdefault(node.target.id, []).append(
                    Site(name, "<module>", node.lineno,
                         ast.unparse(node.value) if node.value else "<no value>")
                )
    report.modules = tuple(modules)
    report.spawn_nodes = tuple(spawn)
    return report


def module_bindings_matching(report: PackageReport, pattern: str) -> Dict[str, List[Site]]:
    rx = re.compile(pattern, re.IGNORECASE)
    return {k: v for k, v in report.module_level_bindings.items() if rx.search(k)}


def _raises_typeerror_ranges(tree: ast.Module) -> List[Tuple[int, int]]:
    """Line ranges of every ``with pytest.raises(TypeError):`` block in ``tree``."""
    ranges: List[Tuple[int, int]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.With, ast.AsyncWith)):
            continue
        for item in node.items:
            call = item.context_expr
            if not isinstance(call, ast.Call):
                continue
            callee = call.func
            spelled = callee.attr if isinstance(callee, ast.Attribute) else getattr(callee, "id", None)
            if spelled != "raises" or not call.args:
                continue
            first = call.args[0]
            if isinstance(first, ast.Name) and first.id == "TypeError":
                ranges.append((node.lineno, node.end_lineno or node.lineno))
    return ranges


def scan_call_sites(root, func_name: str = BUILD_FN) -> Tuple[CallSite, ...]:
    """Every call to ``func_name`` in the repository, from the AST of every ``.py`` file."""
    root = Path(root)
    out: List[CallSite] = []
    for path in sorted(root.rglob("*.py")):
        if SKIP_DIRS & set(path.parts):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (SyntaxError, UnicodeDecodeError):  # pragma: no cover
            continue
        guarded = _raises_typeerror_ranges(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            callee = node.func
            spelled = callee.attr if isinstance(callee, ast.Attribute) else getattr(callee, "id", None)
            if spelled != func_name:
                continue
            out.append(
                CallSite(
                    path=path.relative_to(root).as_posix(),
                    line=node.lineno,
                    positional=len([a for a in node.args if not isinstance(a, ast.Starred)]),
                    keywords=tuple(k.arg for k in node.keywords if k.arg is not None),
                    star_args=any(isinstance(a, ast.Starred) for a in node.args),
                    double_star=any(k.arg is None for k in node.keywords),
                    inside_raises_typeerror=any(
                        start <= node.lineno <= end for start, end in guarded
                    ),
                )
            )
    return tuple(out)
