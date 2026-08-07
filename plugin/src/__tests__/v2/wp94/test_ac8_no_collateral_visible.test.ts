// WP94 / C94 AC8 — NO COLLATERAL.
//
// Every guard below is DRIVEN, never read from a diff. Vacuity (a): "unchanged"
// asserted by inspecting the change set proves only that a line was not edited,
// not that the behaviour survived — and the behaviours here are the ones a
// widened delete rule is most likely to break by accident.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type ApplyOutcome,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
  getRecordState,
} from "../../../canvas/canvas-shadow";
import {
  PATH,
  canvasJson,
  docRecords,
  edge,
  inDoc,
  isDeleted,
  makePeer,
  node,
  projection,
  save,
} from "./harness";

const A = node("a");
const B = node("b", { x: 300 });
const AB = edge("ab", "a", "b");

describe("WP94 AC8 — no collateral", () => {
  it("WP19: `nodesMap.delete` / `edgesMap.delete` are STILL never called by any capture path", async () => {
    // The tripwire, re-driven here rather than trusted: a delete is a tombstone,
    // and the record's key and `Y.Map` keep their identity and every field. That
    // is the whole of what makes the delete reversible and mergeable.
    const peer = await makePeer(canvasJson([A, B], [AB]));
    await save(peer, canvasJson([A, { ...B, x: 301 }], [AB])); // earn the receipts

    const nodes = peer.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = peer.doc.getMap<Y.Map<unknown>>("edges");
    const nodeDelete = vi.spyOn(nodes, "delete");
    const edgeDelete = vi.spyOn(edges, "delete");

    await save(peer, canvasJson([A], []));

    expect(isDeleted(peer.doc, "b"), "the delete under test did not happen").toBe(true);
    expect(nodeDelete, "a capture path removed a node KEY").not.toHaveBeenCalled();
    expect(edgeDelete, "a capture path removed an edge KEY").not.toHaveBeenCalled();
    // ...and every field survives verbatim, which is what undo depends on.
    const b = nodes.get("b") as Y.Map<unknown>;
    expect(b.get("x")).toBe(301);
    expect(inDoc(peer.doc, "edge", "ab")).toBe(true);
  });

  it("WP29 AC2: the host seed still performs NO record-level delete-by-omission", async () => {
    // Driven with a stale host file that omits records the peers created. The
    // seed is a create-once UPSERT and has no opinion about deletion — and WP94
    // must not reintroduce that opinion at one remove, by letting a seed's
    // content act as a licence for a later save's omission.
    const peer = await makePeer(canvasJson([A, B]));

    // A peer's record arrives after the seed.
    peer.doc.transact(() => {
      const record = new Y.Map<unknown>();
      record.set("id", "peer");
      record.set("type", "text");
      record.set("text", "");
      record.set("x", 900);
      record.set("y", 0);
      record.set("width", 200);
      record.set("height", 100);
      peer.doc.getMap<Y.Map<unknown>>("nodes").set("peer", record);
    });

    // The host re-seeds from its own stale file, which never mentions `peer`.
    await peer.cs.unsubscribe(PATH);
    await peer.cs.subscribe(PATH, "host");

    expect(
      isDeleted(peer.doc, "peer"),
      "a stale host file removed a card the peers had drawn",
    ).toBe(false);
    expect(projection(peer.doc).nodes).toContain("peer");
  });

  it("the seed's content is NOT a delete licence for a later save's omission", async () => {
    // The back door WP29 names explicitly. The seed puts `b` in the doc and in the
    // shadow; the very next save omitting `b` must still find nothing to spend.
    const peer = await makePeer(canvasJson([A, B]));
    await save(peer, canvasJson([A]));
    expect(isDeleted(peer.doc, "b"), "the seed acted as a receipt").toBe(false);
  });

  it("`advanceShadowFromContent`'s markMissingAbsent arm is NOT a delete path", async () => {
    const peer = await makePeer(canvasJson([A, B]), { viewOpen: false });
    peer.cs.noteExternalDiskWrite(PATH, canvasJson([A]));

    // It writes only the SHADOW...
    expect(getRecordState(peer.cs.getSurfaceShadow(), PATH, "node", "b")).toBe("absent");
    // ...and never the doc.
    expect(isDeleted(peer.doc, "b"), "a shadow advance wrote a tombstone").toBe(false);
    expect(inDoc(peer.doc, "node", "b")).toBe(true);
    expect(projection(peer.doc).nodes.sort()).toEqual(["a", "b"]);
  });

  it("WP5: an INTERACTING record still advances NO field, even where AC4 reasons about it", async () => {
    // WP37/WP87 depend on this byte for byte. The field semantics of
    // `advanceFromReceipt` are untouched by WP94: a card the user is holding
    // refused the values, so the shadow must not claim they reached it.
    const shadow = createSurfaceShadow();
    const outcomes = new Map<string, ApplyOutcome>([["held", "interacting"]]);
    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: { nodes: [{ id: "held", x: 42 }], edges: [] },
        plan: "geometry",
        nodeOutcomes: outcomes,
      }),
    );

    expect(getField(shadow, PATH, "node", "held", "x"), "an interacting record advanced a field").toBe(
      undefined,
    );
    expect(getRecordState(shadow, PATH, "node", "held")).toBe("unknown");
    expect(summary.advanced).toEqual([]);
    expect(summary.handed.node.has("held"), "an interacting record was handed over").toBe(false);
    expect(summary.unconfirmed).toEqual([{ kind: "node", id: "held", outcome: "interacting" }]);
  });

  it("all six CAPTURE DECLINED reasons still fire and still count, each driven once", async () => {
    // The closed set stayed closed: WP94's withhold is a DIFFERENT signature with
    // its own reason set, deliberately not a seventh member here — folding it in
    // would make `declines` uncountable against `local modify`, which is the exact
    // correlation B50 used to characterise S78.
    const peer = await makePeer(canvasJson([A, B]));

    await peer.cs.handleLocalModify(PATH); // echo — the file equals what we wrote
    peer.cs.setCanWrite(() => false);
    await save(peer, canvasJson([A]));  // read-only
    peer.cs.setCanWrite(() => true);
    await peer.cs.handleLocalModify("not/subscribed.canvas"); // not-subscribed
    peer.vault.files.delete(PATH);
    await peer.cs.handleLocalModify(PATH); // no-file

    const counts = peer.cs.captureDeclineCounts();
    expect(counts.echo, "the echo breaker stopped declining").toBeGreaterThan(0);
    expect(counts["read-only"]).toBeGreaterThan(0);
    expect(counts["not-subscribed"]).toBeGreaterThan(0);
    expect(counts["no-file"]).toBeGreaterThan(0);
    // The set is still exactly six members.
    expect(Object.keys(counts).sort()).toEqual([
      "echo",
      "no-doc",
      "no-file",
      "not-subscribed",
      "read-only",
      "schema-major",
    ]);
  });

  it("PURITY: `canvas-shadow.ts` still imports nothing at runtime", () => {
    // Same inputs, same state. No Obsidian, no clock, no entropy, no host global,
    // no file I/O — every fact the module needs is an argument. WP94 added a
    // predicate and two types to this module and none of them may change that.
    const source = readFileSync(
      resolve(__dirname, "../../../canvas/canvas-shadow.ts"),
      "utf8",
    );
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports, "canvas-shadow.ts gained a runtime import").toEqual([
      'import type { EndpointRegister, PosRegister, SizeRegister } from "./canvas-registers";',
    ]);
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("setTimeout");
  });

  it("the projection is still the ONE doc→file/view render, and a tombstone still suppresses", async () => {
    const peer = await makePeer(canvasJson([A, B], [AB]));
    await save(peer, canvasJson([A, { ...B, x: 301 }], [AB]));
    await save(peer, canvasJson([A, { ...B, x: 301 }], []));

    // The edge went, both endpoints survived, and the record survives for undo.
    expect(isDeleted(peer.doc, "ab")).toBe(true);
    expect(docRecords(peer.doc).edges.map((e) => e.id)).not.toContain("ab");
    expect(inDoc(peer.doc, "edge", "ab")).toBe(true);
    expect(projection(peer.doc).nodes.sort()).toEqual(["a", "b"]);
  });
});
