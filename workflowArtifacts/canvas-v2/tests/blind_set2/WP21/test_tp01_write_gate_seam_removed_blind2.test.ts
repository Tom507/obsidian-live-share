// WP21 AC1 blind2 — the removal COUNTED, not merely looked for.
//
// A presence check answers "is the name gone?" and stops there. Counting answers
// a stricter question: how many references does each of the three deleted
// artefacts still have, and — the half a presence check cannot state at all —
// how many references do the artefacts that must SURVIVE still have? A removal
// that took `applied.rejected` (WP18's signature list) or the `deleted` tombstone
// container with it reads exactly like a successful removal to a `not.toMatch`.
//
// The angle here is arithmetic over the two named files, plus one structural
// read the other tests do not attempt: the option object `main.ts` hands to
// `CanvasBinding`. WP21 removes the two lock mirrors from that literal and keeps
// `canWrite`, so the literal's KEY SET is the precise statement of the AC — and
// it distinguishes "the mirrors were removed" from "the whole binding wiring was
// removed", which would silently disarm the Phase-3 capture path.
//
// The RAW source is used, not a comment-stripped copy: a comment that still
// explains how `canWriteEntity` gates the capture path is stale documentation of
// a mechanism that no longer exists, and the ARCHITECTURE.md signature table
// makes that kind of residue expensive.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CANVAS_SYNC = readFileSync(
  new URL("../../../files/canvas-sync.ts", import.meta.url),
  "utf8",
);
const MAIN = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8");

const count = (source: string, pattern: RegExp): number =>
  (source.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`)) ?? []).length;

describe("WP21 AC1 blind2 — the deletion counted, and the survivors counted with it", () => {
  it("canvas-sync.ts holds zero references to each deleted artefact", () => {
    expect(count(CANVAS_SYNC, /\bcanWriteEntity\b/), "`canWriteEntity` still has references").toBe(
      0,
    );
    expect(
      count(CANVAS_SYNC, /\bcanWriteNode\b/),
      "the injected write predicate still has references",
    ).toBe(0);
    expect(
      count(CANVAS_SYNC, /\bcanDeleteNode\b/),
      "the injected delete predicate still has references",
    ).toBe(0);
    expect(count(CANVAS_SYNC, /LOCK DENIED:/), "the denial signature is still emitted").toBe(0);
    expect(
      count(CANVAS_SYNC, /\bdenied\b/),
      "the `denied` list of a capture pass still has references",
    ).toBe(0);
    expect(
      count(CANVAS_SYNC, /\bbaseline held\b/i),
      "the baseline-hold is still described as live behaviour",
    ).toBe(0);
  });

  it("the machinery that must survive the deletion still has its references", () => {
    // WP18's rejection signatures live one branch away from the deleted denial
    // list and are the likeliest casualty of a careless delete.
    expect(
      count(CANVAS_SYNC, /\brejected\b/),
      "WP18's rejection-signature list lost all its references",
    ).toBeGreaterThan(2);
    // AC3: the read-only authorisation seam.
    expect(count(CANVAS_SYNC, /\bcanWrite\b/), "`canWrite` (authorisation) lost all references")
      .toBeGreaterThan(2);
    expect(count(CANVAS_SYNC, /setCanWrite\s*\(/), "the `setCanWrite` seam was removed")
      .toBeGreaterThan(0);
    // AC2: the diff-inferred lock claim, and the echo baseline itself — the
    // baseline stays, only its conditional HOLD goes.
    expect(
      count(CANVAS_SYNC, /\bonLocalNodeChange\b/),
      "the diff-inferred lock claim lost all its references",
    ).toBeGreaterThan(1);
    expect(
      count(CANVAS_SYNC, /lastWrittenContent/),
      "the echo baseline itself was deleted — only its conditional HOLD was in scope",
    ).toBeGreaterThan(2);
    expect(
      count(CANVAS_SYNC, /lastWrittenContent\.set\s*\(/),
      "nothing advances the echo baseline any more",
    ).toBeGreaterThan(0);
  });

  it("main.ts hands CanvasBinding the authorisation guard and no lock mirrors", () => {
    const construction = /new CanvasBinding\([\s\S]*?\}\);/.exec(MAIN)?.[0];
    expect(
      construction,
      "the `new CanvasBinding(...)` wiring is gone from main.ts — only its lock mirrors were in scope",
    ).toBeDefined();

    const keys = [...(construction as string).matchAll(/^\s+([A-Za-z]\w*)\s*:/gm)].map((m) => m[1]);
    expect(
      [...keys].sort(),
      "the option literal handed to CanvasBinding is not the post-WP21 key set (`canWrite` stays, the two lock mirrors go)",
    ).toEqual(["canWrite", "logger", "path"]);
  });

  it("main.ts injects no lock predicate into CanvasSync, and still injects the rest", () => {
    expect(count(MAIN, /setCanWriteNode\s*\(/), "main.ts still injects a lock write-gate").toBe(0);
    expect(count(MAIN, /setCanDeleteNode\s*\(/), "main.ts still injects a lock delete-gate").toBe(
      0,
    );
    expect(
      count(MAIN, /setCanWrite\s*\(/),
      "AC3: main.ts stopped injecting the authorisation guard",
    ).toBe(1);
    expect(
      count(MAIN, /setOnLocalNodeChange\s*\(/),
      "AC2: main.ts stopped wiring the diff-inferred lock claim",
    ).toBe(1);
    expect(
      count(MAIN, /\bcanvasPresences\b/),
      "the presence controllers were unwired from main.ts — locks are UX and stay",
    ).toBeGreaterThan(3);
  });
});
