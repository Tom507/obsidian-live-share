// WP25 / AC1 blind2 — the ordering claim, held open at the `exists` PROBE.
//
// Third distinct angle on one claim. The visible test blocks `read`; blind1
// never looks at order at all and inspects the doc at the instant peer sync is
// entered. This one blocks the very FIRST thing a load does — `exists` — and
// asks a different question: does anything at all reach the sync manager while
// the sidecar is merely being probed?
//
// That matters because `exists` is where the MISSING path is decided. An
// implementation can plausibly reason "if there is no sidecar there is nothing
// to wait for, so start syncing" — which is correct for the first session of a
// board and catastrophic on a slow disk for every session after it, because the
// probe answering slowly is exactly when a returning replica most needs to be
// loaded first. So the ordering is asserted on BOTH the present-sidecar and the
// absent-sidecar path.
//
// The second half of the file pins that the load is not merely EARLY but
// COMPLETE: a degradation verdict must already be known when peer sync begins,
// because it is what decides whether this replica is related to the peer's at
// all.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../../../plugin/src/files/canvas-sync";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";

const PATH = "studio/moodboard.canvas";
const GUID = "6e0b93fa1d7c48e2b5904ac6f138d275";

interface GatedIO extends SidecarIO {
  files: Map<string, Uint8Array>;
  hold(op: "exists" | "read"): () => void;
}

function gatedIO(): GatedIO {
  const files = new Map<string, Uint8Array>();
  const gates = new Map<string, Promise<void>>();
  // FIXTURE ONLY — the gate is scoped to THIS GUID'S OWN sidecar files.
  //
  // `index.json` is deliberately exempt, and that exemption is what makes the
  // assertions below able to fail at all. Identity resolution runs BEFORE the
  // doc exists: `resolveGuidForSubscribe` awaits `store.bind(guid, path)`, which
  // calls `readIndex()` -> `io.exists(sidecarIndexPath())`. A blanket `exists`
  // gate therefore stalls the subscribe inside identity resolution — before
  // `getDoc`, before `waitForSync`, and before the sidecar load — so
  // `expect(sync.synced).toEqual([])` held for EVERY implementation, including
  // one that loads the sidecar long after peer sync. The assertion was green for
  // a reason that had nothing to do with AC1.
  //
  // Scoping the gate puts the block back where the test says it is: on the
  // guid's history/checkpoint probe, i.e. on the load itself. No assertion,
  // subject, name or count changes; the test can now go red.
  const wait = async (op: string, path: string): Promise<void> => {
    const gate = path === sidecarIndexPath() ? undefined : gates.get(op);
    if (gate) await gate;
    else await Promise.resolve();
  };
  return {
    files,
    hold(op: "exists" | "read") {
      let release = (): void => {};
      gates.set(
        op,
        new Promise<void>((resolve) => {
          release = () => {
            gates.delete(op);
            resolve();
          };
        }),
      );
      return () => release();
    },
    async ensureDir() {},
    async exists(p: string) {
      await wait("exists", p);
      return files.has(p);
    },
    async read(p: string) {
      await wait("read", p);
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

function vaultDouble() {
  const map = new Map<string, string>([[PATH, JSON.stringify({ nodes: [], edges: [] })]]);
  return {
    map,
    async read(file: { path: string }) {
      return map.get(file.path) ?? "";
    },
    async modify(file: { path: string }, content: string) {
      map.set(file.path, content);
    },
    async create(p: string, c: string) {
      map.set(p, c);
      return {};
    },
    getFiles: () => [],
    async createFolder() {
      return {};
    },
    getAllLoadedFiles: () => [],
    getAbstractFileByPath: (p: string) => (map.has(p) ? { path: p } : null),
    adapter: {
      async write(p: string, c: string) {
        map.set(p, c);
      },
    },
  };
}

function syncDouble() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const synced: string[] = [];
  return {
    docs,
    synced,
    getDoc(id: string) {
      let handle = docs.get(id);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(id, handle);
      }
      return handle;
    },
    releaseDoc() {},
    async waitForSync(id: string) {
      synced.push(id);
    },
  };
}

const fileOps = { mutePathEvents() {}, unmutePathEvents() {}, isPathMuted: () => false };

async function wire(io: GatedIO) {
  const vault = vaultDouble();
  const sync = syncDouble();
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  // FIXTURE ONLY — the observation channel, not the subject.
  //
  // `ManifestManager.connect` unconditionally does
  // `getDoc("__manifest__")` + `await waitForSync("__manifest__")`
  // (`manifest.ts:74-80`). In this fixture that runs during SETUP, before
  // `CanvasSync` even exists, so it can be neither early nor late relative to a
  // subscribe that has not started. But it put `"__manifest__"` into `synced`
  // before the subject ever ran, so `expect(sync.synced).toEqual([])` and
  // `toEqual([canvasDocId(GUID)])` compared against a channel that was already
  // dirty and could not pass for ANY implementation, correct or broken.
  //
  // The doc is still acquired through the real fake, so `docs` and every id the
  // manager was asked for are unchanged; only the manifest's own setup-time sync
  // wait is kept out of the ordering channel. No assertion, subject or name
  // changes. Same repair as the visible `wp25/harness.ts`.
  await manifest.connect({ ...sync, waitForSync: async () => {} } as never);
  manifest.setCanvasGuid(PATH, GUID);
  const store = createSidecarStore(io);
  const canvasSync = new CanvasSync(vault as never, sync as never, fileOps as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: store }));
  const lifecycle = createSidecarLifecycle(store);
  canvasSync.setSidecarLifecycle(lifecycle);
  return { sync, store, lifecycle, canvasSync };
}

async function primeSidecar(io: GatedIO, ids: string[]): Promise<void> {
  const store = createSidecarStore(io);
  const author = new Y.Doc();
  author.transact(() => {
    const nodes = author.getMap<Y.Map<unknown>>("nodes");
    for (const id of ids) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("type", "text");
    }
  });
  await store.checkpoint(GUID, author);
  author.destroy();
}

async function drain(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

describe("WP25 AC1 blind2 — peer sync waits behind the sidecar PROBE, not just its read", () => {
  it("a slow `exists` holds peer sync back (sidecar present)", async () => {
    const io = gatedIO();
    await primeSidecar(io, ["m-1", "m-2"]);
    const { sync, canvasSync } = await wire(io);

    const release = io.hold("exists");
    const pending = canvasSync.subscribe(PATH, "guest");
    await drain();

    expect(
      sync.synced,
      "peer sync began while the sidecar was still being probed",
    ).toEqual([]);

    release();
    await pending;

    expect(sync.synced).toEqual([canvasDocId(GUID)]);
    expect(
      [...(sync.docs.get(canvasDocId(GUID)) as { doc: Y.Doc }).doc
        .getMap<Y.Map<unknown>>("nodes")
        .keys()].sort(),
    ).toEqual(["m-1", "m-2"]);

    canvasSync.destroy();
  });

  it("a slow `exists` holds peer sync back on the ABSENT-sidecar path too", async () => {
    // The seductive shortcut: "no sidecar, nothing to wait for". It is correct
    // for exactly one session of one board and wrong for every session after it,
    // and only a probe held open on an EMPTY disk can see the difference.
    const io = gatedIO();
    const { sync, canvasSync } = await wire(io);

    const release = io.hold("exists");
    const pending = canvasSync.subscribe(PATH, "guest");
    await drain();

    expect(
      sync.synced,
      "peer sync began before the sidecar probe answered on an empty disk",
    ).toEqual([]);

    release();
    await pending;

    expect(sync.synced).toEqual([canvasDocId(GUID)]);
    expect(canvasSync.isSubscribed(PATH)).toBe(true);

    canvasSync.destroy();
  });

  it("the load VERDICT is known before peer sync, not merely started", async () => {
    // "Loaded" is a completed operation with a degradation verdict, and that
    // verdict is what says whether this replica is related to the peer's. A load
    // still in flight at sync time answers nothing.
    const io = gatedIO();
    await primeSidecar(io, ["m-1"]);
    const store = createSidecarStore(io);
    const lifecycle = createSidecarLifecycle(store);
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);

    const result = await lifecycle.load(GUID, doc);

    expect(result.degradation).toBe("none");
    expect(result.checkpointApplied).toBe(true);
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()]).toEqual(["m-1"]);

    await lifecycle.destroy();
  });

  it("a CORRUPT sidecar is a verdict, not a throw, and still precedes peer sync", async () => {
    // AC1's ordering must survive WP24's degradation path. A load that threw
    // would abort the subscribe; a load that ran after peer sync would leave the
    // board syncing against a replica whose own history it never inspected.
    const io = gatedIO();
    await primeSidecar(io, ["m-1"]);
    // Corrupt the checkpoint in place.
    for (const [path, bytes] of io.files) {
      if (path.endsWith(".ycheckpoint")) {
        io.files.set(path, Uint8Array.from([...bytes.slice(0, 2), 0xff, 0x7f, 0xde, 0xad]));
      }
    }

    const { sync, canvasSync } = await wire(io);
    await canvasSync.subscribe(PATH, "guest");

    expect(canvasSync.isSubscribed(PATH), "a corrupt sidecar aborted the subscribe").toBe(true);
    expect(sync.synced).toEqual([canvasDocId(GUID)]);
    // AC3 of WP24: nothing at all is applied on a degraded verdict.
    expect(
      [...(sync.docs.get(canvasDocId(GUID)) as { doc: Y.Doc }).doc
        .getMap<Y.Map<unknown>>("nodes")
        .keys()],
      "a partially applied sidecar reached the doc",
    ).toEqual([]);

    canvasSync.destroy();
  });
});
