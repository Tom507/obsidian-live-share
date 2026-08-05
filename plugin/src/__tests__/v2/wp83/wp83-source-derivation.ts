// WP83 — the shared source-derivation used by AC2's coherence check and AC3's
// content-emission census. It is a helper, not a suite: it lives under
// `__tests__/`, so `productionFiles()` never walks it, and it exports nothing
// that production code can import.
//
// Everything here derives from THE TREE. No hand-maintained list of module names
// appears in this file — that is the whole point of both criteria: an
// enumeration a human keeps up to date is exactly what went stale.
//
// The comment-strip is load-bearing. `skipsAutoTextSync` and `emitOp` are named
// in a dozen comments across the tree; a derivation that did not strip comments
// would call every one of those modules a call site and go green on prose. It is
// the same helper `wp26/test_tp09` landed for the same reason.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findPluginSrc(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "plugin", "src", "utils.ts");
    try {
      statSync(candidate);
      return join(dir, "plugin", "src");
    } catch {
      // keep walking
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate plugin/src from the test file");
}

export interface SourceFile {
  /** Vault-relative-ish module name, e.g. `files/file-ops.ts`. */
  readonly name: string;
  readonly raw: string;
  /** `raw` with every comment removed. Line count is preserved for `//`. */
  readonly code: string;
}

/** Comments may legitimately NAME a symbol; code may not be confused with them. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
      walk(join(dir, entry.name), out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

export function productionFiles(src: string = findPluginSrc()): SourceFile[] {
  return walk(src).map((path) => {
    const raw = readFileSync(path, "utf8");
    return {
      name: path.slice(src.length + 1).replace(/\\/g, "/"),
      raw,
      code: stripComments(raw),
    };
  });
}

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "do",
  "else",
  "try",
  "function",
  "new",
  "typeof",
  "await",
  "super",
  "this",
  "yield",
  "delete",
  "void",
  "in",
  "of",
  "case",
  "throw",
]);

// A class member sits at EXACTLY two spaces in this codebase; a statement inside
// one never does. The indent is therefore the discriminator, and the keyword set
// is the belt-and-braces for a top-level `if (` that somehow reached column 2.
// NOTE the shape of the generator marker: `(?:\*\s*)?` and never `\*?\s*`. The
// latter lets `\s*` swallow further indentation, so `      unobserve();` at six
// spaces would resolve as a class member and mis-attribute every call below it.
// Measured on `background-sync.ts::onFileRenamed`, which came back as
// `::unobserve` until this was tightened.
const CLASS_MEMBER =
  /^ {2}(?:(?:private|public|protected|static|readonly|abstract|override|get|set)\s+)*(?:async\s+)?(?:\*\s*)?([A-Za-z_$][\w$]*)\s*(?:<[^<>]*>)?\s*\(/;
const TOP_FUNCTION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/;
const TOP_ARROW =
  /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\(|function)/;

/**
 * The name of the function lexically enclosing `index` in `code`.
 *
 * Returns `null` rather than guessing. A `null` is never silently dropped by a
 * caller: it surfaces as an UNRESOLVED site and fails the derivation loudly,
 * because a census that quietly forgets what it could not parse is the failure
 * mode both criteria exist to prevent.
 */
export function enclosingFunction(code: string, index: number): string | null {
  const upto = code.slice(0, index).split("\n");
  for (let i = upto.length - 1; i >= 0; i--) {
    const line = upto[i];
    for (const re of [CLASS_MEMBER, TOP_FUNCTION, TOP_ARROW]) {
      const m = re.exec(line);
      if (m && !KEYWORDS.has(m[1])) return m[1];
    }
  }
  return null;
}

export interface CallSite {
  /** `files/background-sync.ts` */
  readonly module: string;
  /** `background-sync.ts` */
  readonly basename: string;
  /** `setActiveFile`, or `null` when the enclosing function could not be resolved. */
  readonly fn: string | null;
  /** `files/background-sync.ts::setActiveFile` */
  readonly id: string;
}

/** Every CALL to `name(` in comment-stripped production source. Imports do not count. */
export function callSitesOf(files: SourceFile[], name: string, skipModules: string[]): CallSite[] {
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  const out: CallSite[] = [];
  for (const file of files) {
    if (skipModules.includes(file.name)) continue;
    for (const m of file.code.matchAll(re)) {
      const fn = enclosingFunction(file.code, m.index);
      out.push({
        module: file.name,
        basename: file.name.slice(file.name.lastIndexOf("/") + 1),
        fn,
        id: `${file.name}::${fn ?? `UNRESOLVED@${m.index}`}`,
      });
    }
  }
  return out;
}

/** Distinct `<module>::<fn>` ids, sorted. */
export function distinctIds(sites: CallSite[]): string[] {
  return [...new Set(sites.map((s) => s.id))].sort();
}

/** The `skipsAutoTextSync` contract comment — the block comment above its definition. */
export function contractComment(files: SourceFile[]): string {
  const utils = files.find((f) => f.name === "utils.ts");
  const source = utils?.raw ?? "";
  const at = source.search(/(?:export\s+)?function\s+skipsAutoTextSync\b/);
  if (at < 0) return "";
  const before = source.slice(0, at);
  const start = before.lastIndexOf("/**");
  return start < 0 ? "" : before.slice(start);
}

// ---------------------------------------------------------------------------
// WP83 AC3 — the content-emission census.
//
// The seams a file's bytes can leave this peer through. `emitOp` and `sendOp`
// are the two op emitters; `sendFileContent` and `sendChunked` exist for no
// other purpose than to transmit a file's bytes, so a call to either is a
// content emission by its own contract and needs no payload heuristic.
//
// Named here rather than discovered, and DELIBERATELY: a detector that derived
// its own emitter names would go quietly empty the day one was renamed. The
// defence is the opposite one — the names are pinned, and a test asserts each is
// still a real declaration in the module. That is the WP82 diagnostic failure
// ("a search that cannot match what it claims to look for") closed in the only
// direction that actually closes it.
// ---------------------------------------------------------------------------
export const EMISSION_SEAMS = ["emitOp", "sendOp", "sendFileContent", "sendChunked"] as const;

export interface EmissionSite {
  readonly module: string;
  readonly fn: string | null;
  readonly callee: string;
  /** The `type: "..."` literal in the payload, or `-` when the call forwards an op. */
  readonly opType: string;
  /** `<module>::<fn>::<callee>::<opType>` */
  readonly key: string;
  /** The call's argument text, whitespace-collapsed. Reported, never asserted on. */
  readonly args: string;
}

/** The argument text of the call whose `(` is at `openIdx`. Balanced-paren scan. */
export function argumentsAt(code: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return code.slice(openIdx + 1, i);
    }
  }
  return "";
}

export function emissionSites(files: SourceFile[]): EmissionSite[] {
  const re = new RegExp(`\\.\\s*(${EMISSION_SEAMS.join("|")})\\s*(?:\\?\\.)?\\s*\\(`, "g");
  const out: EmissionSite[] = [];
  for (const file of files) {
    for (const m of file.code.matchAll(re)) {
      const open = m.index + m[0].length - 1;
      const args = argumentsAt(file.code, open).replace(/\s+/g, " ").trim();
      const type = /type:\s*"([a-z-]+)"/.exec(args);
      const fn = enclosingFunction(file.code, m.index);
      out.push({
        module: file.name,
        fn,
        callee: m[1],
        opType: type ? type[1] : "-",
        key: `${file.name}::${fn ?? "UNRESOLVED"}::${m[1]}::${type ? type[1] : "-"}`,
        args,
      });
    }
  }
  return out;
}

/** In-module callers of `fn`, by enclosing function name. */
export function callersOf(file: SourceFile, fn: string): string[] {
  const re = new RegExp(`\\.\\s*${fn}\\s*(?:\\?\\.)?\\s*\\(`, "g");
  const out = new Set<string>();
  for (const m of file.code.matchAll(re)) {
    const caller = enclosingFunction(file.code, m.index);
    if (caller && caller !== fn) out.add(caller);
  }
  return [...out];
}

function consults(file: SourceFile, fn: string, predicate: string): boolean {
  const re = new RegExp(`\\b${predicate}\\s*\\(`, "g");
  for (const m of file.code.matchAll(re)) {
    if (enclosingFunction(file.code, m.index) === fn) return true;
  }
  return false;
}

/**
 * The functions that emit and are NOT reachable only past a consultation of the
 * predicate. STRUCTURAL, not an allowlist: a function is covered when it
 * consults the predicate itself, or when it has in-module callers and every one
 * of them is covered. Fixpoint, so a private helper two hops below a guarded
 * entry point is covered and a helper with one unguarded caller is not.
 */
export function unguardedEmitters(
  files: SourceFile[],
  sites: EmissionSite[],
  predicate: string,
): string[] {
  const byName = new Map(files.map((f) => [f.name, f]));
  const covered = new Map<string, boolean>();
  const key = (mod: string, fn: string) => `${mod}::${fn}`;

  const seed = (mod: string, fn: string) => {
    const file = byName.get(mod);
    if (!file) return;
    if (covered.has(key(mod, fn))) return;
    covered.set(key(mod, fn), consults(file, fn, predicate));
    for (const caller of callersOf(file, fn)) seed(mod, caller);
  };
  for (const site of sites) if (site.fn) seed(site.module, site.fn);

  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (const [k, isCovered] of [...covered]) {
      if (isCovered) continue;
      const [mod, fn] = k.split("::");
      const file = byName.get(mod);
      if (!file) continue;
      const callers = callersOf(file, fn);
      if (callers.length === 0) continue;
      if (callers.every((c) => covered.get(key(mod, c)) === true)) {
        covered.set(k, true);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return [
    ...new Set(
      sites
        .filter((s) => s.fn && covered.get(key(s.module, s.fn)) !== true)
        .map((s) => `${s.module}::${s.fn}`),
    ),
  ].sort();
}

export const CALL_SITE_BLOCK_OPEN = "==== CALL-SITE BLOCK";
export const CALL_SITE_BLOCK_CLOSE = "==== END CALL-SITE BLOCK";

/**
 * The delimited enumeration inside the contract comment, and ONLY that.
 *
 * Reading the whole comment instead would be the vacuity AC2 names: several
 * function names (`syncFromManifest`) also appear as rows of the untouched
 * `isSidecarPath` block further down, so a whole-comment `includes` would go
 * green on a row that documents a different predicate.
 */
export function callSiteBlock(comment: string): string {
  const open = comment.indexOf(CALL_SITE_BLOCK_OPEN);
  const close = comment.indexOf(CALL_SITE_BLOCK_CLOSE);
  if (open < 0 || close < 0 || close <= open) return "";
  return comment.slice(open, close);
}
