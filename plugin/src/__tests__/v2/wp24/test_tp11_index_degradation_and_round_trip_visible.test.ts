// WP24 / AC3 applied to the third sidecar file — `index.json`.
//
// `index.json` is named in C24's interface list but in none of the four ACs,
// which is exactly the situation Shared Ownership Contract §0 warns about: a
// shared file with no owner gets two incompatible spellings from two WPs and
// both suites pass. WP24 owns the file, its JSON encoding and its degradation
// behaviour; WP27 owns what the mapping MEANS. This file pins the first half.
//
// The degradation rule is the same one AC3 states for the other two files, and
// it is worth its own test because the failure mode is different: `JSON.parse`
// throws synchronously on a half-written file, so a store that forgets the
// guard takes the whole plugin down at startup rather than degrading.

import { describe, expect, it } from "vitest";

import { createSidecarStore, sidecarIndexPath } from "../../../files/canvas-sidecar";
import { createFakeIO, fromUtf8, utf8 } from "./harness";

const MAPPING = {
  "0f2a9c6e-1b4d-47aa-9d31-6c0e2f8b5a70": "Boards/Roadmap.canvas",
  "7d1b4f30-88c2-4f19-b0a5-2e9c7a441d63": "Archive/2025 Retro.canvas",
};

describe("WP24 — index.json round-trips", () => {
  it("writeIndex then readIndex returns the same mapping", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    await store.writeIndex(MAPPING);

    expect(await store.readIndex()).toEqual(MAPPING);
  });

  it("writes it as UTF-8 JSON at sidecarIndexPath(), through `write` not `append`", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    await store.writeIndex(MAPPING);

    const raw = io.files.get(sidecarIndexPath());
    expect(raw).toBeDefined();
    expect(JSON.parse(fromUtf8(raw as Uint8Array))).toEqual(MAPPING);
    // An appended index would grow without bound and stop being parseable on
    // the second write — the end state of one write cannot tell the difference.
    const ops = io.calls.filter((c) => c.path === sidecarIndexPath() && c.phase === "start");
    expect(ops.map((c) => c.op)).toEqual(["write"]);
  });

  it("a second write replaces rather than merges", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    await store.writeIndex(MAPPING);
    await store.writeIndex({ "aaa-bbb": "Only/This.canvas" });

    expect(await store.readIndex()).toEqual({ "aaa-bbb": "Only/This.canvas" });
  });
});

describe("WP24 AC3 — a missing or corrupt index.json degrades, never throws", () => {
  it("a missing index reads as an empty mapping and creates no file", async () => {
    const io = createFakeIO();
    const store = createSidecarStore(io);

    expect(await store.readIndex()).toEqual({});
    expect(io.mutationTrace()).toEqual([]);
    expect(io.files.has(sidecarIndexPath())).toBe(false);
  });

  it("a half-written index reads as an empty mapping", async () => {
    const io = createFakeIO({
      [sidecarIndexPath()]: utf8('{"0f2a9c6e-1b4d-47aa-9d31-6c0e2f8b5a70": "Boards/Roa'),
    });
    const store = createSidecarStore(io);

    expect(await store.readIndex()).toEqual({});
  });

  it("a syntactically valid but wrongly-shaped index reads as an empty mapping", async () => {
    // A JSON array parses fine and then breaks every consumer that does
    // `index[guid]`. Shape is part of the contract, not just syntax.
    const io = createFakeIO({ [sidecarIndexPath()]: utf8('["not", "a", "mapping"]') });
    const store = createSidecarStore(io);

    expect(await store.readIndex()).toEqual({});
  });

  it("drops non-string entries instead of handing them to consumers", async () => {
    const io = createFakeIO({
      [sidecarIndexPath()]: utf8('{"good": "A.canvas", "bad": 17, "worse": {"path": "B.canvas"}}'),
    });
    const store = createSidecarStore(io);

    expect(await store.readIndex()).toEqual({ good: "A.canvas" });
  });

  it("an empty file reads as an empty mapping", async () => {
    const io = createFakeIO({ [sidecarIndexPath()]: new Uint8Array(0) });
    const store = createSidecarStore(io);

    expect(await store.readIndex()).toEqual({});
  });

  it("a corrupt index is left on disk, not silently overwritten", async () => {
    const broken = utf8("{{{ not json");
    const io = createFakeIO({ [sidecarIndexPath()]: broken });
    const store = createSidecarStore(io);

    await store.readIndex();

    expect(io.mutationTrace()).toEqual([]);
    expect(io.files.get(sidecarIndexPath())).toEqual(broken);
  });
});
