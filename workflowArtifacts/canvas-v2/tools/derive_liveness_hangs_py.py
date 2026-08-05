"""
LIVENESS-HANG DERIVER — Python half.

Companion to ``derive_liveness_hangs.mjs``. That tool owns the TypeScript
tree and the adjudication; this one owns every Python surface the rig is
built from (``tools/obsidian_e2e/**``, ``H:\\tmp\\liveshare_*.py``, and the
workspace MCP driver) and emits its census on stdout as JSON.

THE CLASS
---------
Not "a check that cannot fail" — one level worse. A **wait whose awaited
predicate can never be produced**. A check that cannot fail at least returns
an answer; a wait that cannot complete returns nothing at all, and under time
pressure it reads as "slow", or gets killed and re-run.

So the sink here is a WAIT, and the question per candidate is:

    can the awaited predicate ever be set, by whom, and is that producer
    reachable from the waiter's own preconditions?

WHAT COUNTS AS A WAIT (derived by shape, never by name)
-------------------------------------------------------
``WHILE-POLL``      a loop whose body sleeps — the poll shape. Its exit
                    conditions are the awaited predicate.
``BLOCKING-CALL``   a call that blocks with no timeout argument: an HTTP read,
                    ``subprocess`` without ``timeout=``, ``Event.wait()``,
                    ``Thread.join()``, ``Queue.get()``, ``Popen.wait()``,
                    ``socket.recv``. These block FOREVER, not until a deadline.
``SLEEP-ORACLE``    a bare ``sleep(n)`` standing in for a wait — it always
                    "completes", which is exactly why it proves nothing about
                    the state it was meant to wait for. Recorded, lesser.

Names are recorded, never used to classify: ``wait_for_ceiling`` is found
because it is a loop that sleeps, not because it is called ``wait_``.

BOUNDEDNESS
-----------
Reported separately from completability, because they are different defects:

    ``bounded-deadline``  compares a clock against a deadline  -> TIMES OUT
    ``bounded-count``     a counter against a literal ceiling  -> TIMES OUT
    ``UNBOUNDED``         neither                              -> BLOCKS FOREVER

A bounded wait that can never complete wastes its whole budget and then lies
by omission; an unbounded one never returns at all.

Usage:  python derive_liveness_hangs_py.py <root> [<root> ...]
        (a root may be a directory or a single .py file)
"""

from __future__ import annotations

import ast
import json
import os
import sys
from typing import Any

# --------------------------------------------------------------------------
# Blocking calls, by the shape of the API rather than by module: every one of
# these returns only when something else happens, and every one accepts a
# `timeout` that the caller may simply not have passed.
# --------------------------------------------------------------------------
BLOCKING_ATTRS = {
    "urlopen": "urllib read",
    "get": "http/queue get",
    "post": "http post",
    "put": "http put",
    "delete": "http delete",
    "request": "http request",
    "run": "subprocess.run",
    "call": "subprocess.call",
    "check_output": "subprocess.check_output",
    "check_call": "subprocess.check_call",
    "communicate": "Popen.communicate",
    "wait": "wait()",
    "join": "join()",
    "recv": "socket.recv",
    "accept": "socket.accept",
    "acquire": "lock acquire",
    "read": "stream read",
    "readline": "stream readline",
}
# `.get`/`.read`/`.join` are overloaded to death (dict.get, str.join, ...), so a
# receiver whitelist is required or the census is noise. Derived from the
# receiver expression's own text.
QUEUE_LIKE = ("queue", "q", "event", "evt", "proc", "process", "popen", "thread",
              "sock", "socket", "conn", "lock", "sem", "requests", "session",
              "client", "stream", "pipe", "resp", "response")

SLEEP_NAMES = {"sleep"}

CLOCK_NAMES = {"time", "monotonic", "perf_counter", "process_time", "now"}


def _txt(node: ast.AST) -> str:
    try:
        return ast.unparse(node)
    except Exception:  # pragma: no cover - ast.unparse is 3.9+
        return "<?>"


def _calls(node: ast.AST):
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            yield n


def _call_name(call: ast.Call) -> tuple[str, str]:
    """-> (attribute-or-function name, receiver text)."""
    f = call.func
    if isinstance(f, ast.Attribute):
        return f.attr, _txt(f.value)
    if isinstance(f, ast.Name):
        return f.id, ""
    return "", ""


def _sleeps(node: ast.AST) -> list[ast.Call]:
    out = []
    for c in _calls(node):
        name, _ = _call_name(c)
        if name in SLEEP_NAMES:
            out.append(c)
    return out


def _mentions_clock(node: ast.AST) -> bool:
    for c in _calls(node):
        name, recv = _call_name(c)
        if name in CLOCK_NAMES and ("time" in recv or "datetime" in recv or recv == ""):
            return True
    return False


def _atoms(node: ast.AST) -> list[str]:
    """The named things a condition reads: attributes, dict keys, plain names.

    These are the awaited-predicate atoms — the handles that let a Python
    waiter be joined to the TypeScript field that must produce it.
    """
    out: list[str] = []
    for n in ast.walk(node):
        if isinstance(n, ast.Attribute):
            out.append(n.attr)
        elif isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant) and isinstance(n.slice.value, str):
            out.append(n.slice.value)
        elif isinstance(n, ast.Call):
            name, _ = _call_name(n)
            # `rep.get("result")` / `d.get("retryChainEnded")` carry their key
            for a in n.args:
                if isinstance(a, ast.Constant) and isinstance(a.value, str) and name in ("get", "setdefault"):
                    out.append(a.value)
        elif isinstance(n, ast.Name):
            out.append(n.id)
    seen, uniq = set(), []
    for a in out:
        if a not in seen:
            seen.add(a)
            uniq.append(a)
    return uniq


def _key_atoms(node: ast.AST) -> list[str]:
    """Only the atoms that name a field of ANOTHER component's response:
    ``x["retryChainEnded"]`` and ``x.get("retryChainEnded")``.

    A local variable is produced by the waiter itself and can never be the
    defect; a response key is produced by the thing being waited ON, and is
    exactly the join the class needs.
    """
    out: list[str] = []
    for n in ast.walk(node):
        if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant) and isinstance(n.slice.value, str):
            out.append(n.slice.value)
        elif isinstance(n, ast.Call):
            name, _ = _call_name(n)
            if name in ("get", "setdefault"):
                for a in n.args[:1]:
                    if isinstance(a, ast.Constant) and isinstance(a.value, str):
                        out.append(a.value)
    return sorted(set(out))


def _commands(tree: ast.AST, owner: dict[int, str], rel: str) -> list[dict[str, Any]]:
    """Every rig command NAME a script asks for, with its call site.

    Derived from the shape of the call (`cmd(...)`, `try_cmd(...)`,
    `_command(...)`) rather than from a list of known commands — a command that
    does not exist is precisely the case that must not be filtered out.
    """
    out = []
    for c in _calls(tree):
        name, _ = _call_name(c)
        if "cmd" not in name.lower() and "command" not in name.lower():
            continue
        for a in c.args:
            if isinstance(a, ast.Constant) and isinstance(a.value, str) and "." in a.value:
                out.append({"file": rel, "line": c.lineno, "cmd": a.value,
                            "fn": owner.get(id(c), "<module>")})
    return out


def _exit_conditions(loop: ast.AST) -> list[ast.AST]:
    """Every condition whose truth ENDS the loop: the loop test, plus each `if`
    inside it that can `return` or `break`."""
    conds: list[ast.AST] = []
    if isinstance(loop, ast.While):
        conds.append(loop.test)
    for n in ast.walk(loop):
        if isinstance(n, ast.If):
            for inner in ast.walk(n):
                if isinstance(inner, (ast.Return, ast.Break)):
                    conds.append(n.test)
                    break
    return conds


def _bounded(loop: ast.AST) -> str:
    """bounded-deadline | bounded-count | UNBOUNDED."""
    if isinstance(loop, ast.For):
        return "bounded-count"
    test = loop.test if isinstance(loop, ast.While) else None
    # a clock compared against anything, anywhere the loop can read it
    for cond in _exit_conditions(loop):
        if _mentions_clock(cond):
            return "bounded-deadline"
        for n in ast.walk(cond):
            if isinstance(n, ast.Name) and any(
                k in n.id.lower() for k in ("deadline", "budget", "until", "expire", "timeout")
            ):
                return "bounded-deadline"
    # `while attempts < N` / `while i < len(x)` — a counter against a ceiling,
    # provided something in the body actually advances it.
    if isinstance(test, ast.Compare) and isinstance(test.left, ast.Name):
        counter = test.left.id
        for n in ast.walk(loop):
            if isinstance(n, ast.AugAssign) and isinstance(n.target, ast.Name) and n.target.id == counter:
                return "bounded-count"
            if isinstance(n, ast.Assign):
                for t in n.targets:
                    if isinstance(t, ast.Name) and t.id == counter:
                        return "bounded-count"
    return "UNBOUNDED"


def _has_timeout(call: ast.Call) -> bool:
    """A timeout may be a keyword OR positional — `thread.join(budget)` is
    bounded and `thread.join()` is not, and only the AST can tell them apart."""
    for k in call.keywords:
        if k.arg and k.arg.startswith("timeout"):
            return True
    name, _ = _call_name(call)
    if name in ("join", "wait", "acquire", "get", "communicate") and call.args:
        return True
    return False


def _timeout_bearing_names(tree: ast.AST) -> set[str]:
    """Receivers that are already bounded, so a blocking call ON them is too.

    Two shapes, both derived rather than assumed:
      ``with urlopen(req, timeout=t) as resp:``   -> ``resp``
      ``conn = HTTPConnection(host, timeout=t)``  -> ``conn``, and every
      response object obtained from it.
    """
    bounded: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.With) or isinstance(n, ast.AsyncWith):
            for item in n.items:
                if isinstance(item.context_expr, ast.Call) and _has_timeout(item.context_expr):
                    if isinstance(item.optional_vars, ast.Name):
                        bounded.add(item.optional_vars.id)
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call) and _has_timeout(n.value):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    bounded.add(t.id)
    # one hop: `response = connection.getresponse()` inherits the connection's
    # own socket timeout, so `response.read()` is bounded by it.
    for _ in range(3):
        grew = False
        for n in ast.walk(tree):
            if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call):
                _, recv = _call_name(n.value)
                if recv in bounded:
                    for t in n.targets:
                        if isinstance(t, ast.Name) and t.id not in bounded:
                            bounded.add(t.id)
                            grew = True
        if not grew:
            break
    return bounded


def _enclosing(tree: ast.AST) -> dict[int, str]:
    """node id -> enclosing def name."""
    owner: dict[int, str] = {}

    def walk(node: ast.AST, name: str):
        for child in ast.iter_child_nodes(node):
            child_name = name
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                child_name = child.name
            owner[id(child)] = child_name
            walk(child, child_name)

    owner[id(tree)] = "<module>"
    walk(tree, "<module>")
    return owner


def scan_file(path: str, rel: str) -> list[dict[str, Any]]:
    try:
        src = open(path, "r", encoding="utf-8", errors="replace").read()
        tree = ast.parse(src)
    except SyntaxError as exc:
        return [{"file": rel, "line": exc.lineno or 0, "kind": "PARSE-ERROR",
                 "fn": "", "src": str(exc), "bound": "n/a", "atoms": []}]
    owner = _enclosing(tree)
    bounded_names = _timeout_bearing_names(tree)
    rows: list[dict[str, Any]] = []
    loop_nodes: set[int] = set()

    # def name -> parameter names, so a poll loop over a CALLER-SUPPLIED
    # predicate can be resolved instead of collapsing to the useless atom
    # `predicate`. This is the same substitution the representation-blindness
    # deriver does for `.get(field)`, applied to `wait_for(pred)`.
    params: dict[str, list[str]] = {}
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            params[n.name] = [a.arg for a in n.args.args] + [a.arg for a in n.args.kwonlyargs]

    for node in ast.walk(tree):
        if isinstance(node, (ast.While, ast.For, ast.AsyncFor)):
            sleeps = _sleeps(node)
            if not sleeps:
                continue
            for n in ast.walk(node):
                loop_nodes.add(id(n))
            atoms: list[str] = []
            keys: list[str] = []
            for cond in _exit_conditions(node):
                atoms.extend(_atoms(cond))
                keys.extend(_key_atoms(cond))
            fn = owner.get(id(node), "<module>")
            own_params = params.get(fn, [])
            deferred = [a for a in atoms if a in own_params]
            call_sites = []
            if deferred:
                for c in _calls(tree):
                    cname, _ = _call_name(c)
                    if cname != fn:
                        continue
                    resolved: list[str] = []
                    for p in deferred:
                        i = own_params.index(p)
                        arg = c.args[i] if i < len(c.args) else next(
                            (k.value for k in c.keywords if k.arg == p), None)
                    rkeys: list[str] = []
                    for p_ in deferred:
                        i = own_params.index(p_)
                        arg = c.args[i] if i < len(c.args) else next(
                            (k.value for k in c.keywords if k.arg == p_), None)
                        if arg is not None:
                            resolved.extend(_atoms(arg))
                            rkeys.extend(_key_atoms(arg))
                    call_sites.append({"line": c.lineno, "atoms": sorted(set(resolved)),
                                       "keyAtoms": sorted(set(rkeys))})
            rows.append({
                "file": rel,
                "line": node.lineno,
                "kind": "WHILE-POLL",
                "fn": fn,
                "src": _txt(node.test) if isinstance(node, ast.While) else _txt(node.target),
                "bound": _bounded(node),
                "atoms": sorted(set(atoms)),
                "keyAtoms": sorted(set(keys)),
                "deferredAtoms": deferred,
                "callSites": call_sites,
                "sleepAt": [s.lineno for s in sleeps],
            })

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name, recv = _call_name(node)
        if name not in BLOCKING_ATTRS:
            continue
        low = recv.lower()
        if name in ("get", "read", "readline", "join", "run", "call", "wait", "acquire"):
            if not any(q in low for q in QUEUE_LIKE):
                continue
        if _has_timeout(node):
            continue
        if recv in bounded_names:
            continue
        rows.append({
            "file": rel,
            "line": node.lineno,
            "kind": "BLOCKING-CALL",
            "fn": owner.get(id(node), "<module>"),
            "src": _txt(node)[:120],
            "bound": "UNBOUNDED",
            "atoms": [],
            "api": BLOCKING_ATTRS[name],
        })

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name, _ = _call_name(node)
        if name not in SLEEP_NAMES or id(node) in loop_nodes:
            continue
        rows.append({
            "file": rel,
            "line": node.lineno,
            "kind": "SLEEP-ORACLE",
            "fn": owner.get(id(node), "<module>"),
            "src": _txt(node)[:120],
            "bound": "bounded-deadline",
            "atoms": [],
        })
    for c in _commands(tree, owner, rel):
        rows.append({**c, "kind": "RIG-COMMAND", "bound": "n/a", "atoms": [], "src": c["cmd"]})
    return rows


def main(argv: list[str]) -> int:
    roots = argv[1:]
    if not roots:
        print(json.dumps({"error": "no roots"}), file=sys.stderr)
        return 2
    rows: list[dict[str, Any]] = []
    files = 0
    for root in roots:
        root = root.replace("\\", "/")
        if os.path.isfile(root) and root.endswith(".py"):
            files += 1
            rows.extend(scan_file(root, root))
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ("__pycache__", ".git", "node_modules", ".venv")]
            for fn in sorted(filenames):
                if not fn.endswith(".py"):
                    continue
                full = os.path.join(dirpath, fn).replace("\\", "/")
                files += 1
                rows.extend(scan_file(full, full))
    print(json.dumps({"files": files, "rows": rows}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
