// WP90 / AC2 (structural) + AC5 — WHY THIS IS NOT Ä3.
//
// Ä3 proposed that a refused record be RE-INJECTED VERBATIM into every
// serialization from the last known file version. The Dispatcher rejected that
// clause (`AMENDMENT_DISPOSITION.md` R8) and WP63's charter had already refused
// it in writing. A durable store that keeps a copy of the record's CONTENT is
// that same design wearing a coat: the content would be sitting there, in a
// file this plugin owns, waiting for somebody to write it back.
//
// So the durable record carries IDS, REASONS AND BOUNDARIES ONLY, and that is an
// acceptance criterion rather than a style note. This file asserts it against
// the STORE'S BYTES — not against the store's own reader, which could be
// filtering what it hands back while the file still holds everything.
//
// ── WHAT WOULD MAKE THIS FILE FAIL — two breaks, both executed ───────────────
// BREAK A. Change `projectRefusal` (`seed-refusal-store.ts`) from a field-by-
//   field rebuild to `return { ...candidate }`. Case 3 goes RED: the smuggled
//   fields reach the store bytes. Cases 1 and 2 stay green, correctly — today's
//   refusals carry nothing but the four fields, so the spread has nothing to
//   leak. VERIFIED RED, then restored.
// BREAK B. Make the refusal itself carry the record: `...(source as object)`
//   in the cold-open seed's `refusalsOut?.push({…})` (`canvas-sync.ts`). With
//   BREAK A also in place, cases 1, 2 AND 3 go RED — the user's node text lands
//   in the sidecar file. VERIFIED RED.
// THE PAIR, WHICH IS THE REAL EVIDENCE. With BREAK B still in place and
//   `projectRefusal` RESTORED, all five cases are green again: the refusal
//   object is carrying the user's whole record and the store still holds four
//   fields. The projection is demonstrably what stops it, not the accident that
//   `SeedRefusal` is small today. VERIFIED, then BREAK B restored.
// Case 4 reddens the other way — it is the positive control that proves the
// four kept fields are actually being kept, so a `projectRefusal` that returned
// `null` for everything (which would trivially satisfy "no user text") cannot
// pass this file.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { INGEST_BOUNDARY, type SeedRefusal } from "../../../files/canvas-sync";
import { SeedRefusalStore, projectRefusal } from "../../../files/seed-refusal-store";
import {
  TYPELESS_NODE,
  VALID_NODE,
  canvasJson,
  createIO,
  createRecordingLogger,
  createStoreIO,
} from "./harness";

const DISK = "board.canvas";

/** The four keys a `SeedRefusal` is allowed to contribute to the store. */
const ALLOWED_KEYS = ["boundary", "id", "kind", "reason"];

describe("WP90 — the durable record is ids, reasons and boundaries, and nothing else", () => {
  it("a real refusal reaches the store with exactly four fields", async () => {
    const storeIO = createStoreIO();
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: canvasJson([VALID_NODE, TYPELESS_NODE]) });
    const p = new CanvasPersistence(doc, io, DISK, { logger: log, durableRefusals: store });

    expect(await p.coldOpen(), "the seed never ran — nothing was refused").toBe("seeded-from-file");
    await store.idle();

    const text = storeIO.text();
    expect(text, "the store file was never written").toBeDefined();

    const parsed = JSON.parse(text as string) as { paths: Record<string, unknown[]> };
    const entries = parsed.paths[DISK];
    expect(entries, "the path has no entry in the store").toHaveLength(1);
    expect(Object.keys(entries[0] as object).sort()).toEqual(ALLOWED_KEYS);
    expect(entries[0]).toEqual({
      boundary: INGEST_BOUNDARY.coldOpenSeed,
      kind: "node",
      id: "n-bad",
      reason: "MISSING_TYPE",
    });

    p.destroy();
    doc.destroy();
  });

  it("NO user text, node content or .canvas payload reaches the store bytes", async () => {
    const storeIO = createStoreIO();
    const store = new SeedRefusalStore(storeIO, {});
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [DISK]: before });
    const p = new CanvasPersistence(doc, io, DISK, { durableRefusals: store });

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await store.idle();
    const text = storeIO.text() as string;

    // The refused node's own text, and the surviving node's — neither is a
    // refusal, both are the user's writing.
    expect(text, "the refused record's text was persisted").not.toContain(TYPELESS_NODE.text);
    expect(text, "an unrelated node's text was persisted").not.toContain(VALID_NODE.text);
    // And no fragment of the file itself: a store that held the last known
    // `.canvas` would be Ä3's pass-through with an extra step.
    expect(text, "the .canvas payload was copied into the store").not.toContain('"nodes"');
    expect(text, "the .canvas payload was copied into the store").not.toContain('"width"');

    p.destroy();
    doc.destroy();
  });

  it("a refusal object that CARRIES content leaves it at the door", async () => {
    // The defence has to be structural, not a promise about what `SeedRefusal`
    // happens to contain today: `projectRefusal` rebuilds the object field by
    // field, so a field added later — or smuggled in by a caller — cannot ride
    // along. The cast is the point of the case.
    const smuggled = {
      boundary: INGEST_BOUNDARY.hostSeed,
      kind: "node",
      id: "n-bad",
      reason: "MISSING_TYPE",
      text: "SMUGGLED-USER-TEXT",
      snapshot: { nodes: [{ id: "n-bad", text: "SMUGGLED-USER-TEXT" }] },
    } as unknown as SeedRefusal;

    expect(Object.keys(projectRefusal(smuggled) as object).sort()).toEqual(ALLOWED_KEYS);

    const storeIO = createStoreIO();
    const store = new SeedRefusalStore(storeIO, {});
    await store.saveNow(DISK, [smuggled]);

    const text = storeIO.text() as string;
    expect(text, "a smuggled field reached the durable store").not.toContain("SMUGGLED-USER-TEXT");
    expect(text, "a smuggled field reached the durable store").not.toContain("snapshot");
    expect(text, "the refusal itself was not persisted").toContain("n-bad");
  });

  it("POSITIVE CONTROL — the four kept fields really are kept, in both directions", () => {
    // Without this case, a `projectRefusal` that admitted NOTHING would satisfy
    // every "no user text" assertion above. The gate must be a filter, not a
    // wall.
    const refusal: SeedRefusal = {
      boundary: INGEST_BOUNDARY.coldOpenSeed,
      kind: "edge",
      id: "e-7",
      reason: "MISSING_TO",
    };
    expect(projectRefusal(refusal)).toEqual(refusal);
    expect(projectRefusal(JSON.parse(JSON.stringify(refusal)))).toEqual(refusal);
  });

  it("an entry whose boundary, kind or id is not the real vocabulary is refused", () => {
    // The lift (`isSeedRefusalResolved`) re-asks the ingest gate with exactly
    // `boundary`, `kind` and `id`. A tampered or corrupted value there would ask
    // a different question than the refusal answered, so these three are checked
    // against their definers rather than merely typed.
    const base = {
      boundary: INGEST_BOUNDARY.hostSeed,
      kind: "node",
      id: "n-bad",
      reason: "MISSING_TYPE",
    };
    expect(projectRefusal({ ...base, boundary: "some-other-boundary" })).toBeNull();
    expect(projectRefusal({ ...base, kind: "sticker" })).toBeNull();
    expect(projectRefusal({ ...base, id: "" })).toBeNull();
    expect(projectRefusal({ ...base, id: 7 })).toBeNull();
    expect(projectRefusal({ ...base, reason: "" })).toBeNull();
    expect(projectRefusal(null)).toBeNull();
    expect(projectRefusal("n-bad")).toBeNull();
    // …and the unmodified base still passes, so the five nulls above are the
    // fields being rejected and not the shape.
    expect(projectRefusal(base)).toEqual(base);
  });
});
