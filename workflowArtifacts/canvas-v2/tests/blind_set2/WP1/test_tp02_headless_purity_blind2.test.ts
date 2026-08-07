// WP1 / AC1 — headlessness proven at RUNTIME, with a narrow source check as backup.
//
// Angle of attack: instead of trusting a regex, the ambient capabilities the AC
// forbids are booby-trapped — `Date.now` and `Math.random` are replaced with
// throwing stubs for the duration of one full construct → advance → read → clear
// workload. A module that consults a clock or entropy anywhere on that path fails
// loudly with its own stack, not with a pattern mismatch. The traps are installed
// and removed around the workload only, so the runner's own timing is untouched.
//
// (`document`, `window` and `fs` need no trap: Vitest's default environment is
// node, so a DOM access is already a ReferenceError, and a filesystem call would
// have to come through an import that the source check below forbids.)

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  advanceField,
  advanceRecord,
  clearPath,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  listPaths,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const RAW = readFileSync(new URL("../../../canvas/canvas-shadow.ts", import.meta.url), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The complete public workload — every AC's operation, in one pass. */
function fullWorkload(): string[] {
  const shadow = createSurfaceShadow();
  const out: string[] = [];

  advanceRecord(shadow, "One.canvas", "node", "n1", { x: 3, y: 4, text: "hi" });
  advanceField(shadow, "One.canvas", "node", "n1", "x", 5);
  advanceRecord(shadow, "One.canvas", "edge", "e1", { fromNode: "n1", toNode: "n2" });
  markRecordAbsent(shadow, "One.canvas", "node", "n2");
  advanceField(shadow, "Two.canvas", "node", "n1", "x", 99);

  out.push(String(getField(shadow, "One.canvas", "node", "n1", "x")));
  out.push(getRecordState(shadow, "One.canvas", "node", "n2"));
  out.push(getRecordState(shadow, "One.canvas", "node", "nope"));
  out.push(JSON.stringify(getRecordFields(shadow, "One.canvas", "edge", "e1")));

  clearPath(shadow, "One.canvas");
  out.push(getRecordState(shadow, "One.canvas", "node", "n1"));
  out.push(listPaths(shadow).sort().join(","));
  out.push(String(getField(shadow, "Two.canvas", "node", "n1", "x")));
  return out;
}

const EXPECTED = [
  "5",
  "absent",
  "unknown",
  '{"fromNode":"n1","toNode":"n2"}',
  "unknown",
  "Two.canvas",
  "99",
];

/** Run `fn` with `Date.now` and `Math.random` replaced by throwing stubs. */
function withoutClockOrEntropy<T>(fn: () => T): T {
  const realNow = Date.now;
  const realRandom = Math.random;
  Date.now = () => {
    throw new Error("canvas-shadow read Date.now");
  };
  Math.random = () => {
    throw new Error("canvas-shadow read Math.random");
  };
  try {
    return fn();
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
}

describe("WP1 AC1 — no clock, no entropy, no host capability on any code path", () => {
  it("runs the whole public workload with the clock and entropy booby-trapped", () => {
    expect(withoutClockOrEntropy(fullWorkload)).toEqual(EXPECTED);
  });

  it("produces the identical result with the traps removed (the trap is not the oracle)", () => {
    expect(fullWorkload()).toEqual(EXPECTED);
  });

  it("declares no import of a package and no dynamic import", () => {
    const specifiers = [
      ...[...CODE.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...CODE.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ];
    expect(specifiers.filter((specifier) => !specifier.startsWith("."))).toEqual([]);
    expect(CODE).not.toMatch(/["']obsidian["']|["']yjs["']|["'](?:node:)?fs["']/);
    expect(CODE).not.toMatch(/\bperformance\s*\.\s*now\b|\bnew\s+Date\b/);
  });

  it("keeps no module-level mutable state", () => {
    const topLevel = CODE.split(/\r?\n/).filter((line) => /^(?:let|var)\s/.test(line));
    expect(topLevel).toEqual([]);
  });
});
