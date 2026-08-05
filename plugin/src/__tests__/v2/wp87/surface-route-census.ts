// ===========================================================================
// WP87 AC2 — THE SURFACE-ROUTE CENSUS, DERIVED FROM THE TREE BY REACHABILITY.
//
// The question: is there ANY path from a remote-sourced record to a LIVE canvas
// surface that does not consult the one editing predicate?
//
// WHY IT IS NOT A FILENAME LIST. WP37 protected the route it was pointed at (the
// reconcile pass) and shipped green. The route that actually destroyed the
// second typist's characters — the disk write under an open leaf, which WP85
// made live — was on nobody's list, consulted the predicate ZERO times, and was
// reachable in production with no rig involved. A list of files someone thought
// of cannot contain the route nobody thought of. Reachability can.
//
// WHAT IS SEEDED AND WHAT IS DERIVED. The seed is a vocabulary of EFFECT
// PRIMITIVES — the calls that physically change what a user sees on an open
// canvas — and it is deliberately NOT a list of files, functions or modules:
//
//   ├── Obsidian's own live-view mutators, parsed OUT OF `canvas-adapter.ts`'s
//   │   own declaration block rather than spelled here, so a private member
//   │   added there joins the vocabulary automatically; and
//   └── a write to the `.canvas` FILE, parsed out of `PersistenceIO`, because —
//       MEASURED by WP87 on both vaults, on an unshared board with no plugin
//       path involved — Obsidian RELOADS an open canvas from an external write
//       and destroys the inline editor with it. THE FILE IS A SURFACE.
//       `main.ts` asserted in a comment for months that it was not.
//
// Everything else is derived: the units containing those primitives are the
// SINKS, every unit that transitively calls a sink is a ROUTE, and a sink is
// COVERED only when every path into it passes through a consultation.
//
// ## Honest limits
//
// A name-based call graph over brace-matched units. It cannot tell `a.write()`
// from `b.write()`, so it OVER-approximates the caller set. That is the safe
// direction here: an over-approximated caller set makes "every path is guarded"
// STRICTER, never looser, so a covered sink really is covered.
//
// ## S53 — the recursive vacuity risk, named and defended
//
// WP86's census deriver returned an EMPTY set and both "every derived site is
// pinned" assertions passed on it. WP88's parser then mistook a type literal in
// a multi-line signature for a function body. Both traps are live here, and both
// are defended by reverse assertions in the test file that may not be trimmed.
// ===========================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { productionSources, stripComments } from "../../wp88/route-census";

export { productionSources, stripComments };

/** Absolute path of `plugin/src`, from this file's own location. */
export const SRC_ROOT = join(__dirname, "..", "..", "..");

export interface SourceUnit {
  file: string;
  name: string;
  /** `file#name`. */
  id: string;
  body: string;
  line: number;
  /** Declared `private`: a same-name method in another file is another class. */
  isPrivate: boolean;
}

const UNIT_SIGNATURE =
  /^[ \t]*(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:readonly\s+)?(?:async\s+)?(?:function\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*\(/;

const NOT_A_UNIT = new Set([
  "if", "for", "while", "switch", "catch", "return", "do", "else",
  "typeof", "await", "super", "new", "throw",
]);

/** Skip strings and comments while scanning; returns the index of `}` matching `{` at `open`. */
function matchFrom(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
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

/** Index just past the `)` closing the parameter list that opens at `paren`. */
function matchParen(src: string, paren: number): number {
  let depth = 0;
  for (let i = paren; i < src.length; i++) {
    const c = src[i];
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
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The unit's BODY block, not the first `{` after its name.
 *
 * THIS IS S53'S ORIGINAL CAUSE, and it is live in this tree: `main.ts`'s
 * `private reconcileLiveCanvas(\n path: string,\n data: { nodes: … }` opens a
 * `{` inside its PARAMETER LIST, on the line after the signature. A parser that
 * takes the first `{` reads that type literal as the whole function and the unit
 * looks like it calls nothing at all — which is exactly how an enumeration
 * returns "no route here" for the route the criterion is about.
 *
 * So: match the parameter list first, then take the first `{` after it that is
 * NOT a return-type annotation (a return-type object is followed by another `{`;
 * a body is not).
 */
function bodyBlock(src: string, sigStart: number): { start: number; end: number } | null {
  const paren = src.indexOf("(", sigStart);
  if (paren < 0) return null;
  const afterParams = matchParen(src, paren);
  if (afterParams < 0) return null;
  let cursor = afterParams;
  for (let guard = 0; guard < 8; guard++) {
    const brace = src.indexOf("{", cursor);
    if (brace < 0) return null;
    // A `;` or a new signature before the brace means this unit has no body
    // (an interface member, an overload, an abstract declaration).
    const between = src.slice(cursor, brace);
    if (between.includes(";") || between.includes("=>")) return null;
    const end = matchFrom(src, brace);
    if (end < 0) return null;
    const after = src.slice(end).match(/^\s*\{/);
    if (after) {
      // That block was a return-type annotation; the real body follows.
      cursor = end;
      continue;
    }
    return { start: brace, end };
  }
  return null;
}

export function parseUnits(file: string, raw: string): SourceUnit[] {
  const src = stripComments(raw);
  const units: SourceUnit[] = [];
  const lines = src.split("\n");
  let offset = 0;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const match = UNIT_SIGNATURE.exec(line);
    if (match && !NOT_A_UNIT.has(match[1]) && !line.trimStart().startsWith("*")) {
      const block = bodyBlock(src, offset);
      if (block) {
        units.push({
          file,
          name: match[1],
          id: `${file}#${match[1]}`,
          body: src.slice(block.start, block.end),
          line: ln + 1,
          isPrivate: /^[ 	]*private\s/.test(line),
        });
      }
    }
    offset += line.length + 1;
  }
  return units;
}

// --- the effect vocabulary, derived from the tree ---------------------------

/**
 * Obsidian's private live-view mutators, read from `canvas-adapter.ts`'s own
 * declaration block — the file is the ONE place allowed to touch the private
 * Canvas API, and it names what it touches:
 *
 *     //   setData(data)     → replace canvas contents (structural add/remove)
 *     //   requestFrame()    → schedule a re-render
 *     //   requestSave()     → persist to the .canvas file
 */
export function deriveViewMutators(adapterRaw: string): string[] {
  const found = new Set<string>();
  const block = adapterRaw.match(/Live-view reconciliation surface[\s\S]*?\n(?:\s*\/\/[^\n]*\n)+/);
  if (block) {
    for (const m of block[0].matchAll(/\/\/\s{2,}([A-Za-z_$][\w$]*)\s*\(/g)) found.add(m[1]);
  }
  if (/moveAndResize\?:/.test(adapterRaw)) found.add("moveAndResize");
  return [...found].sort();
}

/**
 * The `.canvas` FILE writer, read from `PersistenceIO`'s own declaration —
 * BOTH the member name AND its first parameter's name.
 *
 * The parameter name matters: `write(` alone is one of the most common
 * identifiers in the tree and matches a markdown sink, a sidecar checkpoint and
 * a conflict archive, none of which is a live canvas surface. The declaration
 * says `write(diskPath: string, content: string)`, so a call that passes
 * something named `…diskPath` is a call to THIS seam. Derived, not asserted: if
 * the parameter is renamed, the vocabulary follows it.
 */
export function deriveFileWriters(persistenceRaw: string): { name: string; firstParam: string }[] {
  const iface = persistenceRaw.match(/export interface PersistenceIO\s*\{([\s\S]*?)\n\}/);
  if (!iface) return [];
  const out: { name: string; firstParam: string }[] = [];
  for (const m of iface[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)/gm)) {
    if (m[1] === "read" || m[1] === "exists") continue; // a read changes no surface
    if (/^(un)?mute/.test(m[1])) continue; // echo plumbing, not bytes
    out.push({ name: m[1], firstParam: m[2] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The regex that recognises a call to one derived file-writer seam. */
export function fileWriterPattern(w: { name: string; firstParam: string }): RegExp {
  return new RegExp(`\\.?${w.name}\\s*\\(\\s*[\\w.]*${w.firstParam}\\b`, "i");
}

// --- the census -------------------------------------------------------------

/**
 * Canvas scope. NOT a route allowlist — every unit in the tree is parsed and every
 * caller edge is followed. This only bounds which SINKS the coverage criterion is
 * asserted over, because `write(` is a common identifier and a markdown sink in
 * `background-sync.ts` is not a canvas surface. Stated as what it is.
 */
export function isCanvasScoped(file: string): boolean {
  return file === "main.ts" || file.startsWith("canvas/") || /(^|\/)canvas-[\w-]+\.ts$/.test(file);
}

export const PREDICATE_NAMES = [
  "getEditingNodeId",
  "classifyBusyGate",
  "planEditingDeferral",
  "planCanvasDiskWrite",
] as const;

/** Verdict strings a consulting site must branch on for the answer to be honoured. */
const VERDICT_TOKENS = ["withhold", "hold", "substitute", "defer-drag", "editing"];

function callsAny(body: string, names: readonly string[]): string[] {
  const hit: string[] = [];
  for (const name of names) {
    // `?.` is part of a call in this tree (`adapter?.getEditingNodeId?.()`), so
    // the optional-chaining forms are matched too. Missing them would report a
    // guarded site as consulting nothing — an absence produced by the detector.
    const call = new RegExp(
      `(?:^|[^\\w$.?])${name}\\s*\\(|[.?]\\.?\\s*${name}\\s*\\??\\.?\\s*\\(`,
    );
    if (call.test(body)) hit.push(name);
  }
  return hit;
}

/**
 * How a derived sink is disposed of. Every value except `UNGUARDED` is a
 * STRUCTURAL admission — read off the unit's own body or the call graph, never
 * off a list of filenames somebody maintains.
 */
export type SinkDisposition =
  /** Consults the predicate AND branches on the verdict AND can return early. */
  | "GUARDED"
  /** Every production caller of it is guarded, transitively. */
  | "GUARDED-BY-CALLER"
  /**
   * It writes through an INJECTED seam (`io.write`), so the guard cannot be at
   * this call site by construction — it is at whoever supplies the `io`. Every
   * such injection site is asserted GUARDED separately.
   */
  | "INJECTED-SEAM"
  /** Runs only to RELEASE a held write, i.e. after the editing session ended. */
  | "RELEASE"
  /**
   * It refuses to overwrite: it checks existence and throws rather than
   * replacing bytes. It can create a file, never rebuild one a leaf is showing.
   */
  | "REFUSES-TO-OVERWRITE"
  /**
   * Its only remaining callers live behind `useCanvasBinding`, which this build
   * ships `false` and which C87 freezes. Reported, not repaired: it is a real
   * future route and this is where it is written down.
   */
  | "FROZEN-BEHIND-FLAG"
  /** It is the factory that DEFINES another sink, not a route into one. */
  | "DEFINER-FACTORY"
  /** No production unit calls it: it cannot be entered at all. */
  | "NO-PRODUCTION-CALLER"
  /** Reachable, and nothing on the way asks whether an editor is open. */
  | "UNGUARDED";

export interface SurfaceSink {
  id: string;
  file: string;
  unit: string;
  /** Which effect primitives it contains. */
  via: string[];
  /** Predicate names this unit itself calls. */
  consults: string[];
  honoursVerdict: boolean;
  /** Production units that call this one, LIVE on this build. */
  callers: string[];
  /** Callers behind `useCanvasBinding`: reported, excluded from the guarantee. */
  flagGatedCallers: string[];
  disposition: SinkDisposition;
}

export interface Census {
  sinks: SurfaceSink[];
  /** Every unit that transitively reaches an effect primitive. */
  routes: string[];
  unitCount: number;
  primitives: string[];
}

/**
 * Functions that hand a `PersistenceIO` to the writer — DERIVED from the writer
 * module's own exported signatures (the ones that mention `PersistenceIO`), not
 * spelled here. These are where the guard for an `io.write` sink must live,
 * because a call through an injected interface cannot be guarded at its own site.
 */
export function deriveInjectionApi(persistenceRaw: string): string[] {
  const names = new Set<string>();
  for (const m of persistenceRaw.matchAll(
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]{0,400}?)\)\s*:\s*([^\n{]*)/g,
  )) {
    if (/PersistenceIO/.test(m[2]) || /PersistenceIO/.test(m[3])) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * Modules constructed ONLY behind `useCanvasBinding` — the P5 path, which
 * `types.ts` ships `false` and which C87 freezes. Derived by reading the flag's
 * own block in `main.ts` and collecting what is constructed inside it, so a
 * module that leaves the flag's shadow stops being admitted automatically.
 */
export function deriveFlagGatedIdentifiers(mainRaw: string): string[] {
  const src = stripComments(mainRaw);
  const names = new Set<string>();
  // EVERY `useCanvasBinding` conditional, not the first: the flag is read in
  // more than one place, and taking `indexOf` alone would silently measure the
  // wrong block — the "a search that cannot match what it looks for" shape this
  // run has already paid for once.
  for (
    let at = src.indexOf("useCanvasBinding)");
    at >= 0;
    at = src.indexOf("useCanvasBinding)", at + 1)
  ) {
    const brace = src.indexOf("{", at);
    if (brace < 0 || brace - at > 40) continue;
    const end = matchFrom(src, brace);
    if (end < 0) continue;
    for (const m of src
      .slice(brace, end)
      .matchAll(/(?:new\s+|=\s*)([A-Z][\w$]*|create[A-Z][\w$]*)\s*\(/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

export function deriveCensus(
  sources: { file: string; src: string }[],
  viewMutators: string[],
  fileWriters: { name: string; firstParam: string }[],
  opts: {
    scope?: (file: string) => boolean;
    injectionApi?: string[];
    flagGatedIdentifiers?: string[];
  } = {},
): Census {
  const scope = opts.scope ?? (() => true);
  const injectionApi = opts.injectionApi ?? [];
  const flagGated = opts.flagGatedIdentifiers ?? [];
  const units: SourceUnit[] = [];
  for (const { file, src } of sources) units.push(...parseUnits(file, src));

  const primitives = [...viewMutators, ...fileWriters.map((w) => `${w.name}(${w.firstParam})`)];
  const hits = (body: string): string[] => {
    const via = callsAny(body, viewMutators);
    for (const w of fileWriters) {
      if (fileWriterPattern(w).test(body)) via.push(`${w.name}(${w.firstParam})`);
    }
    return via;
  };

  const sinkUnits = units.filter((u) => hits(u.body).length > 0);

  // Transitive callers, over the WHOLE tree — this is the route set.
  const routeIds = new Set(sinkUnits.map((u) => u.id));
  let frontier = [...new Set(sinkUnits.map((u) => u.name))];
  const settled = new Set(frontier);
  for (let round = 1; round < 8 && frontier.length > 0; round++) {
    const next: string[] = [];
    for (const u of units) {
      if (routeIds.has(u.id)) continue;
      if (callsAny(u.body, frontier).length === 0) continue;
      routeIds.add(u.id);
      if (!settled.has(u.name)) next.push(u.name);
    }
    for (const n of next) settled.add(n);
    frontier = next;
  }

  const guards = (u: SourceUnit): boolean => {
    const consults = callsAny(u.body, PREDICATE_NAMES);
    return (
      consults.length > 0 &&
      VERDICT_TOKENS.some((t) => u.body.includes(`"${t}"`)) &&
      /\breturn\b/.test(u.body)
    );
  };
  /**
   * Callers, over-approximated by NAME — except for a `private` member, where a
   * cross-file same-name method belongs to a different class and counting it
   * would invent a caller that cannot exist.
   */
  const callersFor = (u: SourceUnit): SourceUnit[] =>
    units.filter(
      (o) =>
        o.id !== u.id &&
        (u.isPrivate ? o.file === u.file : true) &&
        callsAny(o.body, [u.name]).length > 0,
    );

  const guardedByCallerMemo = new Map<string, boolean>();
  const guardedByCaller = (u: SourceUnit, seen: Set<string>): boolean => {
    const memo = guardedByCallerMemo.get(u.id);
    if (memo !== undefined) return memo;
    if (seen.has(u.id)) return true; // a cycle introduces no new unguarded path
    if (guards(u)) return true;
    const callers = callersFor(u);
    if (callers.length === 0) return false;
    const next = new Set(seen).add(u.id);
    const all = callers.every((c) => guardedByCaller(c, next));
    guardedByCallerMemo.set(u.id, all);
    return all;
  };

  // The units that hand a `PersistenceIO` to the writer. An `io.write` sink is
  // only admitted when at least one exists AND every one of them guards — so the
  // PRE-WP87 tree, where none of them asked anything, is reported UNGUARDED.
  const injectionSites = injectionApi.length
    ? units.filter((u) => callsAny(u.body, injectionApi).length > 0)
    : [];
  const injectionGuarded = injectionSites.length > 0 && injectionSites.every(guards);

  // A file is flag-gated when it defines something the `useCanvasBinding` block
  // constructs. Its callers are not live on a build that ships the flag `false`.
  const flagGatedFiles = new Set(
    units.filter((u) => flagGated.includes(u.name)).map((u) => u.file),
  );

  const sinks: SurfaceSink[] = sinkUnits
    .filter((u) => scope(u.file))
    .map((u) => {
      const consults = callsAny(u.body, PREDICATE_NAMES);
      const honoursVerdict = guards(u);
      const allCallers = callersFor(u);
      // A unit whose body CONTAINS this sink's body is the factory that defines
      // it, not a route into it. `createCanvasAdapter` encloses every adapter
      // method; counting it as a caller would make the definer its own route.
      const notTheFactory = allCallers.filter(
        (c) => !(c.file === u.file && c.body.includes(u.body)),
      );
      // Callers behind `useCanvasBinding` are not live on a build that ships the
      // flag `false`. They are REMOVED from the guarantee and REPORTED, so the
      // route is written down rather than quietly admitted.
      const flagGatedCallers = notTheFactory
        .filter((c) => flagGatedFiles.has(c.file))
        .map((o) => o.id)
        .sort();
      const liveCallers = notTheFactory.filter((c) => !flagGatedFiles.has(c.file));
      const callers = liveCallers.map((o) => o.id).sort();
      const allLiveCallersGuard =
        liveCallers.length > 0 && liveCallers.every((c) => guardedByCaller(c, new Set()));
      // STRUCTURAL admission, in order of specificity. Every branch reads the
      // unit's own body or the call graph; none reads a filename.
      // A sink whose body ENCLOSES another sink in the same file is the factory
      // that defines it, not a route into it: `createCanvasAdapter` contains
      // every adapter method, so counting it would make the definer its own
      // route and hide which method actually mutates.
      const enclosesAnotherSink = sinkUnits.some(
        (o) => o.file === u.file && o.id !== u.id && u.body.includes(o.body),
      );
      let disposition: SinkDisposition = "UNGUARDED";
      if (enclosesAnotherSink) disposition = "DEFINER-FACTORY";
      else if (honoursVerdict) disposition = "GUARDED";
      else if (/\.release\s*\(/.test(u.body)) disposition = "RELEASE";
      else if (allLiveCallersGuard) disposition = "GUARDED-BY-CALLER";
      else if (/(?:^|[^\w$])io\.\w+\s*\(/.test(u.body)) {
        disposition = injectionGuarded ? "INJECTED-SEAM" : "UNGUARDED";
      } else if (/\.exists\s*\(/.test(u.body) && /\bthrow\b/.test(u.body)) {
        disposition = "REFUSES-TO-OVERWRITE";
      } else if (liveCallers.length === 0 && flagGatedCallers.length > 0) {
        disposition = "FROZEN-BEHIND-FLAG";
      } else if (liveCallers.length === 0) disposition = "NO-PRODUCTION-CALLER";
      return {
        id: u.id,
        file: u.file,
        unit: u.name,
        via: hits(u.body),
        consults,
        honoursVerdict,
        callers,
        flagGatedCallers,
        disposition,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return { sinks, routes: [...routeIds].sort(), unitCount: units.length, primitives };
}

/** The real tree, with the effect vocabulary derived from it. */
export function censusFromTree(): Census {
  const sources = productionSources(SRC_ROOT);
  const adapter = readFileSync(join(SRC_ROOT, "canvas", "canvas-adapter.ts"), "utf8");
  const persistence = readFileSync(join(SRC_ROOT, "files", "canvas-persistence.ts"), "utf8");
  const main = readFileSync(join(SRC_ROOT, "main.ts"), "utf8");
  return deriveCensus(sources, deriveViewMutators(adapter), deriveFileWriters(persistence), {
    scope: isCanvasScoped,
    injectionApi: deriveInjectionApi(persistence),
    flagGatedIdentifiers: deriveFlagGatedIdentifiers(main),
  });
}

/**
 * Rule 15, executed rather than described: count occurrences of an ERE
 * alternation, over COMMENT-STRIPPED source. TOOL: Node's own `RegExp` with the
 * `g` flag — not `grep -o`, whose `.` wildcard produced two false hits in this
 * run, and not a raw read, which would count a mention in prose as a call.
 */
export function countMatches(src: string, pattern: RegExp): number {
  const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  return (stripComments(src).match(re) ?? []).length;
}
