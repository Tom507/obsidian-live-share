// ---------------------------------------------------------------------------
// LIVENESS-HANG DERIVER  (v1)
//
// The complementary derivation to `derive_representation_blindness.mjs`, and
// the one that sweep could not reach (its §6.5).
//
//   that sweep          sink = a COMPARISON   question = can the operands differ?
//   THIS one            sink = a WAIT         question = can the awaited
//                                             predicate ever be SET?
//
// A check that cannot fire at least returns an answer somebody can look at.
// A wait whose precondition can never be produced returns NOTHING — and in a
// batch under time pressure that reads as "slow", or gets killed and re-run.
//
// The confirmed member of the class:
//
//   `link.break{shape:"silence"}` cannot drive a link to its retry ceiling. A
//   reconnect's `onopen` is UNGATED by `silenced`, so every retry succeeds and
//   resets the chain — the link oscillates forever, and a criterion waiting on
//   `retryChainEnded` HANGS rather than failing. (WP88 AC4 as written was
//   therefore unsatisfiable.)
//
// WHAT THE TOOL DOES
// ------------------
//  A  derive the awaited-predicate atoms and the SUPPRESSION FLAGS, three ways
//     that must agree; refuse to emit a census at all if that comes back empty
//     (WP86's deriver returned EMPTY and both of its "every site is pinned"
//     assertions passed on it — exit 3 makes that impossible rather than
//     merely unlikely)
//  B  enumerate every WAIT in the TypeScript tree, and shell out to
//     `derive_liveness_hangs_py.py` for every Python surface of the rig
//  C  for every atom, enumerate its PRODUCERS and its DESTROYERS, with the
//     lexical guard set of each write
//  D  the defect rule: a destroyer that runs inside an event handler which
//     does NOT consult the suppression flag, while a SIBLING handler in the
//     same class does — i.e. the awaited predicate is destroyed under exactly
//     the precondition the waiter established
//
// Every run prints KNOWN_HANG, the positive control, and exits non-zero if it
// does not find it. Run the tool against a tree where the known member is
// present before believing any census it gives you.
//
// usage: node derive_liveness_hangs.mjs [<plugin dir>] [<out.json>]
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.argv[2] ?? path.resolve(HERE, "../../../plugin");
const OUT = process.argv[3] ?? path.join(HERE, "liveness-census.json");
const REPO = path.resolve(PROJECT, "..");

const ts = createRequire(path.join(PROJECT, "package.json"))("typescript");

const cfgFile = ts.readConfigFile(path.join(PROJECT, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, PROJECT);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const SRC = path.join(PROJECT, "src").replace(/\\/g, "/");
const ownFiles = program.getSourceFiles().filter((sf) => {
  const f = sf.fileName.replace(/\\/g, "/");
  return f.startsWith(SRC) && !f.endsWith(".d.ts");
});
const rel = (sf) => path.relative(SRC, sf.fileName.replace(/\\/g, "/")).replace(/\\/g, "/");
const lineOf = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const txt = (sf, n, k = 120) => n.getText(sf).replace(/\s+/g, " ").slice(0, k);

// ===========================================================================
// STAGE A1 — the sleep vocabulary, derived from the tree
//
// A "sleep" is any function whose body is nothing but a promise resolved by a
// timer. Derived by shape: a helper called `pause`, `delay`, `tick` or `wait`
// is found because of what it does, never because of what it is called.
// ===========================================================================
const sleepSymbols = new Set();
const stageAEvidence = [];
const sym = (n) => {
  try {
    return checkerSafe(() => checker.getSymbolAtLocation(n));
  } catch {
    return undefined;
  }
};
const checker = program.getTypeChecker();
function checkerSafe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
function declSym(n) {
  let s = sym(n);
  if (s && s.flags & ts.SymbolFlags.Alias) {
    const a = checkerSafe(() => checker.getAliasedSymbol(s));
    if (a) s = a;
  }
  return s;
}

/** `new Promise(r => setTimeout(r, ms))` — the timer-resolved promise. */
function isTimerPromise(node) {
  if (!ts.isNewExpression(node)) return false;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "Promise") return false;
  const exec = node.arguments?.[0];
  if (!exec || !(ts.isArrowFunction(exec) || ts.isFunctionExpression(exec))) return false;
  // A SLEEP is an executor that does NOTHING BUT arm a timer. An executor that
  // arms a timer *and* registers a listener is a bounded wait on an event, not
  // a sleep — collapsing the two would have hidden `waitForSync` from this
  // census entirely, which is exactly the kind of silent exclusion the class is
  // about.
  let body = exec.body;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1) return false;
    const st = body.statements[0];
    if (!ts.isExpressionStatement(st)) return false;
    body = st.expression;
  }
  return ts.isCallExpression(body) && isTimerCall(body);
}

/** `setTimeout(...)`, `globalThis.setTimeout(...)`, `window.setTimeout(...)`. */
function isTimerCall(n) {
  if (!ts.isCallExpression(n)) return false;
  const c = n.expression;
  if (ts.isIdentifier(c)) return /^(setTimeout|setImmediate)$/.test(c.text);
  if (ts.isPropertyAccessExpression(c)) return /^(setTimeout|setImmediate)$/.test(c.name.text);
  return false;
}

for (const sf of ownFiles) {
  const visit = (node) => {
    // `const sleep = (ms) => new Promise(r => setTimeout(r, ms))`
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      const body = ts.isArrowFunction(init) || ts.isFunctionExpression(init) ? init.body : null;
      if (body && !ts.isBlock(body) && isTimerPromise(body)) {
        const s = sym(node.name);
        if (s && !sleepSymbols.has(s)) {
          sleepSymbols.add(s);
          stageAEvidence.push(`A1 ${rel(sf)}:${lineOf(sf, node)} sleep helper \`${node.name.text}\``);
        }
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body) {
      const stmts = node.body.statements;
      if (stmts.length === 1 && ts.isReturnStatement(stmts[0]) && stmts[0].expression) {
        if (isTimerPromise(stmts[0].expression)) {
          const s = sym(node.name);
          if (s && !sleepSymbols.has(s)) {
            sleepSymbols.add(s);
            stageAEvidence.push(
              `A1 ${rel(sf)}:${lineOf(sf, node)} sleep helper \`${node.name.getText(sf)}\``,
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ===========================================================================
// STAGE A2 — THE SUPPRESSION FLAGS
//
// A suppression flag is a boolean field that some seam turns ON to make a
// component stop participating, and that the component's own paths consult
// before doing anything. Derived, per class, as a field that is
//   (i)  assigned `true` somewhere, and
//   (ii) read as a BARE EARLY-RETURN GUARD (`if (this.F) return;`) in >= 2
//        distinct functions of that class.
//
// The >= 2 is what makes it a flag rather than a local boolean: one guard is a
// condition, several guards spread through a class are a policy — and a policy
// with a hole in it is this sweep's subject.
// ===========================================================================
const classFlags = new Map(); // className -> Set<flagName>
function enclosingClass(n) {
  let p = n.parent;
  while (p) {
    if (ts.isClassDeclaration(p) || ts.isClassExpression(p)) return p;
    p = p.parent;
  }
}
function enclosingFn(n) {
  let p = n.parent;
  while (p) {
    if (
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isArrowFunction(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isConstructorDeclaration(p)
    )
      return p;
    p = p.parent;
  }
}
const fnName = (f, sf) =>
  f && f.name ? f.name.getText(sf) : f ? `<anon@${lineOf(sf, f)}>` : "<module>";

for (const sf of ownFiles) {
  const guardCount = new Map(); // "Class.flag" -> Set<fn ids>
  const assignedTrue = new Set(); // "Class.flag"
  const visit = (node) => {
    // `this.F = true`
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.right.kind === ts.SyntaxKind.TrueKeyword
    ) {
      const cls = enclosingClass(node);
      if (cls?.name) assignedTrue.add(`${cls.name.text}.${node.left.name.text}`);
    }
    // `if (this.F) return;`
    if (
      ts.isIfStatement(node) &&
      !node.elseStatement &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const body = node.thenStatement;
      const isBareReturn =
        (ts.isReturnStatement(body) && !body.expression) ||
        (ts.isBlock(body) &&
          body.statements.length === 1 &&
          ts.isReturnStatement(body.statements[0]) &&
          !body.statements[0].expression);
      if (isBareReturn) {
        const cls = enclosingClass(node);
        if (cls?.name) {
          const key = `${cls.name.text}.${node.expression.name.text}`;
          const f = enclosingFn(node);
          if (!guardCount.has(key)) guardCount.set(key, new Set());
          guardCount.get(key).add(f ? f.pos : -1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const [key, fns] of guardCount) {
    if (fns.size < 2 || !assignedTrue.has(key)) continue;
    const [cls, flag] = key.split(".");
    if (!classFlags.has(cls)) classFlags.set(cls, new Set());
    if (!classFlags.get(cls).has(flag)) {
      classFlags.get(cls).add(flag);
      stageAEvidence.push(`A2 ${rel(sf)}: ${cls}.${flag} — suppression flag, ${fns.size} bare guards`);
    }
  }
}

// ===========================================================================
// STAGE A3 — the awaited-predicate atoms of the Python rig
// (run first, because Stage A's self-check consumes its evidence)
// ===========================================================================
const PY_ROOTS = [
  path.join(REPO, "tools/obsidian_e2e"),
  "H:/My Code/AgenticWorkspace/tools/MCPserver/liveshare_e2e_mcp_server.py",
];
for (const dir of ["H:/tmp", "/h/tmp"]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir))
    if (/^liveshare_.*\.py$/.test(f)) PY_ROOTS.push(path.join(dir, f).replace(/\\/g, "/"));
  break;
}
let pyCensus = { files: 0, rows: [] };
{
  const probe = path.join(HERE, "derive_liveness_hangs_py.py");
  const r = spawnSync("python", [probe, ...PY_ROOTS.filter((p) => fs.existsSync(p))], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout) {
    pyCensus = JSON.parse(r.stdout);
    stageAEvidence.push(
      `A3 python probe: ${pyCensus.files} file(s), ${pyCensus.rows.length} wait row(s)`,
    );
  } else {
    console.error(`PYTHON PROBE FAILED (status ${r.status}): ${(r.stderr || "").slice(0, 400)}`);
  }
}

// STAGE A SELF-CHECK — the same guard the representation deriver carries, for
// the same reason: a derivation that can return nothing satisfies "there are
// no hanging waits" perfectly.
if (sleepSymbols.size === 0 || classFlags.size === 0 || stageAEvidence.length < 3) {
  console.error(
    `STAGE A SELF-CHECK FAILED: ${sleepSymbols.size} sleep helper(s), ` +
      `${classFlags.size} class(es) with a suppression flag, ` +
      `${stageAEvidence.length} evidence line(s). A census derived from nothing proves nothing.`,
  );
  process.exit(3);
}

// ===========================================================================
// STAGE B — the waits in the TypeScript tree
// ===========================================================================
const tsWaits = [];
const waiterFns = new Set(); // symbols of functions that contain a wait

function isSleepAwait(node) {
  if (!ts.isAwaitExpression(node)) return false;
  const e = node.expression;
  if (isTimerPromise(e)) return true;
  if (ts.isCallExpression(e)) {
    const c = e.expression;
    const s = ts.isIdentifier(c) ? declSym(c) : ts.isPropertyAccessExpression(c) ? declSym(c.name) : undefined;
    if (s && sleepSymbols.has(s)) return true;
  }
  return false;
}

/** the identifiers / property names / string keys a condition reads */
function atomsOf(node, sf) {
  const out = [];
  const walk = (n) => {
    if (ts.isPropertyAccessExpression(n)) out.push(n.name.text);
    else if (ts.isElementAccessExpression(n) && n.argumentExpression && ts.isStringLiteral(n.argumentExpression))
      out.push(n.argumentExpression.text);
    else if (ts.isIdentifier(n)) out.push(n.text);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return [...new Set(out)];
}

/** loop condition + every `if (…) return|break` inside the loop */
function exitConditions(loop) {
  const conds = [];
  if (loop.expression) conds.push(loop.expression);
  if (loop.condition) conds.push(loop.condition);
  const walk = (n) => {
    if (ts.isIfStatement(n)) {
      let ends = false;
      const scan = (m) => {
        if (ts.isReturnStatement(m) || ts.isBreakStatement(m) || ts.isThrowStatement(m)) ends = true;
        if (!ts.isFunctionExpression(m) && !ts.isArrowFunction(m)) ts.forEachChild(m, scan);
      };
      scan(n.thenStatement);
      if (ends) conds.push(n.expression);
    }
    ts.forEachChild(n, walk);
  };
  walk(loop.statement ?? loop);
  return conds;
}

function loopBound(loop, sf) {
  const conds = exitConditions(loop);
  for (const c of conds) {
    const s = c.getText(sf);
    if (/Date\.now\(\)|performance\.now\(\)|deadline|budget|expire|timeout|elapsed/i.test(s))
      return "bounded-deadline";
  }
  // `for (let i = 0; i < N; i++)` with a literal / const ceiling
  if (ts.isForStatement(loop) && loop.condition) return "bounded-count";
  for (const c of conds) {
    const s = c.getText(sf);
    if (/attempt|tries|retries|max|count|\bi\b\s*[<>]/i.test(s)) return "bounded-count";
  }
  return "UNBOUNDED";
}

for (const sf of ownFiles) {
  const visit = (node) => {
    if (ts.isWhileStatement(node) || ts.isForStatement(node) || ts.isDoStatement(node)) {
      let sleeps = 0;
      const scan = (n) => {
        if (isSleepAwait(n)) sleeps++;
        if (!ts.isFunctionDeclaration(n) && !ts.isMethodDeclaration(n)) ts.forEachChild(n, scan);
      };
      scan(node.statement);
      if (sleeps > 0) {
        const conds = exitConditions(node);
        const atoms = [...new Set(conds.flatMap((c) => atomsOf(c, sf)))];
        const f = enclosingFn(node);
        if (f?.name) {
          const s = sym(f.name);
          if (s) waiterFns.add(s);
        }
        tsWaits.push({
          file: rel(sf),
          line: lineOf(sf, node),
          kind: "WHILE-POLL",
          fn: fnName(f, sf),
          src: txt(sf, conds[0] ?? node, 100),
          bound: loopBound(node, sf),
          atoms,
        });
      }
    }
    // a promise resolved by something OTHER than a timer in its own executor:
    // the resolve escapes into a handler, a field or a registry, so nothing in
    // the executor bounds it.
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Promise") {
      const exec = node.arguments?.[0];
      if (exec && (ts.isArrowFunction(exec) || ts.isFunctionExpression(exec)) && exec.parameters.length) {
        const resolveName = ts.isIdentifier(exec.parameters[0].name) ? exec.parameters[0].name.text : null;
        const settlers = exec.parameters
          .map((p) => (ts.isIdentifier(p.name) ? p.name.text : null))
          .filter(Boolean);
        if (resolveName && !isTimerPromise(node)) {
          // Three different things, and only the AST separates them:
          //   calledSync   the executor settles the promise itself -> not a wait
          //   calledNested the promise is settled by a CALLBACK    -> a wait
          //   escapes      the settler is handed to something else -> a wait
          let calledSync = false;
          let calledNested = false;
          let escapes = false;
          let timerSettles = false;
          const walk = (n, depth) => {
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && settlers.includes(n.expression.text)) {
              if (depth === 0) calledSync = true;
              else calledNested = true;
              // a settler reached from inside a setTimeout bounds the wait
              let p = n.parent;
              while (p && p !== exec) {
                if (isTimerCall(p)) timerSettles = true;
                p = p.parent;
              }
            } else if (ts.isIdentifier(n) && n.text === resolveName && !ts.isCallExpression(n.parent)) {
              escapes = true;
            }
            const nested = ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);
            ts.forEachChild(n, (c) => walk(c, depth + (nested ? 1 : 0)));
          };
          walk(exec.body, 0);
          if (escapes || calledNested || !calledSync) {
            const f = enclosingFn(node);
            if (f?.name) {
              const s = sym(f.name);
              if (s) waiterFns.add(s);
            }
            tsWaits.push({
              file: rel(sf),
              line: lineOf(sf, node),
              kind: "EVENT-PROMISE",
              fn: fnName(f, sf),
              src: txt(sf, node, 100),
              bound: timerSettles ? "bounded-deadline" : "UNBOUNDED",
              atoms: [],
              settledBy: escapes ? "escaped settler" : "callback",
            });
          }
        }
      }
    }
    // a bare sleep standing in for a wait — it always completes, which is
    // exactly why it certifies nothing about the state it stood in for
    if (isSleepAwait(node)) {
      let inLoop = false;
      let p = node.parent;
      while (p) {
        if (ts.isWhileStatement(p) || ts.isForStatement(p) || ts.isDoStatement(p)) inLoop = true;
        if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) break;
        p = p.parent;
      }
      if (!inLoop) {
        const f = enclosingFn(node);
        tsWaits.push({
          file: rel(sf),
          line: lineOf(sf, node),
          kind: "SLEEP-ORACLE",
          fn: fnName(f, sf),
          src: txt(sf, node, 100),
          bound: "bounded-deadline",
          atoms: [],
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ===========================================================================
// STAGE C — producers and destroyers, with the guard set of every write
// ===========================================================================
const awaitedAtoms = new Set();
for (const w of tsWaits) for (const a of w.atoms) awaitedAtoms.add(a);
for (const r of pyCensus.rows) {
  for (const a of r.atoms ?? []) awaitedAtoms.add(a);
  for (const cs of r.callSites ?? []) for (const a of cs.atoms ?? []) awaitedAtoms.add(a);
}

const DESTROY = new Set([
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);
function writeValue(node, sf) {
  const r = node.right;
  if (DESTROY.has(r.kind)) return { v: r.getText(sf), destroys: true };
  if (ts.isNumericLiteral(r)) return { v: r.text, destroys: Number(r.text) === 0 };
  if (r.kind === ts.SyntaxKind.TrueKeyword) return { v: "true", destroys: false };
  if (ts.isIdentifier(r) && r.text === "undefined") return { v: "undefined", destroys: true };
  return { v: txt(sf, r, 40), destroys: false };
}

/** the flag names lexically guarding a node inside its enclosing function */
function lexicalGuards(node, sf, flags) {
  const hit = new Set();
  let p = node.parent;
  const stop = enclosingFn(node);
  while (p && p !== stop?.parent) {
    if (ts.isIfStatement(p) || ts.isConditionalExpression(p)) {
      const cond = p.expression ?? p.condition;
      for (const a of atomsOf(cond, sf)) if (flags.has(a)) hit.add(a);
    }
    p = p.parent;
  }
  // an early-return guard at the top of the same function counts too
  if (stop?.body && ts.isBlock(stop.body)) {
    for (const st of stop.body.statements) {
      if (st === node || st.pos >= node.pos) break;
      if (ts.isIfStatement(st)) for (const a of atomsOf(st.expression, sf)) if (flags.has(a)) hit.add(a);
    }
  }
  return [...hit];
}

/** `x.onopen = () => {…}` / `x.onmessage = function(){…}` */
function handlerAssignment(node) {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  if (!ts.isPropertyAccessExpression(node.left)) return null;
  if (!/^on[a-z]/.test(node.left.name.text)) return null;
  const r = node.right;
  if (!ts.isArrowFunction(r) && !ts.isFunctionExpression(r)) return null;
  return { name: node.left.name.text, body: r };
}

const writes = [];
const handlers = []; // { cls, name, file, line, consultsFlag, flags }
for (const sf of ownFiles) {
  const visit = (node) => {
    const h = handlerAssignment(node);
    if (h) {
      const cls = enclosingClass(node);
      const clsName = cls?.name?.text ?? "<none>";
      const flags = classFlags.get(clsName) ?? new Set();
      const read = new Set();
      const walk = (n) => {
        if (ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword && flags.has(n.name.text))
          read.add(n.name.text);
        ts.forEachChild(n, walk);
      };
      walk(h.body);
      handlers.push({
        cls: clsName,
        name: h.name,
        file: rel(sf),
        line: lineOf(sf, node),
        consults: [...read],
        flags: [...flags],
      });
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) || ts.isIdentifier(node.left))
    ) {
      const name = ts.isPropertyAccessExpression(node.left) ? node.left.name.text : node.left.text;
      if (awaitedAtoms.has(name)) {
        const cls = enclosingClass(node);
        const clsName = cls?.name?.text ?? "<none>";
        const flags = classFlags.get(clsName) ?? new Set();
        // which handler, if any, does this write live inside?
        let inHandler = null;
        let p = node.parent;
        while (p) {
          const hh = handlerAssignment(p);
          if (hh) {
            inHandler = hh.name;
            break;
          }
          p = p.parent;
        }
        const { v, destroys } = writeValue(node, sf);
        writes.push({
          atom: name,
          file: rel(sf),
          line: lineOf(sf, node),
          cls: clsName,
          fn: fnName(enclosingFn(node), sf),
          inHandler,
          value: v,
          role: destroys ? "DESTROYER" : "PRODUCER",
          guards: lexicalGuards(node, sf, flags),
          flags: [...flags],
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ===========================================================================
// STAGE D — the defect rule
//
// A DESTROYER inside an event handler that does not consult its class's
// suppression flag, in a class where at least one SIBLING handler does. The
// waiter's own precondition (the flag ON) therefore does not stop the state it
// is waiting for from being wound back — the wait can never complete.
// ===========================================================================
const members = [];
for (const w of writes) {
  if (w.role !== "DESTROYER" || !w.inHandler || !w.flags.length) continue;
  const gated = w.guards.some((g) => w.flags.includes(g));
  if (gated) continue;
  const siblings = handlers.filter(
    (h) => h.cls === w.cls && h.name !== w.inHandler && h.consults.length > 0,
  );
  if (!siblings.length) continue;
  members.push({
    ...w,
    siblingsGated: siblings.map((s) => `${s.name}@${s.file}:${s.line} consults ${s.consults.join(",")}`),
    waitersAwaiting: [
      ...tsWaits.filter((t) => t.atoms.includes(w.atom)).map((t) => `${t.file}:${t.line} ${t.fn}`),
      ...pyCensus.rows
        .filter((r) => (r.atoms ?? []).includes(w.atom))
        .map((r) => `${r.file}:${r.line} ${r.fn}`),
    ],
  });
}

// ===========================================================================
// STAGE D2 — a polled key that NOTHING produces, and a polled command that
// does not exist.
//
// The other half of "is the producer reachable": a rig waiter polls a JSON
// field of another component's response. If no object literal in the plugin
// ever carries that name, the field is `undefined` on every poll and the wait
// runs its whole budget out. Same for a command with no `case` in the router —
// S33 (`plugin.settings`) was exactly this shape and reached several briefs
// before anyone tried to call it.
// ===========================================================================
const producedNames = new Set();
const routerCommands = new Set();
for (const sf of ownFiles) {
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const n = node.name;
      if (ts.isIdentifier(n) || ts.isStringLiteral(n)) producedNames.add(n.text);
    }
    if ((ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) && node.name) {
      if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) producedNames.add(node.name.text);
    }
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name))
      producedNames.add(node.name.text);
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text.includes("."))
      routerCommands.add(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const noProducer = [];
for (const r of pyCensus.rows) {
  const keys = [...new Set([...(r.keyAtoms ?? []), ...(r.callSites ?? []).flatMap((c) => c.keyAtoms ?? [])])];
  const orphan = keys.filter((k) => !producedNames.has(k));
  if (orphan.length)
    noProducer.push({ file: r.file, line: r.line, fn: r.fn, bound: r.bound, keys: orphan });
}
const noCommand = [];
for (const r of pyCensus.rows) {
  if (r.kind !== "RIG-COMMAND") continue;
  if (!routerCommands.has(r.cmd)) noCommand.push({ file: r.file, line: r.line, fn: r.fn, cmd: r.cmd });
}

// ===========================================================================
// POSITIVE CONTROL — KNOWN_HANG
//
// The confirmed member of the class, by name and line. Printed on every run.
//   1. the WAITER  — the poll loop that asks for the retry ceiling
//   2. the DEFECT  — `onopen` winding the chain back, ungated by `silenced`,
//                    while a sibling handler in the same class IS gated
// A derivation that finds neither is not evidence that the class is empty.
// ===========================================================================
const KNOWN_HANG = [
  {
    what: "WAITER  wait_for_ceiling polls for retryChainEnded",
    hit: () =>
      pyCensus.rows.filter(
        (r) => r.kind === "WHILE-POLL" && (r.atoms ?? []).includes("retryChainEnded"),
      ),
    fmt: (h) => `${h.file}:${h.line}  ${h.fn}  [${h.bound}]  atoms=${(h.atoms ?? []).join(",")}`,
  },
  {
    what: "DEFECT  onopen destroys retryChainEnded, ungated by `silenced`",
    hit: () => members.filter((m) => m.atom === "retryChainEnded" && m.inHandler === "onopen"),
    fmt: (m) =>
      `${m.file}:${m.line}  ${m.cls}.${m.inHandler}  ${m.atom} = ${m.value}  flags=${m.flags.join(",")}`,
    // If the defect is GONE, that is only acceptable with positive evidence
    // that the gate now exists: "not found" and "repaired" must never be the
    // same observation. Every `onopen` that writes `retryChainEnded` must
    // consult its class's suppression flag.
    repaired: () =>
      handlers.filter((h) => h.name === "onopen" && h.consults.includes("silenced")),
    repairedFmt: (h) => `${h.file}:${h.line}  ${h.cls}.onopen now consults ${h.consults.join(",")}`,
  },
];

const out = {
  stageA: {
    sleepHelpers: sleepSymbols.size,
    suppressionFlags: Object.fromEntries([...classFlags].map(([k, v]) => [k, [...v]])),
    evidence: stageAEvidence,
  },
  awaitedAtoms: [...awaitedAtoms].sort(),
  ts: { total: tsWaits.length, rows: tsWaits },
  python: { files: pyCensus.files, total: pyCensus.rows.length, rows: pyCensus.rows },
  writes,
  handlers,
  members,
  noProducer,
  noCommand,
  routerCommands: [...routerCommands].sort(),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

const tally = (rows) =>
  rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {});
const bounds = (rows) =>
  rows.reduce((a, r) => ((a[r.bound] = (a[r.bound] ?? 0) + 1), a), {});

console.log(`Stage A: ${sleepSymbols.size} sleep helper(s), suppression flags:`);
for (const [c, f] of classFlags) console.log(`         ${c} -> ${[...f].join(", ")}`);
console.log(`         ${stageAEvidence.length} evidence lines`);
console.log(`TS waits    : ${tsWaits.length}`, tally(tsWaits), bounds(tsWaits));
console.log(`PY waits    : ${pyCensus.rows.length} over ${pyCensus.files} files`, tally(pyCensus.rows), bounds(pyCensus.rows));
console.log(`awaited atoms: ${awaitedAtoms.size}   writes to them: ${writes.length}   handlers: ${handlers.length}`);
console.log("--- POSITIVE CONTROL (KNOWN_HANG) ---");
let controlOk = true;
for (const k of KNOWN_HANG) {
  const hits = k.hit();
  if (hits.length) {
    console.log(`  FOUND  ${k.what}`);
    for (const h of hits) console.log(`         ${k.fmt(h)}`);
    continue;
  }
  const rep = k.repaired?.() ?? [];
  if (rep.length) {
    console.log(`  REPAIRED ON THIS TREE  ${k.what}`);
    for (const h of rep) console.log(`         ${k.repairedFmt(h)}`);
    console.log(`         (re-run against a pre-repair tree to see the control fire)`);
  } else {
    controlOk = false;
    console.log(`  NOT FOUND  ${k.what}`);
  }
}
console.log(`--- MEMBERS: destroyers ungated by a suppression flag (${members.length}) ---`);
for (const m of members) {
  console.log(`${m.file}:${m.line}  ${m.cls}.${m.inHandler}  ${m.atom} = ${m.value}  (flags ${m.flags.join(",")})`);
  for (const s of m.siblingsGated) console.log(`      sibling gated: ${s}`);
  for (const w of m.waitersAwaiting) console.log(`      waiter       : ${w}`);
}
console.log(`--- polled response keys NOTHING in plugin/src produces (${noProducer.length}) ---`);
for (const n of noProducer) console.log(`${n.file}:${n.line}  ${n.fn}  [${n.bound}]  ${n.keys.join(", ")}`);
console.log(`--- polled rig commands with NO case in routeCommand (${noCommand.length}) ---`);
for (const n of noCommand) console.log(`${n.file}:${n.line}  ${n.fn}  ${n.cmd}`);
console.log(`router cases: ${routerCommands.size}`);
console.log(`census written to ${OUT}`);
if (!controlOk) {
  console.error(
    "POSITIVE CONTROL FAILED: the deriver did not find the known member of the class. " +
      "An empty census from a deriver that cannot find a known defect is not a result.",
  );
  process.exit(4);
}
