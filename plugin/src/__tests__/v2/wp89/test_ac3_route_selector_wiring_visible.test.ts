// WP89 / AC3 — THE ENFORCEMENT DECISION, AND IT IS "ENFORCED".
//
// THE DECISION, with its reason. AC2's corrections are prose, and prose is what
// this work package exists because of: the falsified premise sat in the tree as
// a comment for months and three work packages reasoned from it. A comment is
// therefore NOT sufficient here, exactly as it was not sufficient for
// `skipsAutoTextSync`. What is enforced is the thing the corrected statement
// actually asserts — that `viewOpen === false` is a ROUTE SELECTOR over one
// predicate rather than a claim about Obsidian's reload behaviour — because that
// is the property a future change could silently break while every comment still
// reads correctly.
//
// ⚠ WHAT THIS TEST IS NOT, and the vacuity risk that shape carries. It does NOT
// assert "the file no longer contains this sentence". That is enforcement of
// prose by prose, it is explicitly not what AC3 asks for, and WP37 has three red
// tests on record that were red because the import allow-list regex reads
// comments. It pins the WIRING: one production definer for `SurfaceState.
// viewOpen`, the reconcile early-return consulting the SAME predicate, and the
// two receipt routes shown MUTUALLY EXCLUSIVE by driving both arms.
//
// The second vacuity risk AC3 names is an enforcement test that passes on a
// build where NEITHER route runs — green and empty. Both arms below are driven
// and each is asserted ENTERED before its outcome counts.
//
// ⚠ AC1's LIVE half is NOT what this test replaces. AC1 asks for a three-
// surface-state live reproduction on two Obsidian instances; B60 did not run it
// (a sibling batch held the shared vaults, and the charter's own ordering rule
// forbids a live row with another suite in flight). This is AC1's STRUCTURAL
// observable — "asserted by a test, from the parsed tree, not by reading the two
// lines and agreeing" — and nothing more. State (b) is UNMEASURED.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createSurfaceStateStore, getField, getRecordState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const PATH = "wiki/route.canvas";

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "one" };

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
  return JSON.stringify({ nodes, edges });
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => void files.set(p, c)),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

/** A subscribed client whose `viewOpen` is driven by an adapter-availability set. */
async function makePeer(available: Set<string>) {
  const vault = createVault({ [PATH]: canvasJson([N1]) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  // Exactly `main.ts:206-208`'s closure shape: "is there an AVAILABLE adapter?"
  const store = createSurfaceStateStore((path: string) => available.has(path));
  cs.setSurfaceStateProvider((path: string) => store.stateFor(path));
  await cs.subscribe(PATH, "host");
  return { cs, store, vault };
}

describe("WP89 AC3 — `viewOpen` is a route selector over ONE predicate, enforced", () => {
  it("T1 `SurfaceState.viewOpen` has exactly ONE production definer, and it is the injected closure", () => {
    // Derived from the sources, not from a hand list: every production line that
    // WRITES the field. `canvas-sync.ts`'s is WP4's honest P0 default for an
    // unwired provider, which is a default and not a definer, so it is named
    // explicitly rather than filtered by a pattern that could hide a third.
    const shadow = readFileSync(`${SRC}canvas/canvas-shadow.ts`, "utf8");
    const sync = readFileSync(`${SRC}files/canvas-sync.ts`, "utf8");
    const main = readFileSync(`${SRC}main.ts`, "utf8");

    // An object-literal entry (`viewOpen: <expr>,`) WRITES the field; the
    // interface's `viewOpen: boolean;` declares its type and writes nothing.
    // Both are excluded from comments so a prose mention cannot join the count —
    // WP37 has three tests on record that were red for exactly that reason.
    const writers = (source: string) =>
      source
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*)/.test(l))
        .filter((l) => /\bviewOpen:\s*\S.*,\s*$/.test(l));

    expect(writers(shadow), "canvas-shadow.ts gained or lost a `viewOpen` writer").toHaveLength(1);
    expect(writers(shadow)[0]).toContain("isViewOpen(path)");
    expect(writers(sync), "canvas-sync.ts's unwired P0 default moved or multiplied").toHaveLength(1);
    expect(writers(sync)[0]).toContain("viewOpen: false");
    expect(writers(main), "main.ts began computing `viewOpen` itself").toHaveLength(0);

    // ...and the ONE closure that feeds `isViewOpen` is adapter availability.
    expect(main).toMatch(
      /createSurfaceStateStore\(\s*\n?\s*\(path\) =>\s*this\.canvasAdapters\.get\(path\)\?\.isAvailable\(\) === true/,
    );
  });

  it("T2 `reconcileLiveCanvas` early-returns on the SAME predicate, not on a second one", () => {
    const main = readFileSync(`${SRC}main.ts`, "utf8");
    const body = main.slice(main.indexOf("private reconcileLiveCanvas("));
    expect(body.length, "reconcileLiveCanvas was renamed or removed").toBeGreaterThan(0);
    // The guard, and it is the same `isAvailable()` question the store closure asks.
    expect(body.slice(0, 1200)).toMatch(
      /if \(!adapter \|\| !adapter\.isAvailable\(\)\) return;/,
    );
    // ...and it does NOT consult a second, independent notion of "open".
    expect(
      body.slice(0, 1200),
      "the reconcile guard grew a second openness predicate — the two routes can now overlap",
    ).not.toMatch(/getLeavesOfType|workspace\.getActiveViewOfType|\bleafOpen\b/);
  });

  it("T3 ARM A — adapter AVAILABLE: the disk-write route does NOT advance the shadow", async () => {
    const available = new Set<string>([PATH]);
    const peer = await makePeer(available);
    // The arm is asserted ENTERED before its outcome counts.
    expect(peer.store.stateFor(PATH).viewOpen, "arm A was not entered").toBe(true);

    peer.cs.noteExternalDiskWrite(PATH, canvasJson([{ ...N1, text: "from-disk" }]));

    expect(
      getField(peer.cs.getSurfaceShadow(), PATH, "node", "n1", "text"),
      "with an adapter available the disk write advanced the shadow — the two receipt " +
        "routes now BOTH run, and a record the surface deliberately did not take can " +
        "be written into the capture basis (S57)",
    ).not.toBe("from-disk");
  });

  it("T4 ARM B — adapter ABSENT: the disk-write route DOES advance the shadow", async () => {
    const available = new Set<string>();
    const peer = await makePeer(available);
    expect(peer.store.stateFor(PATH).viewOpen, "arm B was not entered").toBe(false);

    peer.cs.noteExternalDiskWrite(PATH, canvasJson([{ ...N1, text: "from-disk" }]));

    expect(
      getField(peer.cs.getSurfaceShadow(), PATH, "node", "n1", "text"),
      "with no adapter NOTHING advanced the shadow — the path is stranded and the " +
        "peer's next capture will re-push its value as fresh intent",
    ).toBe("from-disk");
    expect(getRecordState(peer.cs.getSurfaceShadow(), PATH, "node", "n1")).toBe("present");
  });

  it("T5 the two arms are MUTUALLY EXCLUSIVE — flipping the one predicate flips the route", async () => {
    // The complementarity itself, on one client, with the predicate as the only
    // thing that changes. A build in which the routes were decoupled would let
    // both arms answer the same way and this reads it directly.
    const available = new Set<string>([PATH]);
    const peer = await makePeer(available);

    peer.cs.noteExternalDiskWrite(PATH, canvasJson([{ ...N1, text: "while-open" }]));
    const whileOpen = getField(peer.cs.getSurfaceShadow(), PATH, "node", "n1", "text");

    available.delete(PATH); // the leaf closes; nothing else about the client changes
    expect(peer.store.stateFor(PATH).viewOpen).toBe(false);
    peer.cs.noteExternalDiskWrite(PATH, canvasJson([{ ...N1, text: "while-closed" }]));
    const whileClosed = getField(peer.cs.getSurfaceShadow(), PATH, "node", "n1", "text");

    expect(whileOpen).not.toBe("while-open");
    expect(whileClosed).toBe("while-closed");
    expect(
      whileOpen === whileClosed,
      "the same disk write had the same effect in both surface states — `viewOpen` " +
        "is no longer selecting a route and the branch has become decorative",
    ).toBe(false);
  });
});
