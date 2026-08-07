// WP1 / AC1 — headlessness checked line-by-line, plus a behavioural determinism probe.
//
// Different angle from a whole-file regex sweep: the source is split into code
// lines (comments and blank lines removed) and each surviving line is asserted
// individually, so a violation is reported with its own line rather than as a
// single opaque "file matched" failure. The forbidden set is expressed as
// (name, pattern) pairs so a new forbidden capability is one array entry.
//
// The behavioural half asserts what "no clock, no entropy" actually means for a
// caller: replaying the identical operation sequence twice must produce a
// byte-identical serialised snapshot, and the module must expose no async API.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as shadowModule from "../../../canvas/canvas-shadow";
import {
  type ShadowRecordKind,
  type SurfaceShadow,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const RAW = readFileSync(new URL("../../../canvas/canvas-shadow.ts", import.meta.url), "utf8");

/** Source with block comments, line comments and blank lines removed. */
const CODE_LINES = RAW.replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1").trimEnd())
  .filter((line) => line.trim().length > 0);

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["obsidian import", /["']obsidian["']/],
  ["node builtin import", /["']node:[a-z/]+["']/],
  ["fs module", /["']fs(?:\/promises)?["']/],
  ["path module", /["']path["']/],
  ["fs call", /\b(?:readFile|writeFile|readFileSync|writeFileSync|existsSync|mkdir)\b/],
  ["clock", /\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bperformance\s*\.\s*now\b/],
  ["timer", /\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b/],
  ["entropy", /\bMath\s*\.\s*random\b|\bcrypto\b/],
  ["DOM", /\bdocument\b|\bwindow\b|\bHTMLElement\b|\bnavigator\b/],
  ["node process", /\bprocess\s*\.\s*(?:env|cwd|hrtime)\b/],
];

/** Stable textual snapshot of the whole shadow — the determinism oracle. */
function serialise(shadow: SurfaceShadow): string {
  const lines: string[] = [];
  for (const path of [...shadow.paths.keys()].sort()) {
    const pathState = shadow.paths.get(path);
    if (!pathState) continue;
    for (const kind of ["node", "edge"] as ShadowRecordKind[]) {
      for (const id of [...pathState[kind].keys()].sort()) {
        const record = pathState[kind].get(id);
        if (!record) continue;
        const fields = [...record.fields.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([field, value]) => `${field}=${JSON.stringify(value)}`)
          .join(",");
        lines.push(`${path}|${kind}|${id}|${record.state}|${fields}`);
      }
    }
  }
  return lines.join("\n");
}

/** One fixed op script, replayed against a fresh shadow. */
function replay(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  advanceRecord(shadow, "Alpha.canvas", "node", "a", { x: 1, y: 2, text: "one" });
  advanceField(shadow, "Alpha.canvas", "node", "a", "x", 7);
  advanceRecord(shadow, "Alpha.canvas", "edge", "e", { fromNode: "a", toNode: "b" });
  advanceField(shadow, "Beta.canvas", "node", "b", "color", null);
  markRecordAbsent(shadow, "Beta.canvas", "node", "gone");
  return shadow;
}

describe("WP1 AC1 — headless: no Obsidian, no clock, no DOM, no file I/O", () => {
  it("has at least one line of code (the module exists and is not empty)", () => {
    expect(CODE_LINES.length).toBeGreaterThan(0);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`contains no ${label}`, () => {
      const offending = CODE_LINES.filter((line) => pattern.test(line));
      expect(offending).toEqual([]);
    });
  }

  it("imports only relative modules, if it imports at all", () => {
    // Only real module declarations: `... from "x"` or a bare `import "x"`.
    const moduleLines = CODE_LINES.filter((line) =>
      /^\s*(?:import|export)\b[^;]*\bfrom\s*["']/.test(line) || /^\s*import\s*["']/.test(line),
    );
    for (const line of moduleLines) {
      const specifier = /(?:from\s*|^\s*import\s*)["']([^"']+)["']/.exec(line)?.[1] ?? "";
      expect(`${line} → ${specifier.startsWith(".")}`).toBe(`${line} → true`);
    }
  });

  it("exports no async or Promise-returning surface", () => {
    expect(CODE_LINES.some((line) => /\basync\b|\bawait\b/.test(line))).toBe(false);
    for (const exported of Object.values(shadowModule)) {
      if (typeof exported === "function") {
        expect(exported.constructor.name).toBe("Function");
      }
    }
  });

  it("is deterministic: the same op script twice yields identical state", () => {
    const first = serialise(replay());
    const second = serialise(replay());

    expect(second).toBe(first);
    expect(first).toContain("Alpha.canvas|node|a|present|text=\"one\",x=7,y=2");
    expect(first).toContain("Beta.canvas|node|gone|absent|");
  });
});
