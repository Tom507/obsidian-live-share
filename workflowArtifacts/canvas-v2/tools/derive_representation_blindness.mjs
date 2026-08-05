// ---------------------------------------------------------------------------
// REPRESENTATION-BLINDNESS DERIVER  (v4 — key-aware)
//
// A candidate is a SILENT comparison (returns a defined boolean rather than
// throwing) with at least one DOC-DERIVED operand — a value that came out of a
// Yjs shared container and may therefore hold a nested type where a primitive
// was assumed.
//
// Each candidate carries the FIELD KEYS its doc read used, so the census can
// separate:
//   WIDENED  the read key is one Stage A derived as widenable (text / label)
//   DYNAMIC  the read key is a runtime value — may be text/label
//   NARROW   the read key is a field that is not widenable today
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// usage: node derive_representation_blindness.mjs [<plugin dir>] [<out.json>]
//        default plugin dir = ../../../plugin, relative to this file
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.argv[2] ?? path.resolve(HERE, "../../../plugin");
const OUT = process.argv[3] ?? path.join(HERE, "census.json");

// `typescript` is a devDependency of the plugin, resolved from there rather
// than from this file, so the deriver has no install of its own.
const ts = createRequire(path.join(PROJECT, "package.json"))("typescript");

const cfgFile = ts.readConfigFile(path.join(PROJECT, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, PROJECT);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const SRC = path.join(PROJECT, "src").replace(/\\/g, "/");
const ownFiles = program.getSourceFiles().filter((sf) => {
  const f = sf.fileName.replace(/\\/g, "/");
  return f.startsWith(SRC) && !f.endsWith(".d.ts");
});

// ============================ STAGE A ======================================
const widenedKeys = new Set();
const stageAEvidence = [];
for (const sf of ownFiles) {
  const rel = path.relative(SRC, sf.fileName.replace(/\\/g, "/")).replace(/\\/g, "/");
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && /^V2(Node|Edge)$/.test(node.name.text)) {
      for (const m of node.members)
        if (ts.isPropertySignature(m) && m.type?.kind === ts.SyntaxKind.UnknownKeyword && ts.isIdentifier(m.name)) {
          widenedKeys.add(m.name.text); stageAEvidence.push(`A1 ${rel}: ${node.name.text}.${m.name.text}: unknown`);
        }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && /CollabText/i.test(node.name.getText()) && node.body) {
      const c = (n) => { if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "V2_FIELD") { widenedKeys.add(n.name.text); stageAEvidence.push(`A2 ${rel}: ${node.name.getText()} -> V2_FIELD.${n.name.text}`); } ts.forEachChild(n, c); };
      c(node.body);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /COLLAB_TEXT_FIELDS/.test(node.name.text) && node.initializer) {
      const c = (n) => { if (ts.isStringLiteral(n)) { widenedKeys.add(n.text); stageAEvidence.push(`A3 ${rel}: COLLAB_TEXT_FIELDS "${n.text}"`); } ts.forEachChild(n, c); };
      c(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// STAGE A SELF-CHECK. WP86's census deriver returned EMPTY and both of its
// "every site is pinned" assertions passed on it. A deriver that can return
// nothing satisfies any completeness claim perfectly, so this one refuses to
// produce a census at all when its own input set is empty.
if (widenedKeys.size === 0 || stageAEvidence.length < 2) {
  console.error(
    `STAGE A SELF-CHECK FAILED: derived ${widenedKeys.size} widenable key(s) from ` +
      `${stageAEvidence.length} evidence line(s). A census derived from nothing proves nothing.`,
  );
  process.exit(3);
}

// ============================ types ========================================
const PRIM =
  ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean |
  ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void |
  ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.ESSymbol |
  ts.TypeFlags.UniqueESSymbol | ts.TypeFlags.Never | ts.TypeFlags.EnumLiteral | ts.TypeFlags.Enum;
const partsOf = (t) => (t.isUnion() ? t.types : [t]);
function isNarrowType(t) {
  if (!t) return true;
  for (const p of partsOf(t)) {
    if (p.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
    if (p.flags & PRIM) continue;
    return false;
  }
  return true;
}
const typeOf = (n) => { try { return checker.getTypeAtLocation(n); } catch { return undefined; } };
const isNarrow = (n) => isNarrowType(typeOf(n));
const tstr = (n) => { const t = typeOf(n); try { return t ? checker.typeToString(t) : "<?>"; } catch { return "<?>"; } };
const fromYjs = (decls) => (decls ?? []).some((d) => d.getSourceFile().fileName.replace(/\\/g, "/").includes("/node_modules/yjs/"));
function isYjsMember(pa) { const s = checker.getSymbolAtLocation(pa.name); return fromYjs(s?.getDeclarations?.()); }
function isYjsContainerType(e) {
  const t = typeOf(e); if (!t) return false;
  for (const p of partsOf(t)) if (fromYjs(p.getSymbol?.()?.getDeclarations?.())) return true;
  return false;
}

// ============================ STAGE B: taint ===============================
/** symbol -> Set<keyname|"*dynamic*"> */
const tainted = new Map();
const reason = new Map();
const DYN = "*dynamic*";

function mergeTaint(s, keys, why) {
  if (!s || !keys) return false;
  const cur = tainted.get(s);
  if (!cur) { tainted.set(s, new Set(keys)); reason.set(s, why); return true; }
  let ch = false;
  for (const k of keys) if (!cur.has(k)) { cur.add(k); ch = true; }
  return ch;
}
const sym = (n) => { try { return checker.getSymbolAtLocation(n); } catch { return undefined; } };
function declSym(n) { let s = sym(n); if (s && s.flags & ts.SymbolFlags.Alias) { try { s = checker.getAliasedSymbol(s); } catch {} } return s; }

function isSanitised(e) {
  if (ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e)) return true;
  if (ts.isCallExpression(e)) {
    const c = e.expression;
    if (ts.isIdentifier(c) && ["String", "Number", "Boolean"].includes(c.text)) return true;
    if (ts.isPropertyAccessExpression(c) && ["toString", "toJSON"].includes(c.name.text)) return true;
    if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "JSON") return true;
    try { const sig = checker.getResolvedSignature(e); if (sig && isNarrowType(checker.getReturnTypeOfSignature(sig))) return true; } catch {}
  }
  return false;
}
function unwrap(e) {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e)) { e = e.expression; continue; }
    return e;
  }
}
/**
 * Classify the key argument of a `.get(K)` doc read.
 *
 * If the key is a PARAMETER of the enclosing function, the answer is
 * key-polymorphic: `@pN`. That marker is substituted with the caller's actual
 * argument at every call site, so `nodeField(doc, id, "x")` resolves to the key
 * `x` instead of collapsing to "dynamic" the way a naive analysis does.
 */
function keyOf(arg, at) {
  if (!arg) return DYN;
  const a = unwrap(arg);
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  if (ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === "V2_FIELD") return a.name.text;
  if (ts.isIdentifier(a) && at) {
    const f = enclosingFunction(at);
    if (f) {
      const s = sym(a);
      const i = f.parameters.findIndex((p) => ts.isIdentifier(p.name) && sym(p.name) === s);
      if (i >= 0) return `@p${i}`;
    }
  }
  return DYN;
}
/** doc read -> Set of keys, or null */
function docReadKeys(e) {
  if (!ts.isCallExpression(e)) return null;
  const c = e.expression;
  if (!ts.isPropertyAccessExpression(c) || c.name.text !== "get") return null;
  if (!(isYjsMember(c) || isYjsContainerType(c.expression))) return null;
  return new Set([keyOf(e.arguments[0], e)]);
}
/** Substitute `@pN` markers in a callee's key summary with the call's actual args. */
function substituteParamKeys(keys, callExpr) {
  const out = new Set();
  for (const k of keys) {
    const m = /^@p(\d+)$/.exec(k);
    if (!m) { out.add(k); continue; }
    const i = Number(m[1]);
    const arg = callExpr.arguments[i];
    out.add(arg ? keyOf(arg, callExpr) : DYN);
  }
  return out;
}

/** -> Set<key> if tainted, else null */
function taintKeys(expr) {
  const e = unwrap(expr);
  if (isSanitised(e)) return null;
  if (isNarrow(e)) return null;
  const dr = docReadKeys(e);
  if (dr) return dr;
  if (ts.isIdentifier(e)) { const s = declSym(e); return s && tainted.get(s) ? tainted.get(s) : null; }
  if (ts.isPropertyAccessExpression(e)) { const s = declSym(e.name); return s && tainted.get(s) ? tainted.get(s) : null; }
  if (ts.isElementAccessExpression(e)) { const s = declSym(e.expression); return s && tainted.get(s) ? tainted.get(s) : null; }
  if (ts.isCallExpression(e)) {
    const c = unwrap(e.expression);
    const s = ts.isIdentifier(c) ? declSym(c) : ts.isPropertyAccessExpression(c) ? declSym(c.name) : undefined;
    const k = s ? tainted.get(s) : undefined;
    return k ? substituteParamKeys(k, e) : null;
  }
  if (ts.isConditionalExpression(e)) {
    const a = taintKeys(e.whenTrue), b = taintKeys(e.whenFalse);
    if (!a && !b) return null; return new Set([...(a ?? []), ...(b ?? [])]);
  }
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)) {
    const a = taintKeys(e.left), b = taintKeys(e.right);
    if (!a && !b) return null; return new Set([...(a ?? []), ...(b ?? [])]);
  }
  return null;
}

function enclosingFunction(n) {
  let p = n.parent;
  while (p) { if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p)) return p; p = p.parent; }
}

let changed = true, rounds = 0;
while (changed && rounds < 12) {
  changed = false; rounds++;
  for (const sf of ownFiles) {
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const k = taintKeys(node.initializer);
        if (k) {
          if (ts.isIdentifier(node.name)) changed = mergeTaint(sym(node.name), k, `= ${node.initializer.getText(sf).slice(0, 60)}`) || changed;
          else if (ts.isObjectBindingPattern(node.name)) for (const el of node.name.elements) if (ts.isIdentifier(el.name)) changed = mergeTaint(sym(el.name), k, "destructured") || changed;
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const k = taintKeys(node.right);
        if (k) { const l = unwrap(node.left); const s = ts.isIdentifier(l) ? declSym(l) : ts.isPropertyAccessExpression(l) ? declSym(l.name) : undefined; changed = mergeTaint(s, k, "assigned") || changed; }
      }
      if (ts.isPropertyAssignment(node) && node.initializer) {
        const k = taintKeys(node.initializer);
        if (k) {
          changed = mergeTaint(sym(node.name), k, "object literal property") || changed;
          const obj = node.parent;
          if (ts.isObjectLiteralExpression(obj) && ts.isIdentifier(node.name)) {
            let ctx; try { ctx = checker.getContextualType(obj); } catch {}
            if (ctx) for (const p of partsOf(ctx)) { const ps = checker.getPropertyOfType(p, node.name.text); if (ps) changed = mergeTaint(ps, k, `contextual .${node.name.text}`) || changed; }
          }
        }
      }
      if (ts.isShorthandPropertyAssignment(node)) {
        const local = checker.getShorthandAssignmentValueSymbol?.(node);
        const k = local ? tainted.get(local) : undefined;
        if (k) {
          changed = mergeTaint(sym(node.name), k, "shorthand") || changed;
          const obj = node.parent;
          if (ts.isObjectLiteralExpression(obj)) { let ctx; try { ctx = checker.getContextualType(obj); } catch {} if (ctx) for (const p of partsOf(ctx)) { const ps = checker.getPropertyOfType(p, node.name.text); if (ps) changed = mergeTaint(ps, k, "contextual (shorthand)") || changed; } }
        }
      }
      if (ts.isReturnStatement(node) && node.expression) {
        const k = taintKeys(node.expression);
        if (k) { const f = enclosingFunction(node); if (f?.name) changed = mergeTaint(sym(f.name), k, "returns a doc read") || changed; }
      }
      if (ts.isArrowFunction(node) && node.body && !ts.isBlock(node.body)) {
        const k = taintKeys(node.body);
        if (k && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) changed = mergeTaint(sym(node.parent.name), k, "arrow returns a doc read") || changed;
      }
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        const cs = ts.isIdentifier(callee) ? declSym(callee) : ts.isPropertyAccessExpression(callee) ? declSym(callee.name) : undefined;
        for (const d of cs?.getDeclarations?.() ?? []) {
          if (!d.parameters) continue;
          node.arguments.forEach((arg, i) => {
            const p = d.parameters[i]; if (!p || !ts.isIdentifier(p.name)) return;
            const k = taintKeys(arg); if (k) changed = mergeTaint(sym(p.name), substituteParamKeys(k, node), `param of ${cs?.getName?.()}`) || changed;
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

// ============================ STAGE C: sinks ===============================
const EQ = new Map([
  [ts.SyntaxKind.EqualsEqualsEqualsToken, "==="], [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
  [ts.SyntaxKind.EqualsEqualsToken, "=="], [ts.SyntaxKind.ExclamationEqualsToken, "!="],
]);
const MEMBERSHIP = new Set(["includes", "indexOf", "lastIndexOf", "has", "add"]);
const MATCHERS = new Set(["toBe", "toContain"]);
const rows = [];

function classify(keys) {
  if (!keys) return "none";
  const arr = [...keys];
  if (arr.some((k) => widenedKeys.has(k))) return "WIDENED";
  if (arr.some((k) => k === DYN || /^@p\d+$/.test(k))) return "DYNAMIC";
  return "NARROW-KEY";
}
function opInfo(e, sf) {
  const k = taintKeys(e);
  return { text: e.getText(sf).replace(/\s+/g, " ").slice(0, 80), type: tstr(e).slice(0, 60), keys: k ? [...k] : null, tier: classify(k) };
}
function emit(sf, node, kind, ops) {
  const tiers = ops.map((o) => o.tier);
  const tier = tiers.includes("WIDENED") ? "WIDENED" : tiers.includes("DYNAMIC") ? "DYNAMIC" : "NARROW-KEY";
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  rows.push({
    file: path.relative(SRC, sf.fileName.replace(/\\/g, "/")).replace(/\\/g, "/"),
    line: line + 1, kind, tier,
    src: node.getText(sf).replace(/\s+/g, " ").slice(0, 200),
    operands: ops,
  });
}

for (const sf of ownFiles) {
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && EQ.has(node.operatorToken.kind)) {
      const a = opInfo(node.left, sf), b = opInfo(node.right, sf);
      if (a.keys || b.keys) emit(sf, node, `binary ${EQ.get(node.operatorToken.kind)}`, [a, b]);
    }
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "Object" && c.name.text === "is" && node.arguments.length === 2) {
        const a = opInfo(node.arguments[0], sf), b = opInfo(node.arguments[1], sf);
        if (a.keys || b.keys) emit(sf, node, "Object.is", [a, b]);
      } else if (ts.isPropertyAccessExpression(c) && MEMBERSHIP.has(c.name.text) && node.arguments.length >= 1) {
        const a = opInfo(node.arguments[0], sf);
        if (a.keys) emit(sf, node, `membership .${c.name.text}()`, [opInfo(c.expression, sf), a]);
      } else if (ts.isPropertyAccessExpression(c) && MATCHERS.has(c.name.text) && node.arguments.length === 1) {
        let r = c.expression; while (ts.isPropertyAccessExpression(r)) r = r.expression;
        if (ts.isCallExpression(r) && ts.isIdentifier(r.expression) && r.expression.text === "expect" && r.arguments.length >= 1) {
          const a = opInfo(r.arguments[0], sf), b = opInfo(node.arguments[0], sf);
          if (a.keys || b.keys) emit(sf, node, `matcher .${c.name.text}()`, [a, b]);
        }
      } else if (ts.isPropertyAccessExpression(c) && c.name.text === "set" && node.arguments.length === 2) {
        const a = opInfo(node.arguments[0], sf);
        if (a.keys) emit(sf, node, "map-key .set()", [a]);
      }
    }
    if (ts.isSwitchStatement(node)) { const a = opInfo(node.expression, sf); if (a.keys) emit(sf, node.expression, "switch", [a]); }

    // `typeof x === "string"` — a narrowing that silently takes the else branch
    // once the field can hold a nested type. `V2Node`'s docstring forbids it.
    if (ts.isBinaryExpression(node) && EQ.has(node.operatorToken.kind)) {
      for (const [l, r] of [[node.left, node.right], [node.right, node.left]]) {
        const lu = unwrap(l);
        if (ts.isTypeOfExpression(lu) && (ts.isStringLiteral(unwrap(r)) || ts.isNoSubstitutionTemplateLiteral(unwrap(r)))) {
          const a = opInfo(lu.expression, sf);
          if (a.keys) emit(sf, node, `typeof-narrow ${EQ.get(node.operatorToken.kind)} "${unwrap(r).text}"`, [a]);
        }
      }
    }

    // TRUTHINESS. An empty `Y.Text` is TRUTHY where `""` is falsy, so an
    // emptiness guard stops firing the day the field widens.
    {
      let subject = null, form = null;
      if (ts.isIfStatement(node)) { subject = node.expression; form = "if (x)"; }
      else if (ts.isWhileStatement(node)) { subject = node.expression; form = "while (x)"; }
      else if (ts.isConditionalExpression(node)) { subject = node.condition; form = "x ? :"; }
      else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) { subject = node.operand; form = "!x"; }
      else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) { subject = node.left; form = node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "x && y" : "x || y"; }
      if (subject) {
        const s = unwrap(subject);
        // only a bare tainted value — not a comparison, which is its own sink
        if (!ts.isBinaryExpression(s) && !ts.isPrefixUnaryExpression(s) && !ts.isTypeOfExpression(s)) {
          const a = opInfo(s, sf);
          if (a.keys) emit(sf, node, `truthiness ${form}`, [a]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ============================ POSITIVE CONTROL =============================
//
// Run this deriver against a tree in which a KNOWN member of the class is
// still blind and require it to be found. Without this, "the sweep found
// nothing" and "the deriver finds nothing" are the same observation.
//
//   git worktree add --detach <dir> fc10c5b        # pre-B32: both blind
//   node derive_representation_blindness.mjs <dir>/plugin /tmp/baseline.json
//
// Expected, and measured 2026-08-05:
//   __tests__/harness/fuzz/oracle.ts:243        Object.is(admission.landed, admission.intended)
//   __tests__/harness/fuzz/standard-ops.ts:979  Object.is(held, entry.stale)
const KNOWN_BLIND = [
  ["harness/fuzz/oracle.ts", "Object.is(admission.landed, admission.intended)"],
  ["harness/fuzz/standard-ops.ts", "Object.is(held, entry.stale)"],
];

const isTest = (f) => f.includes("__tests__");
const summary = { WIDENED: 0, DYNAMIC: 0, "NARROW-KEY": 0 };
for (const r of rows) summary[r.tier]++;
const out = { stageA: { keys: [...widenedKeys], evidence: stageAEvidence }, taintedSymbols: tainted.size, rounds, total: rows.length, summary, rows };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

console.log(`Stage A keys: ${[...widenedKeys].join(", ")} (${stageAEvidence.length} evidence lines)`);
console.log(`taint: ${tainted.size} symbols, ${rounds} rounds`);
console.log(`candidates: ${rows.length}`, summary);
console.log(`  product: ${rows.filter((r) => !isTest(r.file)).length}   tests: ${rows.filter((r) => isTest(r.file)).length}`);
console.log("--- positive control (the two known members of the class) ---");
for (const [file, needle] of KNOWN_BLIND) {
  const hits = rows.filter((r) => r.file.includes(file) && r.src.includes(needle));
  console.log(`  ${hits.length ? "FOUND" : "not present"}  ${needle}`);
  for (const h of hits) console.log(`         ${h.tier}  ${h.file}:${h.line}  [${h.kind}]`);
}
console.log("--- WIDENED + DYNAMIC ---");
for (const r of rows.filter((x) => x.tier !== "NARROW-KEY")) console.log(`${r.tier.padEnd(8)} ${r.file}:${r.line}  [${r.kind}]  ${r.src.slice(0, 110)}`);
