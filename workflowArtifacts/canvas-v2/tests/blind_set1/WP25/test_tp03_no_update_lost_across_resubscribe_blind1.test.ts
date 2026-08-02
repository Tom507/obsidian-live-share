// WP25 / AC2 blind1 (cycle half) — "no update is lost across a clean
// unsubscribe/resubscribe cycle", attacked as a PROCESS RESTART.
//
// Different angle from the visible test, which drives `CanvasSync` and inspects
// the append channel. Here the whole in-memory world is thrown away between the
// two halves: the lifecycle is destroyed, every `Y.Doc` is destroyed, and a
// BRAND NEW lifecycle is built over the same bytes. Nothing survives except the
// sidecar files, which is the only thing the AC actually promises.
//
// The oracle is therefore the reconstructed document, compared against a control
// replica that never unloaded at all — the fuzzer's "replica restart" shape. The
// two must agree on observable content. That is a stronger statement than "the
// records are there": a restart that lost one field of one card, or that replayed
// the history in the wrong order, disagrees with the control.

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

const GUID = "7fa0be3195c24d81a6ef2b40d7c98315";

function persistentIO(): SidecarIO & { files: Map<string, Uint8Array> } {
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

function card(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set(id, record);
    for (const [k, v] of Object.entries({ id, ...fields })) record.set(k, v);
  });
}

/** Everything the session does, applied to whichever doc is handed in. */
function session(doc: Y.Doc, phase: "before" | "after"): void {
  if (phase === "before") {
    card(doc, "n-1", { type: "text", x: 0, y: 0, width: 100, height: 60, text: "first" });
    card(doc, "n-2", { type: "text", x: 200, y: 0, width: 100, height: 60, text: "second" });
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>("nodes").get("n-1")?.set("text", "first, edited");
    });
    doc.transact(() => {
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      const e = new Y.Map<unknown>();
      edges.set("e-1", e);
      e.set("id", "e-1");
      e.set("fromNode", "n-1");
      e.set("toNode", "n-2");
    });
    return;
  }
  card(doc, "n-3", { type: "text", x: 400, y: 0, width: 100, height: 60, text: "third" });
  doc.transact(() => {
    doc.getMap<unknown>(DELETED_MAP_NAME).set("n-2", { t: 5, by: "local", on: true });
  });
}

describe("WP25 AC2 blind1 — a restarted replica agrees with one that never unloaded", () => {
  it("the restarted doc projects exactly what the never-unloaded control projects", async () => {
    const io = persistentIO();

    // ── session one ────────────────────────────────────────────────────────
    const lifecycleA = createSidecarLifecycle(createSidecarStore(io));
    const docA = new Y.Doc();
    lifecycleA.attach(GUID, docA);
    session(docA, "before");
    await settle();
    await lifecycleA.detach(GUID);
    await lifecycleA.destroy();
    await settle();

    // The control keeps every op of BOTH sessions and never touches a file.
    const control = new Y.Doc();
    Y.applyUpdate(control, Y.encodeStateAsUpdate(docA));
    docA.destroy();

    // ── session two: nothing in memory survives ────────────────────────────
    const lifecycleB = createSidecarLifecycle(createSidecarStore(io));
    const docB = new Y.Doc();
    lifecycleB.attach(GUID, docB);
    const result = await lifecycleB.load(GUID, docB);
    await settle();

    expect(result.degradation).toBe("none");
    expect(
      projection(docB),
      "the restarted replica does not match the state it unloaded with",
    ).toBe(projection(control));

    session(docB, "after");
    session(control, "after");
    await settle();

    expect(projection(docB)).toBe(projection(control));

    await lifecycleB.destroy();
  });

  it("the very LAST update before the teardown is on disk", async () => {
    // The tail is what a dropped queue eats, and it is invisible in every
    // earlier assertion because the rest of the session is still there.
    const io = persistentIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-1", { type: "text", text: "kept" });
    await settle();
    card(doc, "n-last", { type: "text", text: "the tail" });
    await lifecycle.detach(GUID);
    await lifecycle.destroy();
    doc.destroy();
    await settle();

    const replica = new Y.Doc();
    const load = await createSidecarStore(io).load(GUID, replica);
    expect(load.degradation).toBe("none");
    expect(
      [...replica.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
      "the last update before teardown was lost",
    ).toEqual(["n-1", "n-last"]);
  });

  it("a second restart does not double anything", async () => {
    // Three lifetimes over one sidecar. Idempotent applies hide duplication in
    // the doc, so the pin is the file: the frame log plus the checkpoint must
    // still reconstruct the same projection, and the history must not have grown
    // by a whole replayed state.
    const io = persistentIO();
    let expected = "";

    for (let generation = 0; generation < 3; generation++) {
      const lifecycle = createSidecarLifecycle(createSidecarStore(io));
      const doc = new Y.Doc();
      lifecycle.attach(GUID, doc);
      await lifecycle.load(GUID, doc);
      await settle();
      card(doc, `gen-${generation}`, { type: "text", text: `generation ${generation}` });
      await settle();
      expected = projection(doc);
      await lifecycle.detach(GUID);
      await lifecycle.destroy();
      doc.destroy();
      await settle();
    }

    const replica = new Y.Doc();
    await createSidecarStore(io).load(GUID, replica);
    expect(projection(replica)).toBe(expected);
    expect([...replica.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual([
      "gen-0",
      "gen-1",
      "gen-2",
    ]);
  });

  it("a detached guid stops writing, so the next session replays only its own past", async () => {
    const io = persistentIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    card(doc, "n-1", { type: "text", text: "in session" });
    await settle();

    await lifecycle.detach(GUID);
    await settle();

    // The doc object is still alive. Anything it emits now belongs to nothing.
    card(doc, "n-ghost", { type: "text", text: "after teardown" });
    await settle();

    const replica = new Y.Doc();
    await createSidecarStore(io).load(GUID, replica);
    expect(
      [...replica.getMap<Y.Map<unknown>>("nodes").keys()],
      "a detached doc kept writing into the sidecar",
    ).toEqual(["n-1"]);

    await lifecycle.destroy();
  });
});
