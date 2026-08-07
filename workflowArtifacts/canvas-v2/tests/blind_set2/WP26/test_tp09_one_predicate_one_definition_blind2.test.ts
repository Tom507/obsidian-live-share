// WP26 / AC3 blind 2 — "its consumers are enumerated in the code comment",
// attacked as a COMPLETENESS check derived from the code itself.
//
// Different angle: blind 1 asserts that two known consumer file names appear in
// the contract comment — a list that goes stale the moment a consumer is added or
// moved. This one derives the consumer set from the source: every production
// module that actually calls the exclusion (either `skipsAutoTextSync` or WP24's
// `isSidecarPath`) is a consumer, and every one of them must be named in the
// comment. The comment must also not name a module that is NOT one, because a
// contract comment that lists a call site which no longer exists is exactly the
// stale documentation the enumeration requirement is there to prevent.
//
// Set equality in both directions, computed from the tree — so the assertion
// cannot rot and cannot be satisfied by naming two files and stopping.
//
// The reverse-direction half is deliberately tolerant of one thing: the comment
// may name the OWNING module of the predicate it delegates to (`canvas-sidecar.ts`)
// without that module being a call site, because AC3 also asks for one definition
// and pointing at it is how a reader finds it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

const MODULES = walk(SRC).map((path) => {
  const raw = readFileSync(path, "utf8");
  const name = path.slice(SRC.length + 1).replace(/\\/g, "/");
  return {
    name,
    basename: name.slice(name.lastIndexOf("/") + 1),
    raw,
    code: stripComments(raw),
  };
});

const OWNER_BASENAME = "canvas-sidecar.ts";
const HOME_BASENAME = "utils.ts";

/** A consumer CALLS the exclusion; the module that defines it is not one. */
const CONSUMERS = MODULES.filter((module) => {
  if (module.basename === HOME_BASENAME) return false;
  if (module.basename === OWNER_BASENAME) return false;
  return /\bskipsAutoTextSync\s*\(/.test(module.code) || /\bisSidecarPath\s*\(/.test(module.code);
})
  .map((module) => module.basename)
  .sort();

const CONTRACT_COMMENT = (() => {
  const utils = MODULES.find((module) => module.basename === HOME_BASENAME);
  const source = utils?.raw ?? "";
  const at = source.search(/(?:export\s+)?function\s+skipsAutoTextSync\b/);
  if (at < 0) return "";
  const before = source.slice(0, at);
  const start = before.lastIndexOf("/**");
  return start < 0 ? "" : before.slice(start);
})();

/** Every `*.ts` basename the comment mentions. */
const NAMED_IN_COMMENT = [
  ...new Set(
    [...CONTRACT_COMMENT.matchAll(/([a-z0-9-]+\.ts)\b/gi)].map((match) => match[1]),
  ),
].sort();

describe("WP26 AC3 blind2 — the enumeration is derived from the code, both ways", () => {
  it("the exclusion has at least two consumer modules and a contract comment", () => {
    expect(CONSUMERS.length).toBeGreaterThanOrEqual(2);
    expect(CONTRACT_COMMENT.length).toBeGreaterThan(200);
  });

  it("every real consumer module is named in the contract comment", () => {
    const undocumented = CONSUMERS.filter((basename) => !CONTRACT_COMMENT.includes(basename));
    expect(undocumented).toEqual([]);
  });

  it("every module the comment names is a real consumer (or the owning module)", () => {
    const allowed = new Set([...CONSUMERS, OWNER_BASENAME, HOME_BASENAME]);
    const phantom = NAMED_IN_COMMENT.filter((basename) => !allowed.has(basename));
    expect(phantom).toEqual([]);
  });

  it("the comment describes what the exclusion now covers, not only the canvas half", () => {
    expect(CONTRACT_COMMENT).toMatch(/sidecar/i);
    expect(CONTRACT_COMMENT).toMatch(/isSidecarPath|canvas-sidecar/);
  });

  it("the predicate itself has exactly one definition in the tree", () => {
    const definers = MODULES.filter((module) =>
      /(?:export\s+)?function\s+skipsAutoTextSync\b/.test(module.code),
    ).map((module) => module.name);
    expect(definers).toEqual([HOME_BASENAME]);
  });

  it("and it is still exported, so the consumers can share the one copy", () => {
    const utils = MODULES.find((module) => module.basename === HOME_BASENAME);
    expect(utils?.code).toMatch(/export\s+function\s+skipsAutoTextSync\b/);
  });
});

describe("WP26 AC3 blind2 — a second private copy is detectable by shape, not only by name", () => {
  // Two call sites branch on `.canvas` for reasons that are NOT the auto-text-sync
  // decision, and both predate WP26: `vault-events.ts` (the R10 fallback WARNING
  // and the canvas-ownership routing) and `main.ts` (its own canvas branch). They
  // are enumerated here so the assertion pins the exact set rather than a count —
  // a NEW private copy anywhere, including a third one in either of these files,
  // still turns it red.
  const PERMITTED = ["files/vault-events.ts", "main.ts"];

  it("no production module outside utils.ts gains a private canvas-extension test", () => {
    const offenders = MODULES.filter((module) => {
      if (module.basename === HOME_BASENAME) return false;
      return /\.(?:endsWith|startsWith)\s*\(\s*["'`]\.canvas["'`]\s*\)/.test(module.code);
    }).map((module) => module.name);
    expect(offenders.sort()).toEqual([...PERMITTED].sort());
  });

  it("neither permitted file grew a SECOND such test", () => {
    for (const name of PERMITTED) {
      const module = MODULES.find((candidate) => candidate.name === name);
      if (!module) continue;
      const hits = module.code.match(/\.(?:endsWith|startsWith)\s*\(\s*["'`]\.canvas["'`]\s*\)/g);
      expect(hits?.length ?? 0, `${name} canvas-extension tests`).toBeLessThanOrEqual(
        name === "files/vault-events.ts" ? 2 : 1,
      );
    }
  });
});
