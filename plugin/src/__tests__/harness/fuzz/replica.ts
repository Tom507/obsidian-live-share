// WP23 — ONE SIMULATED REPLICA.
//
// A replica is the whole client-side data path for one peer, not a bare `Y.Doc`:
//
//   ├── its own `Y.Doc` (its own random `clientID`, as in production),
//   ├── its own `CanvasSync` — the capture path, the Surface-Shadow, the
//   │      tombstone wiring (WP19) and the quarantine auditor (WP20) all live
//   │      there, so an op routed through `handleLocalModify` exercises the real
//   │      production boundary rather than a stand-in,
//   ├── its own in-memory vault, so an "Obsidian save" is a real file write
//   │      followed by a real `handleLocalModify`, and
//   └── its own OUTBOX of locally-authored Yjs updates, which the scheduler
//          delivers to the replicas that share its partition — reordered and
//          sometimes duplicated.
//
// AC1 REQUIRES 3–5 REPLICAS, NEVER 2. With two peers an agreed-but-wrong outcome
// and a genuinely converged one are the same picture, and the interleaving
// classes that only appear from three peers upward — one replica receiving two
// other replicas' concurrent verdicts and having to treat neither as news — are
// exactly where a repair pass goes wrong.
//
// No wall-clock sleeps and no new timing constants: `CanvasSync`'s audit
// debounce is driven by the caller's injected `flushTimers` (fake timers in the
// suite), which is why this module takes one rather than importing `vi`.

import { TFile } from "obsidian";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync, DELETED_MAP_NAME } from "../../../files/canvas-sync";

/** Origin stamped on every harness-delivered peer update — never a local write. */
export const FUZZ_REMOTE_ORIGIN: unique symbol = Symbol("wp23-fuzz-remote");

/** One locally-authored Yjs update waiting to be delivered to a partition peer. */
export interface OutboxItem {
  readonly from: number;
  readonly serial: number;
  readonly update: Uint8Array;
}

/**
 * A shadow-consistency violation this replica committed: it pushed a value its
 * own surface had gone stale on, over a newer value the doc already held.
 *
 * This is the W1 discriminant, and it is recorded as DATA rather than thrown so
 * a single scenario can report every violation it produced instead of only the
 * first.
 */
export interface StalePush {
  readonly replica: number;
  readonly kind: "node" | "edge";
  readonly id: string;
  readonly field: string;
  readonly staleValue: unknown;
  readonly expectedValue: unknown;
}

/** An I7 violation: a partial capture removed a field it never mentioned (WP22). */
export interface FieldRemoval {
  readonly replica: number;
  readonly kind: "node" | "edge";
  readonly id: string;
  readonly field: string;
  readonly before: unknown;
}

/** A WP21 observation: whether a local write was allowed to reach this replica's doc. */
export interface WriteAdmission {
  readonly replica: number;
  readonly kind: "node" | "edge";
  readonly id: string;
  readonly field: string;
  readonly intended: unknown;
  /**
   * What the replica's OWN doc held immediately after its own local write.
   *
   * WP36 follow-up (B32) — this is a SNAPSHOT, and it has to be. `text` and
   * `label` are nested `Y.Text`s now, so storing the doc value here stored a
   * LIVE REFERENCE: by the time the oracle ran at the end of the scenario,
   * `landed.toString()` was the final converged string, not the string this
   * replica held at the instant of its own write. The check silently stopped
   * measuring write ADMISSION and started measuring convergence — a green that
   * cannot fail, in the family whose whole job is to catch a denied write.
   */
  readonly landed: unknown;
  /**
   * WP36 follow-up (B32): the doc-level SHAPE of the field right after the
   * write, for the two collaborative-text fields. `undefined` for every other
   * field, which is what keeps this additive.
   *
   * `"string"` here means the capture wrote a plain value over the
   * collaborative text — C36 AC1's "never replaced by a plain value", i.e. the
   * un-migration defect that reads like flaky sync.
   */
  readonly shape?: "ytext" | "string" | "absent" | "other";
  /**
   * WP36 follow-up (B32): the characters THIS author contributed, for a
   * collaborative-text field. Set ⇒ the oracle judges admission by "my
   * characters are in my doc" instead of by "my whole string is my doc", which
   * is the only form of the question that still means anything once the field
   * merges rather than overwrites.
   */
  readonly contribution?: string;
  /**
   * WP36 follow-up (B32): `true` only where WP36 GUARANTEES a nested `Y.Text`
   * afterwards — an EDIT to an existing record's text through the real capture
   * path. Deliberately NOT set for a record CREATION (the migration is lazy and
   * write-triggered: a record the local user has not edited keeps its plain
   * string, C36 AC5) nor for the `CanvasBinding` write path (`useCanvasBinding`
   * is `false` and frozen until P5, so WP36 never claimed it).
   */
  readonly expectYText?: boolean;
}

export interface FuzzReplica {
  readonly index: number;
  readonly path: string;
  readonly doc: Y.Doc;
  readonly sync: CanvasSync;
  readonly outbox: OutboxItem[];
  /** Signatures the capture path logged — narration only, never an oracle. */
  readonly signatures: string[];
  readonly stalePushes: StalePush[];
  readonly fieldRemovals: FieldRemoval[];
  readonly writeAdmissions: WriteAdmission[];
  /**
   * WP21: a BASELINE-HOLD artefact — the replica held local state back after a
   * write it should simply have made. One string per occurrence, because the
   * useful part is the sentence, not a shape.
   */
  readonly lwwArtefacts: string[];
  /** Op-owned scratch space (e.g. the snapshot a stale-save op replays). */
  readonly scratch: Map<string, unknown>;
  /** The simulated Obsidian view state consulted at every save. Mutable by ops. */
  surface: { viewOpen: boolean; handedToView: { node: Set<string>; edge: Set<string> } };
  /** The last `.canvas` text this replica's simulated Obsidian actually saved. */
  lastSavedContent: string | null;
  /** The window in which that save happened — the age of this replica's surface. */
  lastSavedWindow: number;
  nodes(): Y.Map<Y.Map<unknown>>;
  edges(): Y.Map<Y.Map<unknown>>;
  deleted(): Y.Map<unknown>;
  /** Write the `.canvas` file this replica's Obsidian would have written. */
  writeFile(content: string): void;
  readFile(): string;
  destroy(): void;
}

interface FakeVault {
  files: Map<string, string>;
  read(file: { path: string }): Promise<string>;
  adapter: {
    write(path: string, content: string): Promise<void>;
    read(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
  };
  getAbstractFileByPath(path: string): TFile | null;
}

function createVault(): FakeVault {
  const files = new Map<string, string>();
  return {
    files,
    read: async (file: { path: string }) => files.get(file.path) ?? "",
    adapter: {
      write: async (path: string, content: string) => {
        files.set(path, content);
      },
      read: async (path: string) => files.get(path) ?? "",
      exists: async (path: string) => files.has(path),
    },
    getAbstractFileByPath: (path: string) => {
      if (!files.has(path)) return null;
      const file = new TFile();
      file.path = path;
      return file;
    },
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
    releaseDoc() {},
    async waitForSync() {},
  };
}

/**
 * Build one replica, subscribed as a GUEST.
 *
 * Guest and not host on purpose: the host branch of `subscribe` seeds the doc
 * FROM its local file and establishes an echo baseline, which would make replica
 * 0 structurally different from the others. Every replica here starts from the
 * same seeded doc state and the same empty surface, so no replica is privileged.
 */
export async function createReplica(
  index: number,
  path: string,
  options: {
    /**
     * WP36 follow-up (B32) — the PRE-WP36 CONTROL SEAM, per replica. `false`
     * builds a replica whose capture writes `text`/`label` as a whole-string
     * LWW register, i.e. the behaviour WP36 replaced. It exists so the
     * `text-merge` family can be shown RED against the oracle it succeeded,
     * inside the fuzzer, over the same seeds.
     */
    readonly collabText?: boolean;
  } = {},
): Promise<FuzzReplica> {
  const vault = createVault();
  const syncManager = createSyncManager();
  const signatures: string[] = [];
  const sync = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: () => {}, unmutePathEvents: () => {} } as never,
  );
  sync.setCollabTextEnabled(options.collabText ?? true);
  sync.setLogger({
    debug: (_category: string, message: string) => {
      signatures.push(message);
    },
    warn: (_category: string, message: string) => {
      signatures.push(message);
    },
  });

  const surface = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  sync.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: surface.viewOpen,
      handedToView: surface.handedToView,
    }),
  );

  // The file must exist before `subscribe`, because `handleLocalModify` returns
  // early for a path with no file at all.
  vault.files.set(path, "");
  await sync.subscribe(path, "guest");

  const doc = syncManager.getDoc(`__canvas__:${path}`).doc;
  const outbox: OutboxItem[] = [];
  let serial = 0;
  const onUpdate = (update: Uint8Array, _origin: unknown, _doc: Y.Doc, tr: Y.Transaction): void => {
    // Only LOCALLY AUTHORED updates enter the outbox. Everything this replica
    // merely integrated is already in its author's outbox, and the end-of-window
    // full-mesh catch-up is what closes any gap a partition left.
    if (!tr.local) return;
    outbox.push({ from: index, serial: serial++, update });
  };
  doc.on("update", onUpdate);

  return {
    index,
    path,
    doc,
    sync,
    outbox,
    signatures,
    stalePushes: [],
    fieldRemovals: [],
    writeAdmissions: [],
    lwwArtefacts: [],
    scratch: new Map<string, unknown>(),
    surface,
    lastSavedContent: null,
    lastSavedWindow: -1,
    nodes: () => doc.getMap<Y.Map<unknown>>("nodes"),
    edges: () => doc.getMap<Y.Map<unknown>>("edges"),
    deleted: () => doc.getMap<unknown>(DELETED_MAP_NAME),
    writeFile: (content: string) => {
      vault.files.set(path, content);
    },
    readFile: () => vault.files.get(path) ?? "",
    destroy: () => {
      doc.off("update", onUpdate);
      sync.destroy();
    },
  };
}

/** The record container for one kind, on one replica. */
export function container(replica: FuzzReplica, kind: "node" | "edge"): Y.Map<Y.Map<unknown>> {
  return kind === "node" ? replica.nodes() : replica.edges();
}
