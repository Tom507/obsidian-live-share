import { SIDECAR_DIR, type SidecarIO, seedRefusalStorePath } from "./canvas-sidecar";
import { INGEST_BOUNDARY, type SeedRefusal } from "./canvas-sync";

// ---------------------------------------------------------------------------
// WP90 / I11 — the durable home of the refused set.
//
// WP63 built the withhold and scoped it to one session. The composition that
// scope missed is one restart long: session 2 opens the board with a doc the
// relay (or the sidecar) already holds, `CanvasPersistence.coldOpen` takes its
// `doc-wins` branch, NEVER READS THE FILE, and flushes the projection — which
// has never contained the refused record — over the user's `.canvas`. The
// record is gone, deleted as a consequence of a refusal. That is I11 verbatim,
// one restart later, and I11 says NEVER, not "not yet".
//
// This module is ONLY the place the answer is kept. It owns no vocabulary:
//   ├── the refusal is `SeedRefusal` (`canvas-sync.ts`), not a second shape,
//   ├── the predicate is `SeedRefusalLedger.hasRefusals()`, not a second one,
//   ├── the lift is `isSeedRefusalResolved`, asked on the write trigger by
//   │   `CanvasPersistence.writeIsWithheld` — this module adds NO second lift
//   │   trigger and reads no clock, and
//   └── the I/O is WP24's `SidecarIO`, not a second file seam.
//
// FIVE PROPERTIES CARRY IT, and each of them is an acceptance criterion rather
// than a preference:
//
//   1. IDS, REASONS AND BOUNDARIES ONLY. {@link projectRefusal} is the ONE gate
//      in both directions — nothing is written that it does not admit, and
//      nothing is read that it does not admit. A durable store that keeps a
//      copy of the record's CONTENT is Ä3's rejected pass-through wearing a
//      coat (`AMENDMENT_DISPOSITION.md` R8), so no user text, no node content
//      and no `.canvas` payload can reach these bytes even if `SeedRefusal`
//      later grows a field that carries one.
//   2. NOTHING IS RE-INJECTED. This module has no route to `serializeCanvas`,
//      to the doc, or to any `.canvas` write. A withhold produces no bytes, so
//      C17 AC3 (cross-replica byte equality) is not exercised, not merely not
//      violated.
//   3. LOCAL-ONLY, PEER-UNREACHABLE. The one path is {@link seedRefusalStorePath},
//      spelled inside `SIDECAR_DIR`, so WP26's directory-prefix exclusion
//      (`isSidecarPath`) covers it BY CONSTRUCTION: it can never be published
//      into a manifest, never enter a file-op payload and never be reachable
//      from a peer. WP68 is unbuilt and its subject is that a peer-reachable
//      write under `.obsidian/**` is a code-execution surface; this opens no
//      second one.
//   4. DEFINED DEGRADATION, NEVER A NEW FAILURE MODE. A store that cannot be
//      read degrades to exactly WP63's in-memory behaviour — never a throw, and
//      never a SILENT full-trust "no refusals". An unreadable file is narrated
//      and QUARANTINED: the bytes are left alone, so a read that failed cannot
//      launder itself into the file, and forensics survive.
//   5. HYDRATION AND PERSISTENCE ARE DIFFERENT EVENTS. Reading never writes.
//      That rule is enforced at the other end (`SeedRefusalLedger.restore` does
//      not report, and the sink is assigned after it) and it is why `load` here
//      has no write path at all.
// ---------------------------------------------------------------------------

/** Schema stamp of the store file. Bumped only if the on-disk shape changes. */
export const SEED_REFUSAL_STORE_VERSION = 1;

/**
 * What `CanvasPersistence` needs of the store, as a seam.
 *
 * `save` is deliberately SYNCHRONOUS-looking: it is called from
 * `SeedRefusalLedger`'s sink, i.e. from inside `note()` / `reset()` / `prune()`,
 * and those are synchronous by contract (a seed boundary and a write decision
 * cannot await). The store serialises the resulting writes itself.
 */
export interface DurableSeedRefusals {
  load(canvasPath: string): Promise<readonly SeedRefusal[]>;
  save(canvasPath: string, refusals: readonly SeedRefusal[]): void;
}

/**
 * How the last read went. Reported rather than inferred, because "no refusals"
 * and "the file could not be read" must never look the same from outside.
 *
 *   ├── `absent`     — no store file yet. The ordinary first-run state.
 *   ├── `loaded`     — parsed, every entry admitted.
 *   ├── `partial`    — parsed, some entries dropped. Writes still allowed: the
 *   │                  entries that WERE read are known good, and unparseable
 *   │                  entries for OTHER paths are carried through untouched.
 *   └── `unreadable` — the file exists and its root did not parse. QUARANTINED:
 *                      no write of any kind, so the bytes are preserved.
 */
export type SeedRefusalStoreHealth = "absent" | "loaded" | "partial" | "unreadable";

export interface SeedRefusalStoreLogger {
  debug(category: string, message: string): void;
  warn?(category: string, message: string): void;
}

const LOG_CATEGORY = "seed-refusal-store";

/** The boundaries WP18 actually gates. Derived from the enum, never re-listed. */
const KNOWN_BOUNDARIES: ReadonlySet<string> = new Set<string>(Object.values(INGEST_BOUNDARY));

/**
 * THE one gate, used in BOTH directions (property 1).
 *
 * On the way in it validates; on the way out it PROJECTS — the returned object
 * is rebuilt field by field from the four `SeedRefusal` keys, never spread, so
 * a refusal object carrying anything else leaves that behind at the door.
 *
 * `boundary` and `kind` are checked against their definers because the lift
 * (`isSeedRefusalResolved`) re-asks the ingest gate with exactly those two plus
 * `id`; a wrong value there would ask the wrong question. `reason` is checked
 * only for "a non-empty string": it is narration, it never steers a decision,
 * and enumerating `IngestReasonCode` here would be a second copy of a
 * vocabulary that already has one owner (`canvas/canvas-ingest-schema.ts`).
 */
export function projectRefusal(value: unknown): SeedRefusal | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const { boundary, kind, id, reason } = candidate;
  if (typeof boundary !== "string" || !KNOWN_BOUNDARIES.has(boundary)) return null;
  if (kind !== "node" && kind !== "edge") return null;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof reason !== "string" || reason.length === 0) return null;
  return {
    boundary: boundary as SeedRefusal["boundary"],
    kind,
    id,
    reason: reason as SeedRefusal["reason"],
  };
}

interface StoreRoot {
  version: number;
  paths: Record<string, unknown>;
}

/** The one on-disk form. Used to write, and to prime the no-op comparison. */
function serializeRoot(root: StoreRoot): string {
  return `${JSON.stringify(root, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The refused set for every canvas path in this vault, in one file.
 *
 * ONE file rather than one per canvas, for a reason that is about the failure
 * mode and not about tidiness: a per-canvas store would name the canvas in a
 * FILENAME, and a filename is the one part of a path that a directory listing
 * exposes. The set is small (ids and reason codes), it is read once per
 * process, and the rewrite preserves every path entry it did not itself change
 * — including entries it could not parse.
 */
export class SeedRefusalStore implements DurableSeedRefusals {
  private readonly io: SidecarIO;
  private readonly logger?: SeedRefusalStoreLogger;
  private readonly filePath = seedRefusalStorePath();

  /** The raw parsed root, kept so a rewrite never drops another path's entry. */
  private root: StoreRoot | undefined;
  private loading: Promise<void> | undefined;
  private health: SeedRefusalStoreHealth = "absent";
  /** True once a read failed: no write may follow, or the failure launders. */
  private quarantined = false;
  private quarantineNarrated = false;
  /** Last bytes handed to the queue, so an unchanged set writes nothing. */
  private lastQueued: string | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(io: SidecarIO, opts: { logger?: SeedRefusalStoreLogger } = {}) {
    this.io = io;
    this.logger = opts.logger;
  }

  /** How the last read went. `absent` until one has happened. */
  describeHealth(): SeedRefusalStoreHealth {
    return this.health;
  }

  /** True while a failed read is suppressing every write (property 4). */
  isQuarantined(): boolean {
    return this.quarantined;
  }

  /** The one path this store ever touches. */
  storePath(): string {
    return this.filePath;
  }

  /**
   * The standing refusals for one canvas path.
   *
   * Never throws and never writes. An unreadable file answers `[]` — the same
   * answer WP63 gives with no store at all — and says so, loudly, exactly once.
   */
  async load(canvasPath: string): Promise<readonly SeedRefusal[]> {
    await this.ensureLoaded();
    const root = this.root;
    if (root === undefined) return [];
    const entry = root.paths[canvasPath];
    if (entry === undefined) return [];
    if (!Array.isArray(entry)) {
      this.health = "partial";
      this.logger?.warn?.(
        LOG_CATEGORY,
        `SEED REFUSAL STORE: ${canvasPath} entry is not a list — ignored, ` +
          "degrading to the in-memory refused set for this path",
      );
      return [];
    }
    const admitted: SeedRefusal[] = [];
    let dropped = 0;
    for (const raw of entry) {
      const refusal = projectRefusal(raw);
      if (refusal === null) dropped += 1;
      else admitted.push(refusal);
    }
    if (dropped > 0) {
      this.health = "partial";
      this.logger?.warn?.(
        LOG_CATEGORY,
        `SEED REFUSAL STORE: ${canvasPath} dropped ${dropped} unreadable entr${
          dropped === 1 ? "y" : "ies"
        }, kept ${admitted.length}`,
      );
    }
    return admitted;
  }

  /**
   * Record this path's refused set.
   *
   * Fire-and-forget by signature because the callers are synchronous (a seed
   * boundary and a write decision), serialised internally because two paths
   * share one file. Idempotent against the bytes: an unchanged set writes
   * nothing, which matters because `prune()` reports on EVERY withheld flush.
   */
  save(canvasPath: string, refusals: readonly SeedRefusal[]): void {
    // The chain is extended SYNCHRONOUSLY, before the first await, so that a
    // caller which then awaits `idle()` is guaranteed to be waiting for THIS
    // save. Deferring the enqueue behind `ensureLoaded()` would make `idle()`
    // a sleep-shaped no-op that resolves before the write it stands for — the
    // liveness class this run has already been bitten by.
    this.queue = this.queue
      .then(() => this.persist(canvasPath, refusals))
      .catch((err) => {
        // A rejection here would POISON the chain and silently stop every later
        // save. The store degrades to WP63 instead, and says so.
        this.logger?.warn?.(
          LOG_CATEGORY,
          `SEED REFUSAL STORE: ${canvasPath} could not be recorded (${String(err)}) — ` +
            "the refused set stays in memory for this session",
        );
      });
  }

  /** `save` with the promise exposed — for teardown and for tests. */
  saveNow(canvasPath: string, refusals: readonly SeedRefusal[]): Promise<void> {
    this.save(canvasPath, refusals);
    return this.queue;
  }

  private async persist(canvasPath: string, refusals: readonly SeedRefusal[]): Promise<void> {
    await this.ensureLoaded();
    if (this.quarantined) {
      // Property 4: the read failed, so the file's bytes are the only surviving
      // record of whatever was there. Overwriting them with a set derived from
      // a failed read is exactly the laundering this store must not do.
      if (!this.quarantineNarrated) {
        this.quarantineNarrated = true;
        this.logger?.warn?.(
          LOG_CATEGORY,
          `SEED REFUSAL STORE: ${this.filePath} is quarantined — refusals stay ` +
            "in memory for this session and the unreadable bytes are left intact",
        );
      }
      return;
    }
    const root = this.root ?? { version: SEED_REFUSAL_STORE_VERSION, paths: {} };
    this.root = root;
    const projected: SeedRefusal[] = [];
    for (const refusal of refusals) {
      const admitted = projectRefusal(refusal);
      if (admitted !== null) projected.push(admitted);
    }
    // An empty set DELETES the entry rather than storing `[]`: "this path has no
    // standing refusal" and "this path was never seen" must behave identically,
    // and the lift (`prune`) reaching empty is the normal way an entry ends.
    if (projected.length === 0) delete root.paths[canvasPath];
    else root.paths[canvasPath] = projected;

    const content = serializeRoot(root);
    // Nothing changed, so nothing is written. `lastQueued` is primed from the
    // file as it was READ, not left undefined, so a session that refuses nothing
    // never touches the file at all — and a store that already says exactly this
    // is not rewritten just because a ledger reported.
    if (content === this.lastQueued) return;
    this.lastQueued = content;
    await this.writeFile(content);
  }

  /** Resolve once every queued write has landed. Teardown and tests. */
  async idle(): Promise<void> {
    await this.queue;
  }

  private async writeFile(content: string): Promise<void> {
    try {
      await this.io.ensureDir(SIDECAR_DIR);
      await this.io.write(this.filePath, encoder.encode(content));
    } catch (err) {
      // The write never landed. Roll the marker back so an identical later set
      // is retried rather than deduplicated away, and degrade — a store that
      // cannot be written is WP63, which is the state this session was already
      // safe in.
      if (this.lastQueued === content) this.lastQueued = undefined;
      this.logger?.warn?.(
        LOG_CATEGORY,
        `SEED REFUSAL STORE: ${this.filePath} write FAILED (${String(err)}) — ` +
          "the refused set stays in memory for this session",
      );
    }
  }

  /** Read the file at most once per process. Concurrent callers share the read. */
  private ensureLoaded(): Promise<void> {
    this.loading ??= this.loadFile();
    return this.loading;
  }

  private async loadFile(): Promise<void> {
    try {
      if (!(await this.io.exists(this.filePath))) {
        this.adoptRoot({ version: SEED_REFUSAL_STORE_VERSION, paths: {} }, "absent");
        return;
      }
      const bytes = await this.io.read(this.filePath);
      const text = decoder.decode(bytes);
      if (text.trim().length === 0) {
        // Zero bytes is not corruption: it is the shape a crashed or truncated
        // write leaves behind, and it carries no claim to preserve.
        this.adoptRoot({ version: SEED_REFUSAL_STORE_VERSION, paths: {} }, "absent");
        return;
      }
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed) || !isRecord(parsed.paths)) {
        this.quarantine("root is not a { version, paths } object");
        return;
      }
      this.adoptRoot(
        {
          version: typeof parsed.version === "number" ? parsed.version : SEED_REFUSAL_STORE_VERSION,
          paths: parsed.paths,
        },
        "loaded",
      );
    } catch (err) {
      this.quarantine(String(err));
    }
  }

  /**
   * Take a freshly read root as the current one, and prime the no-op comparison
   * with its CANONICAL form — not with the bytes as they were on disk, because
   * a file written by an older formatting would then be rewritten once and only
   * once, which is churn without meaning.
   */
  private adoptRoot(root: StoreRoot, health: SeedRefusalStoreHealth): void {
    this.root = root;
    this.health = health;
    this.lastQueued = serializeRoot(root);
  }

  private quarantine(why: string): void {
    this.root = undefined;
    this.health = "unreadable";
    this.quarantined = true;
    this.logger?.warn?.(
      LOG_CATEGORY,
      `SEED REFUSAL STORE: ${this.filePath} UNREADABLE (${why}) — every path ` +
        "degrades to the in-memory refused set and the file is left untouched",
    );
  }
}
