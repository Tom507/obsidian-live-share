// S126 — WE SHIPPED A REGRESSION, AND THIS IS IT.
//
// `S119`'s floor stopped an empty document overwriting a user's note. Its
// evidence that an emptiness was deliberate was
// `this.observedNonEmpty.has(path)` — "has THIS PEER seen this document hold
// content in this session". `observedNonEmpty` is an in-memory Set, per-peer and
// per-session, cleared on teardown, populated only where this peer reads the
// doc's text non-empty.
//
// So a peer with the note CLOSED never observes it non-empty, and a genuine
// select-all-and-delete is indistinguishable from an absence. W4 demonstrated
// it live and the product's own ledger attributed it: `byArm: {doc-write: 1}`,
// with the peer keeping its old 31 bytes indefinitely. First-time-only: once
// anything has made that peer read the text non-empty, the second emptying of
// the same path propagates — which is exactly the signature of a session-local
// witness.
//
// THE CORRECTION: "has this peer seen content" is a fact about local
// observation. "Did somebody delete this content" is a property of the
// DOCUMENT, and CRDTs replicate it. A `Y.Text` that held characters and had
// them removed keeps TOMBSTONES; one that never held anything does not.
//
// AC1 REQUIRED THE YJS BEHAVIOUR TO BE ESTABLISHED, NOT ASSUMED — including
// under compaction, the case that could destroy it. The scenario table at the
// bottom of this file is that measurement, run as assertions. It was taken
// BEFORE the fix was written.

import { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../files/background-sync";
import { getEmptyWriteRefusals, resetEmptyWriteRefusals } from "../../files/empty-write-guard";
import { yTextHeldContent } from "../../files/ytext-history";

const NOTE = "notes/hello.md";
const BODY = "the user's note, thirty-one bytes\n";

function vaultDouble(contents: Record<string, string>) {
  const files = new Map(Object.entries(contents));
  // REAL `TFile` instances. `getFileByPath` is an `instanceof TFile` test, so a
  // plain object makes `doWriteToDisk` skip the whole `if (file)` block — which
  // is where the floor lives. Every refusal row would then pass the write and
  // fail for a reason that has nothing to do with the property under test.
  const handles = new Map<string, TFile>();
  const handle = (path: string) => {
    let f = handles.get(path);
    if (!f) {
      f = new TFile();
      f.path = path;
      handles.set(path, f);
    }
    return f;
  };
  return {
    files,
    getFiles: vi.fn(() => Array.from(files.keys(), handle)),
    getAllLoadedFiles: vi.fn(() => Array.from(files.keys(), handle)),
    getAbstractFileByPath: vi.fn((p: string) => (files.has(p) ? handle(p) : null)),
    read: vi.fn(async (f: { path: string }) => files.get(f.path) ?? ""),
    modify: vi.fn(async (f: { path: string }, c: string) => void files.set(f.path, c)),
    create: vi.fn(async (p: string, c: string) => void files.set(p, c)),
    createFolder: vi.fn(async () => {}),
    adapter: {
      exists: vi.fn(async () => true),
      write: vi.fn(async (p: string, c: string) => void files.set(p, c)),
    },
  };
}

/**
 * A peer that has NEVER OPENED THE NOTE. Nothing has ever made it read the
 * doc's text non-empty, so `observedNonEmpty` is empty — the exact state in
 * which the regression fired.
 *
 * `docText` is the shared document as this peer holds it, which is the whole
 * point: it is built by replicating another peer's doc, not by editing locally.
 */
function makePeer(docText: Y.Text | null) {
  const vault = vaultDouble({ [NOTE]: BODY });
  const sync = new BackgroundSync(
    vault as never,
    {
      getDoc: vi.fn(() => (docText ? { doc: docText.doc, text: docText } : null)),
      waitForSync: vi.fn(async () => {}),
      releaseDoc: vi.fn(),
    } as never,
    { updateFile: vi.fn() } as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn(), armMuteRelease: vi.fn() } as never,
  );
  const write = (content: string) =>
    (sync as unknown as { writeToDisk(p: string, c: string): Promise<void> }).writeToDisk(
      NOTE,
      content,
    );
  return { vault, sync, write };
}

/** The author's doc: content typed, then all of it selected and deleted. */
function authorEmptiedDoc(): Y.Doc {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  text.insert(0, BODY);
  text.delete(0, text.length);
  return doc;
}

/** What a peer holds after replicating a document. Never edited locally. */
function replicaOf(source: Y.Doc): Y.Doc {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(source));
  return replica;
}

describe("S126 — the regression, and both halves in one pass", () => {
  beforeEach(() => resetEmptyWriteRefusals());

  it("🚨 AC2 — a real delete reaches a peer that has NEVER opened the note", async () => {
    // The author emptied it; this peer only ever received the document.
    const replica = replicaOf(authorEmptiedDoc());
    const peer = makePeer(replica.getText("content"));

    // Precondition, stated so the row cannot pass vacuously: this peer has no
    // local history of the note whatsoever.
    expect(
      (peer.sync as unknown as { observedNonEmpty: Set<string> }).observedNonEmpty.has(NOTE),
    ).toBe(false);

    await peer.write("");

    // THE DELETION LANDS. Before the fix this file kept its 31 bytes forever.
    expect(peer.vault.files.get(NOTE)).toBe("");
    expect(getEmptyWriteRefusals().total).toBe(0);
  });

  it("🚨 AC2 — an empty doc that NEVER held content still does not overwrite", async () => {
    // Same peer, same absent local history, same empty incoming content. The
    // ONLY difference is that this document has no tombstones — nobody ever put
    // anything in it. S119's property, intact.
    const neverHeld = replicaOf(new Y.Doc());
    const peer = makePeer(neverHeld.getText("content"));

    await peer.write("");

    expect(peer.vault.files.get(NOTE)).toBe(BODY);
    expect(getEmptyWriteRefusals().byArm["doc-write"]).toBe(1);
  });

  it("AC2 — the two halves, same vault, same call, decided only by the document", async () => {
    // Both assertions in one pass, as the charter asks: the pair IS the package.
    const emptied = makePeer(replicaOf(authorEmptiedDoc()).getText("content"));
    const virgin = makePeer(replicaOf(new Y.Doc()).getText("content"));

    await emptied.write("");
    await virgin.write("");

    expect(emptied.vault.files.get(NOTE)).toBe("");
    expect(virgin.vault.files.get(NOTE)).toBe(BODY);
  });

  it("a missing doc handle refuses — an absent document is not evidence", async () => {
    const peer = makePeer(null);
    await peer.write("");
    expect(peer.vault.files.get(NOTE)).toBe(BODY);
    expect(getEmptyWriteRefusals().byArm["doc-write"]).toBe(1);
  });

  it("VACUITY CONTROL — non-empty content still writes, on every peer", async () => {
    const peer = makePeer(replicaOf(new Y.Doc()).getText("content"));
    await peer.write("replacement");
    expect(peer.vault.files.get(NOTE)).toBe("replacement");
  });

  it("the session-local witness still admits, so the weaker evidence is not dead code", async () => {
    // `observedNonEmpty` is retained as a second witness. It is true in
    // strictly fewer cases than the tombstone probe, so it can never admit a
    // write the probe would refuse — but it must still work on its own.
    const peer = makePeer(null);
    (peer.sync as unknown as { noteIfNonEmpty(p: string, c: string): void }).noteIfNonEmpty(
      NOTE,
      BODY,
    );
    await peer.write("");
    expect(peer.vault.files.get(NOTE)).toBe("");
  });
});

/**
 * AC1 — THE MEASUREMENT, RUN AS ASSERTIONS.
 *
 * Taken before the fix was written, and pinned here so the Yjs behaviour the
 * floor now depends on cannot change silently. A Yjs release that garbage-
 * collects the delete set, or renames the internal item list, reddens these
 * rows rather than quietly returning the product to overwriting user notes.
 */
describe("S126 AC1 — the tombstone discriminator, measured across every scenario", () => {
  function heldThenEmptied(opts?: ConstructorParameters<typeof Y.Doc>[0]): Y.Doc {
    const doc = new Y.Doc(opts);
    const t = doc.getText("content");
    t.insert(0, "hello world");
    t.delete(0, t.length);
    return doc;
  }

  it("a document that never held content reports false", () => {
    expect(yTextHeldContent(new Y.Doc().getText("content"))).toBe(false);
  });

  it("a document that held content and was emptied reports true", () => {
    expect(yTextHeldContent(heldThenEmptied().getText("content"))).toBe(true);
  });

  it("THE S126 CASE — a remote peer holding only the replicated state reports true", () => {
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(heldThenEmptied()));
    expect(yTextHeldContent(replica.getText("content"))).toBe(true);
    // …and a replica of a virgin doc still reports false, so the row above is
    // not passing because replication invents tombstones.
    const virgin = new Y.Doc();
    Y.applyUpdate(virgin, Y.encodeStateAsUpdate(new Y.Doc()));
    expect(yTextHeldContent(virgin.getText("content"))).toBe(false);
  });

  it("garbage collection does not erase the discriminator", () => {
    const gc = heldThenEmptied({ gc: true });
    expect(yTextHeldContent(gc.getText("content"))).toBe(true);
    const replica = new Y.Doc({ gc: true });
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(gc));
    expect(yTextHeldContent(replica.getText("content"))).toBe(true);
  });

  it("a v2 encode/decode round trip does not erase it", () => {
    const replica = new Y.Doc();
    Y.applyUpdateV2(replica, Y.encodeStateAsUpdateV2(heldThenEmptied()));
    expect(yTextHeldContent(replica.getText("content"))).toBe(true);
  });

  it("COMPACTION — three successive full re-encodings do not erase it", () => {
    // The case the charter singled out as the one that could destroy the
    // evidence. It does not: the delete set is what makes concurrent edits
    // converge, so it cannot be dropped while any peer might not have seen it.
    let update = Y.encodeStateAsUpdate(heldThenEmptied());
    for (let i = 0; i < 3; i++) {
      const tmp = new Y.Doc();
      Y.applyUpdate(tmp, update);
      update = Y.encodeStateAsUpdate(tmp);
    }
    const final = new Y.Doc();
    Y.applyUpdate(final, update);
    expect(final.getText("content").length).toBe(0);
    expect(yTextHeldContent(final.getText("content"))).toBe(true);
  });

  it("a text still holding content reports true", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "live");
    expect(yTextHeldContent(doc.getText("content"))).toBe(true);
  });

  it("null and a broken text answer false rather than throwing", () => {
    expect(yTextHeldContent(null)).toBe(false);
    expect(yTextHeldContent(undefined)).toBe(false);
    const hostile = {
      get _start() {
        throw new Error("no");
      },
    } as unknown as Y.Text;
    expect(yTextHeldContent(hostile)).toBe(false);
  });
});
