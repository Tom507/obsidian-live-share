// WP25 / AC3 blind1 (the discriminating half) — "a compaction never changes the
// doc's observable state", run as the BUILD_SPEC's own fuzzer link:
//
//   *"WP23 'compaction' op — a compaction at an arbitrary point in the run must
//    leave every assertion of the run unchanged."*
//
// Different angle from the visible test, which compares one doc against itself
// before and after. Here TWO replicas receive the identical op sequence and one
// of them is compacted at a different point in the run each time. If a
// compaction is observable at all, the compacted replica and the control diverge
// at some step — and because the compaction point moves, a single lucky
// alignment cannot hide it.
//
// THE ORACLE IS THE PROJECTION, NOT THE ENCODING. `encodeStateAsUpdate` MUST
// differ after a compaction; that is what compacting is. What may not differ is
// `serializeCanvas`, which is what the file, the peers and the view see.
//
// AND THE COMPACTION MUST ACTUALLY DO SOMETHING. Every run below asserts a
// non-empty `removedTombstoneIds` at least once, because "unchanged" is trivially
// true of an implementation that never collects anything.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  DELETED_MAP_NAME,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

const GUID = "8ae52c1704bd49f3b6ce09a7d281f635";
const HORIZON = 6;

function memoryIO(): SidecarIO {
  const files = new Map<string, Uint8Array>();
  return {
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

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function projection(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
}

type Op = (doc: Y.Doc) => void;

/**
 * A twelve-step run over one board. The stamps are chosen so that by step 6 two
 * suppressions are already far behind the newest one — i.e. a compaction taken
 * at any step from 7 onwards has real work to do.
 */
const RUN: Op[] = [
  (d) => card(d, "n-1", "one"),
  (d) => card(d, "n-2", "two"),
  (d) => edge(d, "e-12", "n-1", "n-2"),
  (d) => card(d, "n-3", "three"),
  (d) => tomb(d, "n-3", 1, true),
  // Step 6 pushes `newest` well past the horizon, so a compaction taken at any
  // step from 7 onwards genuinely has something to collect.
  (d) => tomb(d, "n-1", 60, false),
  (d) => card(d, "n-4", "four"),
  (d) => tomb(d, "n-4", 2, true),
  (d) => edge(d, "e-13", "n-1", "n-3"),
  (d) => field(d, "n-2", "text", "two, edited"),
  (d) => card(d, "n-5", "five"),
  (d) => tomb(d, "n-5", 61, true),
];

function card(doc: Y.Doc, id: string, text: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    for (const [k, v] of Object.entries({
      id,
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      text,
    })) {
      record.set(k, v);
    }
  });
}

function edge(doc: Y.Doc, id: string, from: string, to: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("edges").set(id, record);
    record.set("id", id);
    record.set("fromNode", from);
    record.set("toNode", to);
  });
}

function field(doc: Y.Doc, id: string, key: string, value: unknown): void {
  doc.transact(() => {
    doc.getMap<Y.Map<unknown>>("nodes").get(id)?.set(key, value);
  });
}

function tomb(doc: Y.Doc, id: string, t: number, on: boolean): void {
  doc.transact(() => {
    doc.getMap<unknown>(DELETED_MAP_NAME).set(id, { t, by: "peer-a", on });
  });
}

describe("WP25 AC3 blind1 — a compaction anywhere in the run is unobservable", () => {
  for (const compactAfter of [7, 9, 11, 12]) {
    it(`a compaction after step ${compactAfter} leaves every projection unchanged`, async () => {
      const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
        horizonTicks: HORIZON,
      });
      const subject = new Y.Doc();
      const control = new Y.Doc();
      lifecycle.attach(GUID, subject);
      let collected = 0;

      for (let step = 1; step <= RUN.length; step++) {
        RUN[step - 1](subject);
        RUN[step - 1](control);
        await settle();

        if (step === compactAfter) {
          const result = await lifecycle.compact(GUID, subject);
          await settle();
          collected = result.removedTombstoneIds.length;
        }

        expect(
          projection(subject),
          `the compacted replica diverged from the control at step ${step}`,
        ).toBe(projection(control));
      }

      // The half that stops this being vacuous.
      expect(collected, "the compaction collected nothing — the run proves nothing").toBeGreaterThan(
        0,
      );
      // and the ENCODING did change, so "unchanged" is a statement about the
      // projection rather than about a compaction that never happened.
      expect(
        [...Y.encodeStateAsUpdate(subject)].join(","),
      ).not.toBe([...Y.encodeStateAsUpdate(control)].join(","));

      await lifecycle.destroy();
      control.destroy();
    });
  }

  it("two compactions at different points converge to the same projection", async () => {
    // Confluence: WHEN the compaction happened must not be observable either.
    const projections: string[] = [];
    for (const compactAfter of [7, 12]) {
      const lifecycle = createSidecarLifecycle(createSidecarStore(memoryIO()), {
        horizonTicks: HORIZON,
      });
      const doc = new Y.Doc();
      lifecycle.attach(GUID, doc);
      for (let step = 1; step <= RUN.length; step++) {
        RUN[step - 1](doc);
        await settle();
        if (step === compactAfter) {
          await lifecycle.compact(GUID, doc);
          await settle();
        }
      }
      projections.push(projection(doc));
      await lifecycle.destroy();
    }
    expect(projections[0]).toBe(projections[1]);
  });
});
