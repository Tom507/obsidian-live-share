// WP25 / AC3 blind1 (GC half) — attacked through a RICH TEXT payload and a
// three-generation history, not through a single marker on a single card.
//
// Different angle from the visible test in three ways:
//
//   1. The garbage is deep — a `Y.Text` inside a record — so an implementation
//      that re-encodes only the top-level map values, or that copies records
//      into a fresh container by hand, cannot accidentally pass.
//   2. The doc goes through THREE compaction generations with edits in between,
//      so a checkpoint that quietly accumulates the previous generation's
//      deleted content shows up as growth rather than as a single boolean.
//   3. The oracle is applied to a REPLICA reconstructed from the sidecar, not to
//      the live doc. That is what the next session actually gets, and it is
//      where a "GC'd the live doc but wrote a pre-GC checkpoint" implementation
//      is visible.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import { DELETED_MAP_NAME } from "../../../../../plugin/src/files/canvas-sync";

const GUID = "9c14e8f70b2a4d359ea6c7d1802f4b63";
const HORIZON = 4;

function memoryIO(): SidecarIO & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async ensureDir() {},
    async exists(p: string) {
      return files.has(p);
    },
    async read(p: string) {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(f);
    },
    async write(p: string, d: Uint8Array) {
      files.set(p, Uint8Array.from(d));
    },
    async append(p: string, d: Uint8Array) {
      const prev = files.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      files.set(p, out);
    },
    async truncate(p: string) {
      files.set(p, new Uint8Array(0));
    },
    async remove(p: string) {
      files.delete(p);
    },
  };
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function somewhereOnDisk(io: ReturnType<typeof memoryIO>, marker: string): boolean {
  const needle = enc(marker);
  for (const bytes of io.files.values()) {
    if (contains(bytes, needle)) return true;
  }
  return false;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

/** A record whose body is a nested `Y.Text`, not a plain string. */
function richCard(doc: Y.Doc, id: string, body: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    record.set("id", id);
    record.set("type", "text");
    const text = new Y.Text();
    text.insert(0, body);
    record.set("body", text);
  });
}

function suppress(doc: Y.Doc, id: string, t: number): void {
  doc.transact(() => {
    doc.getMap<unknown>(DELETED_MAP_NAME).set(id, { t, by: "peer-x", on: true });
  });
}

describe("WP25 AC3 blind1 — deleted rich content does not survive a compaction", () => {
  it("the premise: GC is what removes it, and GC:false keeps it", () => {
    // If this fails, Yjs' behaviour has changed and every assertion below is
    // measuring nothing at all.
    const marker = "PREMISE-MARKER-QQ";
    const results: boolean[] = [];
    for (const gc of [true, false]) {
      const doc = new Y.Doc({ gc });
      richCard(doc, "n-x", marker);
      doc.transact(() => {
        doc.getMap<Y.Map<unknown>>("nodes").delete("n-x");
      });
      results.push(contains(Y.encodeStateAsUpdate(doc), enc(marker)));
      doc.destroy();
    }
    expect(results).toEqual([false, true]);
  });

  it("a nested Y.Text body is gone from the whole sidecar after compaction", async () => {
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);

    richCard(doc, "n-doomed", "QQ-NESTED-SECRET-BODY-QQ");
    richCard(doc, "n-kept", "QQ-LIVING-BODY-QQ");
    await settle();
    expect(somewhereOnDisk(io, "QQ-NESTED-SECRET-BODY-QQ"), "fixture wrote nothing").toBe(true);

    suppress(doc, "n-doomed", 1);
    suppress(doc, "n-untouched", 50); // moves `newest` past the horizon
    await settle();

    await lifecycle.compact(GUID, doc);
    await settle();

    expect(
      somewhereOnDisk(io, "QQ-NESTED-SECRET-BODY-QQ"),
      "the deleted rich-text body survived the compaction on disk",
    ).toBe(false);
    expect(somewhereOnDisk(io, "QQ-LIVING-BODY-QQ")).toBe(true);

    await lifecycle.destroy();
  });

  it("three generations do not accumulate — each compaction clears its own garbage", async () => {
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    richCard(doc, "n-anchor", "QQ-ANCHOR-QQ");
    await settle();

    for (let generation = 0; generation < 3; generation++) {
      const marker = `QQ-GEN-${generation}-BODY-QQ`;
      richCard(doc, `n-gen-${generation}`, marker);
      await settle();
      expect(somewhereOnDisk(io, marker)).toBe(true);

      suppress(doc, `n-gen-${generation}`, 1 + generation);
      suppress(doc, "n-pacer", 100 * (generation + 1));
      await settle();

      await lifecycle.compact(GUID, doc);
      await settle();

      expect(
        somewhereOnDisk(io, marker),
        `generation ${generation}'s deleted body survived its own compaction`,
      ).toBe(false);
      // and every previous generation is still gone.
      for (let previous = 0; previous < generation; previous++) {
        expect(somewhereOnDisk(io, `QQ-GEN-${previous}-BODY-QQ`)).toBe(false);
      }
      expect(somewhereOnDisk(io, "QQ-ANCHOR-QQ")).toBe(true);
    }

    await lifecycle.destroy();
  });

  it("the replica the NEXT session gets is the GC'd one", async () => {
    // Where a "GC'd the doc, checkpointed the pre-GC state" implementation shows.
    const io = memoryIO();
    const store = createSidecarStore(io);
    const lifecycle = createSidecarLifecycle(store, { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    richCard(doc, "n-doomed", "QQ-REPLICA-SECRET-QQ");
    richCard(doc, "n-kept", "QQ-REPLICA-LIVE-QQ");
    suppress(doc, "n-doomed", 1);
    suppress(doc, "n-pacer", 80);
    await settle();

    await lifecycle.compact(GUID, doc);
    await settle();

    const replica = new Y.Doc();
    const load = await store.load(GUID, replica);
    expect(load.degradation).toBe("none");
    expect(
      contains(Y.encodeStateAsUpdate(replica), enc("QQ-REPLICA-SECRET-QQ")),
      "the reloaded replica still carries the deleted content",
    ).toBe(false);
    const body = replica.getMap<Y.Map<unknown>>("nodes").get("n-kept")?.get("body") as Y.Text;
    expect(body.toString()).toBe("QQ-REPLICA-LIVE-QQ");

    await lifecycle.destroy();
  });

  it("the history file is empty after a compaction, checkpoint non-empty", async () => {
    // A GC'd checkpoint next to an untouched frame log is not a compaction: the
    // frames still hold every byte the GC removed, and the next load replays them.
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    richCard(doc, "n-1", "QQ-ONE-QQ");
    richCard(doc, "n-2", "QQ-TWO-QQ");
    await settle();
    expect((io.files.get(sidecarHistoryPath(GUID)) as Uint8Array).length).toBeGreaterThan(0);

    await lifecycle.compact(GUID, doc);
    await settle();

    expect(io.files.get(sidecarHistoryPath(GUID))).toEqual(new Uint8Array(0));
    expect((io.files.get(sidecarCheckpointPath(GUID)) as Uint8Array).length).toBeGreaterThan(0);

    await lifecycle.destroy();
  });
});
