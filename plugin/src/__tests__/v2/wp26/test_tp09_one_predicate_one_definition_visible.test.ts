// WP26 / AC3 — "expressed as one predicate with one definition, in the same style
// as the existing `.canvas` exclusion, and its consumers are enumerated in the
// code comment."
//
// Half of AC3 is a SOURCE-STRUCTURE claim, so the source is the honest oracle for
// exactly that half and for nothing else. No behavioural claim is faked with a
// grep here: the behaviour lives in tp01–tp08.
//
// The defect class this pins is the one the batch's shared-ownership contract was
// written for and that `skipsAutoTextSync`'s own comment records ("four private
// copies of `path.endsWith('.canvas')` is exactly how this defect class
// propagated"): a second, independently spelt copy of the exclusion that drifts
// from the first while both test suites stay green because neither spans the
// disagreement. WP24 owns `SIDECAR_DIR` and `isSidecarPath`; WP26 consumes them.
//
// The module is located by walking up from this file to the repo root, so these
// assertions survive being staged elsewhere.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SIDECAR_DIR } from "../../../files/canvas-sidecar";

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

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
      productionFiles(join(dir, entry.name), out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Comments may legitimately NAME the directory; code may not re-spell it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FILES = productionFiles(SRC).map((path) => ({
  path,
  name: path.slice(SRC.length + 1).replace(/\\/g, "/"),
  raw: readFileSync(path, "utf8"),
}));

const OWNER = "files/canvas-sidecar.ts";

describe("WP26 AC3 — one definition, not a second private copy", () => {
  it("the sidecar directory literal is spelt in exactly one production module", () => {
    const spellers = FILES.filter((file) => stripComments(file.raw).includes(SIDECAR_DIR)).map(
      (file) => file.name,
    );
    expect(spellers).toEqual([OWNER]);
  });

  it("`isSidecarPath` is defined exactly once, in the module that owns it", () => {
    const definers = FILES.filter((file) =>
      /(?:export\s+)?(?:function|const)\s+isSidecarPath\b/.test(stripComments(file.raw)),
    ).map((file) => file.name);
    expect(definers).toEqual([OWNER]);
  });

  it("`skipsAutoTextSync` is still defined exactly once, in `utils.ts`", () => {
    const definers = FILES.filter((file) =>
      /(?:export\s+)?(?:function|const)\s+skipsAutoTextSync\b/.test(stripComments(file.raw)),
    ).map((file) => file.name);
    expect(definers).toEqual(["utils.ts"]);
  });

  it("no production module rebuilds the sidecar test out of its own parts", () => {
    // `.obsidian/liveshare` re-spelt with a different tail, or `"liveshare"` and
    // `"state"` concatenated at a call site, are both a second definition.
    const head = SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/"));
    const rebuilders = FILES.filter(
      (file) => file.name !== OWNER && stripComments(file.raw).includes(head),
    ).map((file) => file.name);
    expect(rebuilders).toEqual([]);
  });
});

describe("WP26 AC3 — the consumers are enumerated in the contract comment", () => {
  const utils = FILES.find((file) => file.name === "utils.ts");
  const contractComment = (() => {
    const source = utils?.raw ?? "";
    const at = source.search(/(?:export\s+)?function\s+skipsAutoTextSync\b/);
    if (at < 0) return "";
    const before = source.slice(0, at);
    const start = before.lastIndexOf("/**");
    return start < 0 ? "" : before.slice(start);
  })();

  it("the predicate still carries a contract comment", () => {
    expect(contractComment.length).toBeGreaterThan(200);
  });

  it("the comment documents the sidecar exclusion rather than starting a parallel one", () => {
    expect(contractComment).toMatch(/sidecar/i);
    expect(contractComment).toMatch(/isSidecarPath|canvas-sidecar/);
  });

  it("the comment names every consumer module of the exclusion", () => {
    expect(contractComment).toContain("background-sync.ts");
    expect(contractComment).toContain("manifest.ts");

    // Whatever other production module ends up importing WP24's predicate is a
    // consumer too, and AC3 says the comment enumerates them.
    for (const file of FILES) {
      if (file.name === OWNER || file.name === "utils.ts") continue;
      if (!/\bisSidecarPath\b/.test(stripComments(file.raw))) continue;
      const basename = file.name.slice(file.name.lastIndexOf("/") + 1);
      expect(contractComment, `undocumented consumer: ${file.name}`).toContain(basename);
    }
  });
});
