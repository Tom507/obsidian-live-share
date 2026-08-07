// WP24 / AC4 blind1 — purity attacked from the EXPORT side and from the
// import-block side, rather than by scanning the whole file for banned tokens.
//
// Different angle: AC4 can be defeated without ever writing `node:fs` in this
// module — by exporting a concrete adapter (`createVaultSidecarIO`,
// `createNodeSidecarIO`, …) that imports Obsidian or fs somewhere else and is
// then imported back here for a "convenient default". The visible test's token
// scan sees nothing wrong with that. So this test pins two things the token
// scan does not: the module's import block contains exactly the specifiers it
// is licensed to contain, and its export list contains no concrete-adapter
// factory. The production wiring lives in WP25, which is where an adapter
// belongs.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as sidecar from "../../../../../plugin/src/files/canvas-sidecar";

const SOURCE = readFileSync(
  new URL("../../../../../plugin/src/files/canvas-sidecar.ts", import.meta.url),
  "utf8",
);

/** Everything before the first statement that is not an import or a comment. */
function importBlock(source: string): string {
  const lines = source.split(/\r?\n/);
  const kept: string[] = [];
  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      kept.push(line);
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      kept.push(line);
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("*")) {
      kept.push(line);
      continue;
    }
    if (/^(import|export\s+type\s*\{|export\s*\{)/.test(trimmed) || /^[}\w,*\s]+from\s/.test(trimmed)) {
      kept.push(line);
      continue;
    }
    break;
  }
  return kept.join("\n");
}

function specifiers(source: string): string[] {
  return [...source.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("WP24 AC4 blind1 — the import block is exactly what it is licensed to be", () => {
  it("imports only `yjs` and relative modules, nothing else", () => {
    const found = specifiers(importBlock(SOURCE));
    const illegal = found.filter(
      (s) => s !== "yjs" && !s.startsWith("./") && !s.startsWith("../"),
    );
    expect(illegal).toEqual([]);
  });

  it("no dynamic import and no require anywhere in the file", () => {
    expect(SOURCE).not.toMatch(/\bimport\s*\(/);
    expect(SOURCE).not.toMatch(/\brequire\s*\(/);
    expect(SOURCE).not.toMatch(/createRequire/);
  });

  it("names no filesystem or Obsidian symbol outside a comment", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/["'](?:node:)?fs\b/);
    expect(code).not.toMatch(/["']obsidian["']/);
    expect(code).not.toMatch(/\bnormalizePath\b|\bTFile\b|\bTAbstractFile\b/);
    expect(code).not.toMatch(/\bBuffer\b/);
  });
});

describe("WP24 AC4 blind1 — the export list offers no way back to a real disk", () => {
  it("exports the pinned surface", () => {
    for (const name of [
      "SIDECAR_DIR",
      "SIDECAR_HISTORY_EXT",
      "SIDECAR_CHECKPOINT_EXT",
      "SIDECAR_INDEX_FILENAME",
      "SIDECAR_DEGRADATION",
      "SIDECAR_LOAD_ORIGIN",
      "isSidecarPath",
      "isSidecarDegraded",
      "sidecarHistoryPath",
      "sidecarCheckpointPath",
      "sidecarIndexPath",
      "createSidecarStore",
    ]) {
      expect(Object.hasOwn(sidecar, name), `missing export: ${name}`).toBe(true);
    }
  });

  it("exports no concrete IO adapter or default IO instance", () => {
    const offenders = Object.keys(sidecar).filter((name) =>
      /(vault|node|fs|disk|real|default)io|io(vault|node|fs|default)|adapter/i.test(name),
    );
    expect(offenders).toEqual([]);
  });

  it("createSidecarStore is the only exported factory", () => {
    const factories = Object.keys(sidecar).filter(
      (name) => /^create/.test(name) && typeof (sidecar as Record<string, unknown>)[name] === "function",
    );
    expect(factories).toEqual(["createSidecarStore"]);
  });
});
