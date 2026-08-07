// ===========================================================================
// WP88 AC1 — THE ROUTE CENSUS, DERIVED FROM THE TREE BY REACHABILITY.
//
// Not a hand-written list. A hand-written list cannot catch the route the next
// work package adds, and — this is the sharp part — it did not catch the route
// that was already there: **E5**, `main.ts`'s bare `catch` around the whole
// plugin-load resume, reaches `SessionManager.endSession` through
// `abortSession`, ONE HOP AWAY, and is therefore INVISIBLE to a text search for
// `endSession` at the trigger site. Six of seven routes are findable by grep.
// The seventh is not, and it is the one with no retry ceiling at all.
//
// So the census is by REACHABILITY: a unit is in the set if it calls something
// in the set, transitively, seeded at `endSession`.
//
// ## What this deriver is, honestly
//
// A name-based call graph over brace-matched top-level units (class methods and
// exported functions). It is NOT a type-resolving analyser: it cannot tell
// `a.foo()` from `b.foo()`. That direction of error is the SAFE one for this
// criterion — it OVER-approximates reachability, so a route it reports as
// severed really is severed, while a false positive merely forces a disposition
// row. The one thing it must never do is miss a path, and over-approximation is
// exactly the shape that cannot.
//
// ## S53 — the recursive vacuity risk, named
//
// WP86's census deriver returned an EMPTY set and "every derived site is
// classified" passed perfectly on it. The reverse assertion is the only defence
// and may not be trimmed: this module is run against a synthetic module with no
// such path (must find nothing) AND against the real tree (must find a member
// known to exist).
// ===========================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface SourceUnit {
  /** Path relative to `plugin/src`, forward-slashed. */
  file: string;
  /** The method or function name. */
  name: string;
  /** `file#name`. */
  id: string;
  body: string;
  /** 1-based line of the unit's opening line. */
  line: number;
}

const UNIT_SIGNATURE =
  /^[ \t]*(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\(/;

/** Names that look like a unit signature but are control flow, not a callable. */
const NOT_A_UNIT = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "constructor",
  "do",
  "else",
  "typeof",
  "await",
  "super",
]);

/**
 * Blank out comment bodies, preserving offsets and newlines.
 *
 * THIS IS NOT COSMETIC. Without it the deriver reads a comment that MENTIONS
 * `endSession()` as a call to it, which reddened four rows of this very
 * criterion on the first run — the same defect that reddened three tests in
 * this project when WP37's comment quoted an import statement and the frozen
 * allow-list regex counted it. A detector that cannot tell code from prose is
 * measuring the prose.
 */
export function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl < 0 ? src.length : nl;
      out += " ".repeat(end - i);
      i = end - 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close < 0 ? src.length : close + 2;
      for (let k = i; k < end; k++) out += src[k] === "\n" ? "\n" : " ";
      i = end - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      for (; i < src.length; i++) {
        out += src[i];
        if (src[i] === "\\") {
          i++;
          if (i < src.length) out += src[i];
          continue;
        }
        if (src[i] === quote) break;
      }
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Brace-match forward from the first `{` at or after `from`. Returns the index
 * just past the matching `}`, or -1. String and comment content is skipped, so
 * a `{` inside a template literal or a `//` comment cannot unbalance the scan.
 */
function matchBlock(src: string, from: number): number {
  let i = src.indexOf("{", from);
  if (i < 0) return -1;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) return -1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2);
      if (i < 0) return -1;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      for (; i < src.length; i++) {
        if (src[i] === "\\") {
          i++;
          continue;
        }
        if (src[i] === quote) break;
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Split one source file into brace-matched top-level units. The source is
 * comment-stripped FIRST, so `body` is always code and a unit signature that
 * only appears inside a comment is never parsed as a unit.
 */
export function parseUnits(file: string, raw: string): SourceUnit[] {
  const src = stripComments(raw);
  const units: SourceUnit[] = [];
  const lines = src.split("\n");
  let offset = 0;
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    const match = UNIT_SIGNATURE.exec(raw);
    if (match && !NOT_A_UNIT.has(match[1]) && !raw.trimStart().startsWith("*")) {
      const end = matchBlock(src, offset);
      if (end > offset) {
        units.push({
          file,
          name: match[1],
          id: `${file}#${match[1]}`,
          body: src.slice(offset, end),
          line: ln + 1,
        });
      }
    }
    offset += raw.length + 1;
  }
  return units;
}

/** Every production `.ts` under `plugin/src`, excluding tests and mocks. */
export function productionSources(root: string): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (statSync(abs).isDirectory()) {
        if (entry === "__tests__" || entry === "__mocks__" || entry === "node_modules") continue;
        walk(abs, relPath);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        out.push({ file: relPath, src: readFileSync(abs, "utf8") });
      }
    }
  };
  walk(root, "");
  return out;
}

export interface CensusResult {
  /** Unit ids that reach the seed, transitively. Seeds included. */
  reaching: string[];
  /** Every (caller unit, callee name) edge that put a unit into the set. */
  edges: { from: string; callee: string; file: string }[];
  /** Units parsed, so an empty census can be told from an empty parse (S53). */
  unitCount: number;
}

/**
 * Reverse-reachability to `seedNames`. A unit joins the set when its body calls
 * a name that is a seed or belongs to a unit already in the set.
 *
 * `excludeSelf` drops a unit whose ONLY reason for being in the set is that it
 * declares the seed itself (`SessionManager.endSession` calling nothing).
 */
export function deriveCensus(
  sources: { file: string; src: string }[],
  seedNames: string[],
): CensusResult {
  const units: SourceUnit[] = [];
  for (const { file, src } of sources) units.push(...parseUnits(file, src));

  const reaching = new Set<string>();
  const edges: CensusResult["edges"] = [];
  // Names that, when called, mean "this reaches the seed".
  let frontier = new Set(seedNames);
  const settled = new Set<string>(seedNames);

  for (let round = 0; round < 32 && frontier.size > 0; round++) {
    const nextNames = new Set<string>();
    for (const unit of units) {
      if (reaching.has(unit.id)) continue;
      for (const name of frontier) {
        // A unit's own signature line is stripped, so declaring `endSession`
        // is not calling it — but `LiveSharePlugin.endSession` calling
        // `this.sessionManager.endSession()` in its BODY still counts, which is
        // exactly the hop the census must not lose.
        const callPattern = new RegExp(`(?:^|[^\\w$.])${name}\\s*\\(|\\.${name}\\s*\\(`);
        if (!callPattern.test(stripDeclarationLine(unit))) continue;
        reaching.add(unit.id);
        edges.push({ from: unit.id, callee: name, file: unit.file });
        if (!settled.has(unit.name)) nextNames.add(unit.name);
        break;
      }
    }
    for (const n of nextNames) settled.add(n);
    frontier = nextNames;
  }

  return { reaching: [...reaching].sort(), edges, unitCount: units.length };
}

/** A unit's own signature line must not count as a call to itself. */
function stripDeclarationLine(unit: SourceUnit): string {
  const nl = unit.body.indexOf("\n");
  return nl < 0 ? "" : unit.body.slice(nl);
}

// ---------------------------------------------------------------------------
// The four connectivity branches inside `connectSync`, derived rather than
// anchored on a line number or a comment.
//
// E1, E2/E3 and E4 all live inside ONE unit, so unit-level reachability alone
// would pin them as a group. These are extracted individually so a repair of
// one arm and not the other cannot pass — which is precisely S39's shape, and
// the reason the charter puts both halves in scope.
// ---------------------------------------------------------------------------

export interface ConnectivityBranch {
  route: "E1" | "E2/E3" | "E4";
  /** The derived body of that branch. */
  body: string;
}

export function deriveConnectivityBranches(mainRaw: string): ConnectivityBranch[] {
  const out: ConnectivityBranch[] = [];
  const units = parseUnits("main.ts", mainRaw);

  // E4 — the mux ceiling handler, whole.
  const mux = units.find((u) => u.name === "handleMuxExhausted");
  if (mux) out.push({ route: "E4", body: mux.body });

  // E2/E3 — the `auth-required` arm, and E1 — the trailing `else`, both inside
  // the control-state handler. Located by their own GUARDS, so neither a line
  // shift nor a comment edit can move them.
  const control = units.find((u) => u.name === "handleControlState");
  if (control) {
    const body = control.body;
    const authAt = body.indexOf('controlState === "auth-required"');
    if (authAt >= 0) {
      const end = matchBlock(body, authAt);
      if (end > authAt) {
        out.push({ route: "E2/E3", body: body.slice(authAt, end) });
        // The trailing `else` starts at the first `else {` after that block.
        const elseAt = body.indexOf("else {", end);
        if (elseAt >= 0) {
          const elseEnd = matchBlock(body, elseAt);
          if (elseEnd > elseAt) out.push({ route: "E1", body: body.slice(elseAt, elseEnd) });
        }
      }
    }
  }
  return out;
}

/** E5 — the plugin-load resume's bare `catch`, derived from `resumeSession`. */
export function deriveResumeCatch(mainRaw: string): string | null {
  const units = parseUnits("main.ts", mainRaw);
  const resume = units.find((u) => u.name === "resumeSession");
  if (!resume) return null;
  const catchAt = resume.body.indexOf("} catch");
  if (catchAt < 0) return null;
  const end = matchBlock(resume.body, catchAt);
  return end > catchAt ? resume.body.slice(catchAt, end) : null;
}
