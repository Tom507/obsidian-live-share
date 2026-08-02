// WP26 / AC3 blind 1 — "one predicate with one definition", attacked from the
// IMPORT GRAPH rather than from a literal count.
//
// Different angle: the visible test counts spellings of the directory string. That
// catches a copy/pasted constant but not a re-DERIVED one — a module that writes
// its own `path.startsWith(".obsidian/liveshare")`, or that rebuilds the test out
// of `SIDECAR_DIR` plus its own boundary logic, has a second definition of the
// PREDICATE even though the constant is imported exactly once. AC3's subject is
// the predicate, not the string.
//
// So this test looks at what each production module does with what it imported:
// every module that imports from the sidecar module must obtain its verdict by
// CALLING the shared predicate, and no module outside the owner may contain a
// prefix, suffix or segment test written against the directory constant.
//
// The owner module is located by walking up to the repo root, so these assertions
// survive being staged elsewhere.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SIDECAR_DIR } from "../../../../../plugin/src/files/canvas-sidecar";

function pluginSrc(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    try {
      statSync(join(dir, "plugin", "src", "utils.ts"));
      return join(dir, "plugin", "src");
    } catch {
      // keep walking
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate plugin/src");
}

const SRC = pluginSrc();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
      walk(join(dir, entry.name), out);
    } else if (entry.name.endsWith(".ts")) out.push(join(dir, entry.name));
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const OWNER = "files/canvas-sidecar.ts";

const MODULES = walk(SRC).map((path) => {
  const raw = readFileSync(path, "utf8");
  return {
    name: path.slice(SRC.length + 1).replace(/\\/g, "/"),
    raw,
    code: stripComments(raw),
  };
});

const OTHERS = MODULES.filter((module) => module.name !== OWNER);

describe("WP26 AC3 blind1 — no module outside the owner re-derives the predicate", () => {
  it("the sidecar module exists and exports the shared predicate", () => {
    const owner = MODULES.find((module) => module.name === OWNER);
    expect(owner, "files/canvas-sidecar.ts is missing").toBeDefined();
    expect(owner?.code).toMatch(/export\s+function\s+isSidecarPath\b/);
    expect(owner?.code).toContain(SIDECAR_DIR);
  });

  it("no other module writes a boundary test against the directory constant", () => {
    // `startsWith(SIDECAR_DIR)`, `${SIDECAR_DIR}/`, `split(SIDECAR_DIR)`, an
    // `indexOf` or a `RegExp` built from it — all are second definitions.
    const patterns = [
      /\bstartsWith\s*\(\s*(?:`?\$?\{?\s*)?SIDECAR_DIR/,
      /\bindexOf\s*\(\s*SIDECAR_DIR/,
      /\bincludes\s*\(\s*SIDECAR_DIR/,
      /\bsplit\s*\(\s*SIDECAR_DIR/,
      /new\s+RegExp\s*\([^)]*SIDECAR_DIR/,
      /`\$\{SIDECAR_DIR\}\/`\s*\)/,
    ];
    const offenders = OTHERS.filter((module) =>
      patterns.some((pattern) => pattern.test(module.code)),
    ).map((module) => module.name);
    expect(offenders).toEqual([]);
  });

  it("no other module hand-writes the directory as a string literal", () => {
    const offenders = OTHERS.filter((module) => module.code.includes(SIDECAR_DIR)).map(
      (module) => module.name,
    );
    expect(offenders).toEqual([]);
  });

  it("no other module hand-writes the directory's parent as a string literal", () => {
    const parent = SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/"));
    const offenders = OTHERS.filter((module) => module.code.includes(parent)).map(
      (module) => module.name,
    );
    expect(offenders).toEqual([]);
  });

  it("every module that names the predicate obtains it by import, not by definition", () => {
    for (const module of OTHERS) {
      if (!/\bisSidecarPath\b/.test(module.code)) continue;
      expect(
        /(?:export\s+)?(?:function|const|let|var)\s+isSidecarPath\b/.test(module.code),
        `${module.name} defines its own isSidecarPath`,
      ).toBe(false);
      expect(module.code, `${module.name} does not import isSidecarPath`).toMatch(
        /import[\s\S]{0,200}?isSidecarPath[\s\S]{0,200}?canvas-sidecar/,
      );
    }
  });
});

describe("WP26 AC3 blind1 — the contract comment still carries the whole story", () => {
  const utils = MODULES.find((module) => module.name === "utils.ts");
  const comment = (() => {
    const source = utils?.raw ?? "";
    const at = source.search(/(?:export\s+)?function\s+skipsAutoTextSync\b/);
    if (at < 0) return "";
    const before = source.slice(0, at);
    const start = before.lastIndexOf("/**");
    return start < 0 ? "" : before.slice(start);
  })();

  it("there is exactly one contract comment, attached to the predicate", () => {
    expect(comment).toMatch(/^\/\*\*/);
    expect(comment.length).toBeGreaterThan(200);
  });

  it("it names the replica-state exclusion", () => {
    expect(comment).toMatch(/sidecar/i);
  });

  it("it still names the R10 fallback exception it always documented", () => {
    // AC3 says EXTEND the comment. A rewrite that drops the documented
    // non-consumer has replaced the contract rather than extended it.
    expect(comment).toMatch(/subscribe/);
    expect(comment).toMatch(/R10|fallback/i);
  });

  it("it enumerates the consumer modules by file name", () => {
    for (const basename of ["background-sync.ts", "manifest.ts"]) {
      expect(comment, `consumer not enumerated: ${basename}`).toContain(basename);
    }
  });
});
