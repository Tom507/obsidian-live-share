// WP93 / C93 AC1 — THE CENSUS DERIVER.
//
// The charter's own warning is the reason this file parses instead of listing:
// the "five other consumers" figure the Dispatcher's ruling was built on is
// exactly right for `vault-events.ts` and wrong as a closed set, and the six
// nobody had named are the six most exposed to a release-timing change. A hand
// list copied out of a charter cannot catch the fourteenth call site the next
// work package writes, which is the entire point of the criterion.
//
// WHAT IT DERIVES, and both classes are derived by the same walk:
//
//   ├── CONSUMERS — every call of `isPathMuted`. A consumer is a place that asks
//   │   "did we cause this", i.e. a gate on a data path.
//   └── PRODUCERS — every site that RELEASES a mute. Not "every call of
//       `unmutePathEvents`": a producer may receive the release as an INJECTED
//       CALLBACK and spell it `unmute?.(path)`, and a census that greps only the
//       method name cannot see it. That is not hypothetical — it is how
//       `files/manifest.ts` stayed out of every producer count in this run.
//
// THE COMMENT STRIP IS LOAD-BEARING AND ITS DIRECTION IS STATED (AC1(b)). Both
// symbols are named in prose all over this tree — `vault-events.ts` carries a
// WP91 comment that says `isPathMuted` and is not a call. This deriver reports
// over COMMENT-STRIPPED code, so that line is EXCLUDED; `rawOccurrences` reports
// the un-stripped count beside it so both numbers are on the record and a reader
// can see which behaviour was chosen.
//
// `plugin/src/testing/` IS EXCLUDED (AC1(c)): it is the E2E control server, it is
// `define`-folded out of the production bundle, and the rig is not the product.
// `countedFiles` reports the exclusion rather than performing it silently.
//
// THE POSITIVE CONTROL IS BUILT IN (AC1, S53): `deriveCensus` THROWS on an empty
// input set rather than returning an empty census. WP86's deriver returned an
// empty set and "every derived site is corrected" passed perfectly on it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface CallSite {
  /** Module name relative to `plugin/src`, e.g. `files/file-ops.ts`. */
  readonly file: string;
  /** 1-based line in the ORIGINAL file. The strip preserves line count. */
  readonly line: number;
  /** The matched call text, trimmed — enough to identify the site by eye. */
  readonly text: string;
}

export interface Census {
  readonly countedFiles: readonly string[];
  readonly excludedFiles: readonly string[];
  /** `isPathMuted` calls, comment-stripped. */
  readonly consumers: readonly CallSite[];
  /** Sites that release a mute, comment-stripped. */
  readonly producers: readonly CallSite[];
  /** The one definition of the predicate, `file:line`. */
  readonly definition: string;
  /** Un-stripped occurrence counts, so AC1(b)'s two numbers are both present. */
  readonly rawOccurrences: { isPathMuted: number; release: number };
}

export function findPluginSrc(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "plugin", "src", "utils.ts");
    try {
      statSync(candidate);
      return join(dir, "plugin", "src");
    } catch {
      // keep walking up
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("WP93 census: could not locate plugin/src from the test file");
}

/** Comments may legitimately NAME a symbol; code may not be confused with them.
 * `//` is stripped in place so the line count — and therefore every derived line
 * number — survives the strip. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
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

/** A CALL of `isPathMuted` — through a receiver or bare, but never the method
 * DEFINITION (`isPathMuted(path: string): boolean {`) and never an interface
 * declaration, both of which are excluded by requiring no return-type colon
 * directly after the parameter list opener. */
const CONSUMER_RE = /(?:^|[^\w.])(?:[\w.?]+\.)?isPathMuted\s*\(\s*(?!\w+\s*:)/g;

/**
 * A RELEASE SITE. Three spellings, all real in this tree:
 *
 *   ├── `x.unmutePathEvents(p)`     the method, called through a receiver
 *   ├── `x.armMuteRelease(p, ...)`  WP93's inversion, which OWNS a release
 *   └── `unmute?.(p)` / `unmute(p)` the INJECTED CALLBACK spelling — the one a
 *                                   name-only grep cannot see
 *
 * A receiver is required for the first two so the method definition and the two
 * `PersistenceIO` interface declarations are not counted as releases.
 */
const PRODUCER_RE =
  /(?:[\w.?]+\.)(?:unmutePathEvents|armMuteRelease)\s*\(|(?:^|[^\w.])unmute\s*\??\.?\s*\(\s*(?!\w+\s*:)/g;

function sitesIn(file: string, code: string, re: RegExp): CallSite[] {
  const out: CallSite[] = [];
  const lines = code.split(/\r?\n/);
  lines.forEach((line, index) => {
    const scan = new RegExp(re.source, "g");
    let match = scan.exec(line);
    while (match !== null) {
      out.push({ file, line: index + 1, text: line.trim() });
      match = scan.exec(line);
    }
  });
  return out;
}

function countRaw(raw: string, re: RegExp): number {
  return raw.match(new RegExp(re.source, "g"))?.length ?? 0;
}

/**
 * Derive the census from `sources`, or from `plugin/src` on disk when omitted.
 *
 * THROWS on an empty input set, and throws when the one definition of
 * `isPathMuted` cannot be found. A deriver that returns an empty census makes
 * every assertion over it vacuously true.
 */
export function deriveCensus(sources?: ReadonlyMap<string, string>): Census {
  let files: Map<string, string>;
  if (sources) {
    files = new Map(sources);
  } else {
    const src = findPluginSrc();
    files = new Map(
      walk(src).map((path) => [
        path.slice(src.length + 1).replace(/\\/g, "/"),
        readFileSync(path, "utf8"),
      ]),
    );
  }

  if (files.size === 0) {
    throw new Error(
      "WP93 census: empty input set — refusing to emit a census (AC1 positive control)",
    );
  }

  const excludedFiles: string[] = [];
  const countedFiles: string[] = [];
  const consumers: CallSite[] = [];
  const producers: CallSite[] = [];
  let definition = "";
  let rawIsPathMuted = 0;
  let rawRelease = 0;

  for (const [name, raw] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    // AC1(c): the rig is not the product, and the exclusion is REPORTED.
    if (name === "testing" || name.startsWith("testing/")) {
      excludedFiles.push(name);
      continue;
    }
    countedFiles.push(name);
    const code = stripComments(raw);
    rawIsPathMuted += countRaw(raw, /isPathMuted/);
    rawRelease += countRaw(raw, /unmutePathEvents|armMuteRelease/);
    consumers.push(...sitesIn(name, code, CONSUMER_RE));
    producers.push(...sitesIn(name, code, PRODUCER_RE));
    const defAt = code
      .split(/\r?\n/)
      .findIndex((line) => /\bisPathMuted\s*\(\s*\w+\s*:/.test(line));
    if (defAt >= 0) definition = `${name}:${defAt + 1}`;
  }

  if (!definition) {
    throw new Error("WP93 census: no definition of isPathMuted found (AC1 positive control)");
  }

  return {
    countedFiles,
    excludedFiles,
    consumers,
    producers,
    definition,
    rawOccurrences: { isPathMuted: rawIsPathMuted, release: rawRelease },
  };
}

/** `file:line` for every site, in file order — the pinnable form. */
export function pin(sites: readonly CallSite[]): string[] {
  return sites.map((site) => `${site.file}:${site.line}`);
}

/** `<file>×<n>` — stable under line churn, still reddens when a site is added. */
export function byFile(sites: readonly CallSite[]): string[] {
  const counts = new Map<string, number>();
  for (const site of sites) counts.set(site.file, (counts.get(site.file) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([f, n]) => `${f}×${n}`);
}
