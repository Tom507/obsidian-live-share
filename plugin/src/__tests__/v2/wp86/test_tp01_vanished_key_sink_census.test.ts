// WP86 / AC1 — THE CENSUS IS DERIVED FROM THE TREE, NOT HAND-WRITTEN.
//
// This work package exists because a hand-written list was used once already:
// WP80 read ONE destructive sink reachable from a manifest change, hardened the
// producing side, and its own RED run then destroyed a canary through a sink
// nobody had enumerated. The run hardened one door twice while a second stood
// open beside it.
//
// So the list of "every site reachable from a manifest KEY REMOVAL to a
// destructive local write" is derived from `plugin/src/` by this test and
// asserted against a pinned disposition table, in which every site is either
// GATED (naming its gate) or EXPLICITLY DISPOSITIONED OUT OF SCOPE (naming
// why). A sixth site appearing is a test FAILURE, not a silent addition.
//
// Rule 15 is honoured twice over:
//   - the sink pattern is shown able to match every known-present site
//     (`tp01f`), so an empty census can never be read as "there are no sinks";
//   - the deriver is shown to DETECT an injected destructive call in a
//     manifest-reachable function (`tp01e`), so a census that cannot find a new
//     door cannot claim anything about the doors it lists.
//
// Scope note, deliberate: the census covers the functions a manifest key
// removal can reach — the two `Y.Map`/meta observers' consumers and the direct
// `cleanupStaleFiles()` entry points. The file-op delete route (`file-ops.ts`)
// is NOT manifest-reachable (it carries a path and a type and never reads the
// manifest) and is another agent's file this batch; it is asserted to be absent
// from the manifest-reachable set rather than pinned as a row.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function findPluginSrc(): string {
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

const SRC = findPluginSrc();

/**
 * Every destructive local write this project can perform. Kept as one pattern
 * so the census cannot be narrowed by spelling: `trashFile` is the one the
 * defect used, but `vault.rename` moves a user's file, `vault.delete` /
 * `vault.trash` / `adapter.remove` erase one, and `vault.modify` /
 * `modifyBinary` overwrite its bytes.
 */
const SINK_PATTERN =
  /\b(?:fileManager\.trashFile|vault\.delete|vault\.trash|vault\.rename|adapter\.remove|adapter\.trashLocal|adapter\.trashSystem|vault\.modifyBinary|vault\.modify)\s*\(/g;

/**
 * The functions a manifest KEY REMOVAL can reach. Derived from the two
 * observers the manifest document carries (`meta.observe` and
 * `manifest.observe`) plus the direct `cleanupStaleFiles()` session entries.
 */
const MANIFEST_REACHABLE: { file: string; fn: string }[] = [
  { file: "main.ts", fn: "processManifestChange" },
  { file: "main.ts", fn: "registerManifestChangeHandler" },
  { file: "main.ts", fn: "armStaleReconcileRetry" },
  { file: "main.ts", fn: "cleanupStaleFiles" },
  { file: "files/manifest.ts", fn: "syncFromManifest" },
];

/**
 * THE PINNED DISPOSITION TABLE. Every row is either gated — naming its gate —
 * or explicitly out of scope, naming why. `route` matches §3 Verification 1 of
 * the charter.
 */
const PINNED: {
  file: string;
  fn: string;
  sink: string;
  route: string;
  disposition: "gated" | "out-of-scope";
  gate: string;
}[] = [
  {
    file: "main.ts",
    fn: "processManifestChange",
    sink: "vault.rename(",
    route: "R2 — the rename-pairing arm",
    disposition: "gated",
    gate:
      "decideManifestRename: a CONTENT-IDENTITY pair from matchRenamesByHash is required " +
      "(preferred === newPath), the removed path must hold a TFile, and the new path must be free",
  },
  {
    file: "main.ts",
    fn: "cleanupStaleFiles",
    sink: "fileManager.trashFile(",
    route: "R3/R4 — the stale reconcile",
    disposition: "gated",
    gate:
      "D2 evidence gate: host refusal, hasFreshPublication(excluding self) past seqAtConnect, " +
      "a peer present claiming host, and D3's manifest.size === 0 floor",
  },
  {
    file: "files/manifest.ts",
    fn: "syncFromManifest",
    sink: "vault.modify(",
    route: "R5 — the presence-driven content overwrite",
    disposition: "out-of-scope",
    gate:
      "driven by an entry's PRESENCE and hash difference, not by an absence — a different class " +
      "from WP86's, and adjacent to WP83/WP85. Recorded, not repaired. Owner: none assigned",
  },
];

interface Site {
  file: string;
  fn: string;
  sink: string;
  line: number;
}

/** Extract one function body by brace matching from its declaration onwards. */
function functionBody(source: string, fn: string): { body: string; offset: number } {
  const decl = new RegExp(
    `(?:^|\\n)\\s*(?:public |private |protected )?(?:async )?${fn}\\s*[(<]`,
    "m",
  );
  const match = decl.exec(source);
  if (!match) throw new Error(`function ${fn} not found`);
  // Walk the PARAMETER LIST first. A type literal in the signature
  // (`options?: { skipText?: boolean }`) is a `{` that is not the body, and
  // taking it would silently yield an almost-empty body — a census that finds
  // nothing because it looked in the wrong place.
  const parenOpen = source.indexOf("(", match.index);
  if (parenOpen < 0) throw new Error(`no parameter list for ${fn}`);
  let parenDepth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        parenClose = i;
        break;
      }
    }
  }
  if (parenClose < 0) throw new Error(`unbalanced parameter list for ${fn}`);
  const open = source.indexOf("{", parenClose);
  if (open < 0) throw new Error(`no body for ${fn}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { body: source.slice(open, i + 1), offset: open };
    }
  }
  throw new Error(`unbalanced body for ${fn}`);
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

function deriveCensus(sources: Map<string, string>): Site[] {
  const sites: Site[] = [];
  for (const { file, fn } of MANIFEST_REACHABLE) {
    const source = sources.get(file);
    if (source === undefined) throw new Error(`missing source for ${file}`);
    const stripped = stripComments(source);
    let body: { body: string; offset: number };
    try {
      body = functionBody(stripped, fn);
    } catch {
      // A named entry point that no longer exists is itself a census change,
      // reported as a synthetic row so the pinned table cannot silently pass.
      sites.push({ file, fn, sink: "<function missing>", line: -1 });
      continue;
    }
    SINK_PATTERN.lastIndex = 0;
    for (const m of body.body.matchAll(SINK_PATTERN)) {
      const abs = body.offset + (m.index ?? 0);
      sites.push({
        file,
        fn,
        sink: m[0].replace(/\s+/g, ""),
        line: stripped.slice(0, abs).split("\n").length,
      });
    }
  }
  return sites;
}

function loadSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of new Set(MANIFEST_REACHABLE.map((entry) => entry.file))) {
    sources.set(file, readFileSync(join(SRC, file), "utf8"));
  }
  return sources;
}

const key = (site: { file: string; fn: string; sink: string }) =>
  `${site.file}::${site.fn}::${site.sink}`;

describe("WP86 AC1 — the vanished-key -> destructive-sink census, derived from the tree", () => {
  it("tp01a: every derived site is in the pinned disposition table", () => {
    const derived = deriveCensus(loadSources());
    const pinned = new Set(PINNED.map(key));
    const unpinned = derived.filter((site) => !pinned.has(key(site)));
    expect(
      unpinned.map((site) => `${site.file}:${site.line} ${site.fn} -> ${site.sink}`),
    ).toStrictEqual([]);
  });

  it("tp01b: every pinned row is still present in the tree", () => {
    const derived = new Set(deriveCensus(loadSources()).map(key));
    const missing = PINNED.filter((row) => !derived.has(key(row)));
    expect(missing.map(key)).toStrictEqual([]);
  });

  it("tp01c: every pinned row is either gated with a named gate, or explicitly out of scope", () => {
    for (const row of PINNED) {
      expect(["gated", "out-of-scope"]).toContain(row.disposition);
      expect(row.gate.length).toBeGreaterThan(20);
      expect(row.route.length).toBeGreaterThan(0);
    }
  });

  it("tp01d: R1's unguarded trash sink is GONE from the manifest-change handler", () => {
    const source = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    const body = functionBody(source, "processManifestChange").body;
    expect(body).not.toMatch(/fileManager\.trashFile\s*\(/);
    // ... and the destruction is delegated to the ONE landed gated sink.
    expect(body).toMatch(/this\.cleanupStaleFiles\(\)/);
  });

  it("tp01e: POSITIVE CONTROL — an injected destructive call in a manifest-reachable path is detected", () => {
    const sources = loadSources();
    const original = sources.get("main.ts") as string;
    const marker = "this.armCanvasMirrorPass();";
    expect(original).toContain(marker);
    const injected = original.replace(
      marker,
      "await this.app.fileManager.trashFile(injectedCanary);\n    " + marker,
    );
    sources.set("main.ts", injected);
    const derived = deriveCensus(sources);
    const pinned = new Set(PINNED.map(key));
    const unpinned = derived.filter((site) => !pinned.has(key(site)));
    expect(unpinned.length).toBeGreaterThan(0);
    expect(unpinned.map((site) => site.sink)).toContain("fileManager.trashFile(");
  });

  it("tp01f: RULE 15 — the sink pattern can match every known-present sink spelling", () => {
    const knownPresent = [
      "await this.app.fileManager.trashFile(file);",
      "await this.app.vault.rename(oldFile, localNew);",
      "await this.vault.modify(file, content);",
      "await this.vault.modifyBinary(file, data);",
      "await this.vault.delete(file);",
      "await this.vault.trash(file, true);",
      "await this.vault.adapter.remove(path);",
    ];
    for (const line of knownPresent) {
      SINK_PATTERN.lastIndex = 0;
      expect(SINK_PATTERN.test(line), `pattern failed to match: ${line}`).toBe(true);
    }
    // ... and it does not fire on an innocent line, so a match means something.
    SINK_PATTERN.lastIndex = 0;
    expect(SINK_PATTERN.test("const file = this.app.vault.getAbstractFileByPath(p);")).toBe(false);
  });

  it("tp01g: the function-body extractor is honest — it finds the known bodies and rejects an unknown name", () => {
    const source = stripComments(readFileSync(join(SRC, "main.ts"), "utf8"));
    for (const fn of ["processManifestChange", "cleanupStaleFiles", "armStaleReconcileRetry"]) {
      expect(functionBody(source, fn).body.length).toBeGreaterThan(50);
    }
    expect(() => functionBody(source, "thisFunctionDoesNotExist")).toThrow();
  });

  it("tp01h: the file-op delete route is NOT manifest-reachable — it reads no manifest at all", () => {
    const fileOps = stripComments(readFileSync(join(SRC, "files/file-ops.ts"), "utf8"));
    // Rule 15: the pattern is shown able to match a known-present manifest
    // reference before its absence here is reported as meaningful.
    const manifestRef = /manifestManager|getEntries\(\)|hasFreshPublication|getPublication\(\)/;
    expect(manifestRef.test(stripComments(readFileSync(join(SRC, "main.ts"), "utf8")))).toBe(true);
    expect(manifestRef.test(fileOps)).toBe(false);
  });
});
