// WP92 / C92 AC1 + AC5 — THE DERIVERS.
//
// Two censuses, one walk, and both of them exist because a HAND LIST cannot
// catch the fourth call site the next work package writes. That is not a
// hypothetical here: WP90's own module comment enumerated five properties of the
// store and every one was about what it may HOLD; not one was about when an
// entry stops applying, and the rename orphan sat under that gap for two
// batches.
//
//   ├── THE STORE-KEY CENSUS (AC1). Every expression that reaches
//   │   `DurableSeedRefusals.load` / `.save` / `.migrate` as its FIRST argument.
//   │   The criterion is that the SINK/SAVE expression is a singleton and that
//   │   no site anywhere passes `toLocalPath(...)` of anything.
//   └── THE ARTEFACT CENSUS (AC5). Every file `canvas-sidecar.ts` names under
//       `SIDECAR_DIR`, with the key its filename is built from — derived from
//       the path builders' own parameter lists, not from a table in a charter.
//
// BOTH POSITIVE CONTROLS HAVE TWO HALVES, and S53 is why. WP86's deriver
// returned an empty set and "every derived site is corrected" passed perfectly
// on it, because after a repair "the class is empty" and "the deriver went
// blind" produce the same output.
//
//   ├── HALF A — IT CAN FIND ONE. Run against {@link PRE_REPAIR_HYDRATE}, a
//   │   literal of WP90's three landed call sites, the deriver must report
//   │   `this.diskPath` — the known-present, platform-dependent key. A deriver
//   │   that cannot find the defect on the tree that HAD it proves nothing about
//   │   the tree that does not.
//   └── HALF B — IT REFUSES TO ANSWER ON NOTHING. An empty input set THROWS
//       rather than returning an empty census.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface KeySite {
  /** Module name relative to `plugin/src`, e.g. `files/canvas-persistence.ts`. */
  readonly file: string;
  /** 1-based line in the ORIGINAL file — the strip preserves line count. */
  readonly line: number;
  /** `load` | `save` | `migrate`. */
  readonly method: string;
  /** The first argument, source-verbatim and trimmed. THE KEY EXPRESSION. */
  readonly key: string;
}

export interface StoreKeyCensus {
  readonly countedFiles: readonly string[];
  readonly excludedFiles: readonly string[];
  /** Names bound to the durable seam, per file. The census's own reachability. */
  readonly seamNames: readonly string[];
  readonly sites: readonly KeySite[];
  /** Distinct key expressions reaching `save`/the sink. AC1's singleton. */
  readonly writeKeys: readonly string[];
  /** Distinct key expressions reaching `load`. */
  readonly readKeys: readonly string[];
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
  throw new Error("WP92 census: could not locate plugin/src from the test file");
}

/** Comments may legitimately NAME a symbol; code may not be confused with them.
 * Stripped in place so the line count — and every derived line number — survives. */
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

export function readProductionSources(): Map<string, string> {
  const src = findPluginSrc();
  return new Map(
    walk(src).map((path) => [
      path.slice(src.length + 1).replace(/\\/g, "/"),
      readFileSync(path, "utf8"),
    ]),
  );
}

/**
 * Names in this file that are bound to the durable-refusals seam.
 *
 * Four bindings are recognised because four are how the seam is actually
 * reached in this tree: a local alias of the field, a typed field, a typed
 * parameter, and a direct construction. A census that only knew the field name
 * would miss `const store = this.durableRefusals;` — which is the line every
 * real call site goes through.
 */
const SEAM_BINDINGS: readonly RegExp[] = [
  /(?:const|let)\s+(\w+)\s*=\s*this\.durableRefusals\b/g,
  /(?:private\s+)?(?:readonly\s+)?(\w+)\s*\??\s*:\s*(?:DurableSeedRefusals|SeedRefusalStore)\b/g,
  /(?:const|let)\s+(\w+)\s*=\s*new\s+SeedRefusalStore\s*\(/g,
  /(?:const|let)\s+(\w+)\s*=\s*this\.seedRefusalStore\b/g,
];

/** Balanced-paren read of the FIRST argument, so `save(f(a, b), x)` is not split. */
function firstArgument(text: string, openParenIndex: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = openParenIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      if (depth === 1) start = i + 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i).trim();
    } else if (ch === "," && depth === 1) {
      return text.slice(start, i).trim();
    }
  }
  return null;
}

/**
 * AC1's census. Throws on an empty input set (half B of the positive control).
 *
 * `plugin/src/testing/` is EXCLUDED and the exclusion is REPORTED rather than
 * performed silently: it is the E2E control server, it is `define`-folded out of
 * the production bundle, and the rig is not the product.
 */
export function deriveStoreKeyCensus(sources?: ReadonlyMap<string, string>): StoreKeyCensus {
  const files = new Map(sources ?? readProductionSources());
  if (files.size === 0) {
    throw new Error(
      "WP92 store-key census: empty input set — refusing to emit a census (AC1 positive control, S53)",
    );
  }

  const countedFiles: string[] = [];
  const excludedFiles: string[] = [];
  const seamNames = new Set<string>();
  const sites: KeySite[] = [];

  for (const [name, raw] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (name === "testing" || name.startsWith("testing/")) {
      excludedFiles.push(name);
      continue;
    }
    countedFiles.push(name);
    const code = stripComments(raw);

    const local = new Set<string>();
    for (const pattern of SEAM_BINDINGS) {
      const scan = new RegExp(pattern.source, "g");
      let match = scan.exec(code);
      while (match !== null) {
        local.add(match[1]);
        seamNames.add(`${name}:${match[1]}`);
        match = scan.exec(code);
      }
    }
    if (local.size === 0) continue;

    const lines = code.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const receiver of local) {
        // `store.load(`, `store.save(`, `store.migrate(` and the optional-call
        // spelling `store.migrate?.(` — the last of which a name-only grep for
        // `.migrate(` cannot see, which is exactly how `manifest.ts` stayed out
        // of every producer count in WP93's run.
        const scan = new RegExp(
          `(?:^|[^\\w.])${receiver}\\??\\.(load|save|migrate)\\s*\\??\\.?\\s*\\(`,
          "g",
        );
        let match = scan.exec(line);
        while (match !== null) {
          const open = line.indexOf("(", match.index + match[0].length - 1);
          const key = firstArgument(line, open);
          if (key !== null && key.length > 0) {
            sites.push({ file: name, line: index + 1, method: match[1], key });
          }
          match = scan.exec(line);
        }
      }
    });
  }

  const writeKeys = [...new Set(sites.filter((s) => s.method === "save").map((s) => s.key))].sort();
  const readKeys = [...new Set(sites.filter((s) => s.method === "load").map((s) => s.key))].sort();
  return { countedFiles, excludedFiles, seamNames: [...seamNames].sort(), sites, writeKeys, readKeys };
}

// ---------------------------------------------------------------------------
// AC5 — the OTHER sidecar artefacts, derived from their own path builders.
// ---------------------------------------------------------------------------

export interface SidecarArtefact {
  /** The builder's exported name, e.g. `sidecarHistoryPath`. */
  readonly builder: string;
  /** Its key parameter, or `null` when the artefact is a WHOLE-VAULT file. */
  readonly keyParameter: string | null;
  /** The returned template, source-verbatim. */
  readonly template: string;
}

/**
 * Every `SIDECAR_DIR`-rooted path builder in `canvas-sidecar.ts`, with the key
 * its FILENAME is built from.
 *
 * A builder with a parameter names the artefact by that key (`<guid>.yhistory`);
 * a builder without one is a single whole-vault file whose keys live INSIDE it
 * (`index.json`, `seed-refusals.json`) — and those are the two the store-key
 * census above has to answer for. The split is derived from the signature, not
 * asserted from a table.
 *
 * THROWS on an empty result: a census that finds no artefacts and reports the
 * class closed is S53's exact shape.
 */
export function deriveSidecarArtefacts(sidecarSource: string): SidecarArtefact[] {
  const code = stripComments(sidecarSource);
  const out: SidecarArtefact[] = [];
  const scan =
    /export\s+function\s+(\w+)\s*\(([^)]*)\)\s*:\s*string\s*\{\s*return\s*`([^`]*)`/g;
  let match = scan.exec(code);
  while (match !== null) {
    const [, builder, params, template] = match;
    if (template.includes("${SIDECAR_DIR}")) {
      const param = params.trim();
      out.push({
        builder,
        keyParameter: param.length === 0 ? null : (param.split(":")[0] as string).trim(),
        template,
      });
    }
    match = scan.exec(code);
  }
  if (out.length === 0) {
    throw new Error(
      "WP92 artefact census: no SIDECAR_DIR path builders found — refusing to emit a census (AC5 positive control, S53)",
    );
  }
  return out.sort((a, b) => a.builder.localeCompare(b.builder));
}

/**
 * Does `handleRename` re-point this artefact's keys? Derived from the body of
 * `handleRename` in `canvas-sync.ts` rather than from the charter's table.
 *
 * The charter's own reading — `index.json` IS followed, `seed-refusals.json` is
 * not — is an INPUT to be re-measured here, never a result to be quoted.
 */
export function deriveRenameFollowers(canvasSyncSource: string): string[] {
  const code = stripComments(canvasSyncSource);
  const start = code.indexOf("async handleRename(");
  if (start < 0) {
    throw new Error(
      "WP92 rename census: handleRename not found in canvas-sync.ts (AC5 positive control)",
    );
  }
  let depth = 0;
  let end = start;
  for (let i = code.indexOf("{", start); i < code.length; i++) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = code.slice(start, end);
  const followers = new Set<string>();
  const scan = /(?:^|[^\w.])(\w+)\??\.(bind|unbind|rekeyPathState|migrate|save)\s*\(/g;
  let match = scan.exec(body);
  while (match !== null) {
    followers.add(`${match[1]}.${match[2]}`);
    match = scan.exec(body);
  }
  if (/rekeyPathState\s*\(/.test(body)) followers.add("this.rekeyPathState");
  if (followers.size === 0) {
    throw new Error(
      "WP92 rename census: handleRename's body yielded no re-key calls (AC5 positive control)",
    );
  }
  return [...followers].sort();
}

/**
 * WP90's three landed call sites, as a LITERAL — half A of the positive control.
 *
 * This is not a copy of the current tree and must never be regenerated from it:
 * it is what the pre-repair build actually did, and the deriver's ability to
 * find `this.diskPath` in it is the only evidence that a green on the real tree
 * means anything at all.
 */
export const PRE_REPAIR_HYDRATE = `
import type { DurableSeedRefusals } from "./seed-refusal-store";

export class CanvasPersistence {
  private readonly durableRefusals?: DurableSeedRefusals;

  private async hydrateDurableRefusals(): Promise<void> {
    const store = this.durableRefusals;
    if (store === undefined || this.durableHydrated) return;
    this.durableHydrated = true;
    const reseeded = this.refusals.hasSeededThisSession;
    let stored: readonly SeedRefusal[] = [];
    if (!reseeded) {
      stored = await store.load(this.diskPath);
      if (stored.length > 0) this.refusals.restore(stored);
    }
    this.refusals.setDurableSink((refusals) => store.save(this.diskPath, refusals));
    if (reseeded) {
      store.save(this.diskPath, this.refusals.list());
    }
  }
}
`;
