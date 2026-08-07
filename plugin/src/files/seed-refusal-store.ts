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

// ---------------------------------------------------------------------------
// WP92 / I11 — WHAT WP90 LEFT: THE KEY, ITS LIFETIME, AND THE SILENCE.
//
// WP90's founding argument was "a protection with a lifetime is not 'never', it
// is 'not yet'". It was right and it did not finish: the repair moved the
// withhold's lifetime from the session to the KEY, and the key was `diskPath` —
// `toLocalPath(toCanonicalPath(raw))`, a property of the running HOST and of the
// file's current NAME. Three things follow, and only the second is reachable:
//
//   ├── S63, the host half. MECHANISM real, REPRODUCTION FALSIFIED and it must
//   │   not be re-inherited: `toLocalPath(toCanonicalPath(x))` is the IDENTITY
//   │   for every name Windows can actually hold, because the mismatch needs a
//   │   raw ASCII `? * < > " | :` in the on-disk filename — exactly the class
//   │   NTFS refuses and exactly the class our own materialiser rewrites to
//   │   fullwidth before writing. Closed here on DISCIPLINE grounds: a defect
//   │   that is invisible until the day the character map grows a member.
//   ├── ⭐ THE RENAME ORPHAN, and it has no platform in it. `CanvasSync`'s
//   │   `handleRename` re-keys `guidByPath`, the manifest guid, every
//   │   `index.json` row and (via `rekeyPathState`) the in-memory
//   │   `seedRefusalLedgers` — and tells THIS MODULE NOTHING. So the old key
//   │   holds the only record that a record was ever refused, the new path's
//   │   cold open loads `[]`, `coldOpen` takes `doc-wins`, never reads the file,
//   │   and flushes the projection over it. WP90's cascade in full, one machine,
//   │   one ordinary user gesture. THAT is what the key change is for.
//   └── the CLASS both of them belong to: a stored entry that no lookup ever
//       asks for produces NO SIGNAL OF ANY KIND. Not a warning, not a counter,
//       not a health value. The key repair closes two instances;
//       {@link SeedRefusalStore.unmatchedEntries} closes the class, and it is
//       what would have found the orphan inside WP90's own batch.
//
// THE KEY IS NOW THE DOCUMENT'S IDENTITY TOKEN — WP27's guid, the same token
// `canvasDocId`, `<guid>.yhistory`, `<guid>.ycheckpoint` and `index.json`'s KEYS
// are built from. It survives a rename because a rename does not change which
// document a file is, and it survives a platform because it is not a filename.
// It is chosen INSTEAD of the canonical path (which agrees with every neighbour
// and still dies at the first rename) and INSTEAD of a dual guid+path key (which
// would put a second vocabulary inside the one file this work package exists to
// give ONE vocabulary).
//
// NO CLOCK ENTERS THIS MODULE, and that is an acceptance criterion rather than a
// preference: "drop entries older than N days" would close the orphan by
// RE-CREATING WP90's defect one lifetime further out. An entry's validity is a
// fact about the document, never about elapsed time. The one timer in this file
// ({@link SEED_REFUSAL_FLUSH_TIMEOUT_MS}) bounds a TEARDOWN and never reaches an
// entry — see {@link flushSeedRefusalStore}.
// ---------------------------------------------------------------------------

/**
 * Schema stamp of the store file. Bumped only if the on-disk shape changes.
 *
 * WP92 bumped it 1 → 2. The `{ version, paths }` envelope is byte-identical, but
 * the VOCABULARY of `paths`' keys changed from a `diskPath` to the document's
 * identity token, and "what a key means" is part of an on-disk shape in every
 * sense that matters to a reader. The stamp is a statement, not a gate: the
 * legacy fallback in `CanvasPersistence.hydrateDurableRefusals` is NOT
 * conditioned on it, because a version-2 file can still carry an unmigrated
 * version-1 key for any canvas that has not been opened since the upgrade.
 */
export const SEED_REFUSAL_STORE_VERSION = 2;

/**
 * How long {@link flushSeedRefusalStore} waits for the queue before giving up.
 *
 * THE ONE TIMER IN THIS MODULE, and its subject is a teardown rather than an
 * entry. Without a bound, an `io.write` that never settles is a plugin that
 * never unloads; with it, the worst case is a lost write, which is exactly the
 * state S64 describes and no worse than today. Under S71 a `setTimeout` bound
 * can itself stretch on a clamped renderer, so the user-visible worst case is
 * "unload waits for one animation-frame-clamped timer" rather than this number.
 */
export const SEED_REFUSAL_FLUSH_TIMEOUT_MS = 2_000;

/**
 * What `CanvasPersistence` needs of the store, as a seam.
 *
 * `save` is deliberately SYNCHRONOUS-looking: it is called from
 * `SeedRefusalLedger`'s sink, i.e. from inside `note()` / `reset()` / `prune()`,
 * and those are synchronous by contract (a seed boundary and a write decision
 * cannot await). The store serialises the resulting writes itself.
 */
export interface DurableSeedRefusals {
  load(canvasKey: string): Promise<readonly SeedRefusal[]>;
  save(canvasKey: string, refusals: readonly SeedRefusal[]): void;
  /**
   * WP92 (AC2): move an entry from a legacy key to the current one, ONCE.
   *
   * Optional on the seam and required of nothing: a caller that cannot migrate
   * still finds its entry, because the lookup falls back to the legacy key on
   * its own. Absent, the legacy entry simply stays in the file under a key that
   * the census then reports — which is the whole point of the census.
   *
   * It is deliberately NOT part of `load`. Property 5 says hydration and
   * persistence are different events, and "write the migrated form the moment
   * you read the old one" is the exact shape that would break it.
   */
  migrate?(fromKey: string, toKey: string): void;
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
  /**
   * WP92 (AC3): every key a `load()` in THIS PROCESS has asked for — whether or
   * not it hit. This is the half that makes an unmatched entry observable, and
   * it is deliberately "asked", not "found": the two senses are different
   * questions and {@link askedButAbsent} answers the other one.
   */
  private readonly askedKeys = new Set<string>();
  /**
   * WP92 (AC3(d)): keys a `load()` asked for and the store had NO entry for.
   *
   * Kept apart from {@link askedKeys} because conflating them is how a census
   * becomes a lie: a vault with fifty canvases and one open board would report
   * forty-nine "orphans" if "unmatched" meant "no canvas is currently attached".
   * `unmatchedEntries()` is "stored and never asked"; this is "asked and not
   * stored". A report that does not say which one it is quoting says nothing.
   */
  private readonly missedKeys = new Set<string>();

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

  /** The `version` stamp the file was READ with. Reported, never enforced. */
  storedVersion(): number | undefined {
    return this.root?.version;
  }

  /**
   * ── WP92 (C92 AC3): THE ENTRY NOBODY EVER ASKED FOR ───────────────────────
   *
   * Every stored key that no `load()` in this process has named, in file order.
   *
   * THIS IS THE CRITERION, and the silence is the defect. Before this method the
   * rename orphan, a hand-edited typo, a platform mismatch and every future key
   * defect nobody has thought of yet all produced the SAME observable: nothing.
   * The key repair closes two of those; this closes the class.
   *
   * SENSE: "stored, and never asked in this process". It is NOT "orphaned" and
   * NOT "stale" — the store cannot tell whether an entry is wrong or merely not
   * needed yet, and a name that asserted either would be a claim this object
   * cannot support. A vault whose canvases are simply closed reports them here
   * and that is CORRECT; the number is a prompt, never a verdict.
   *
   * A quarantined or unread store answers `[]` rather than guessing — there is
   * no root to count, and inventing zero would be the "0 violations from an
   * empty input set" shape this run has been bitten by twelve times.
   */
  unmatchedEntries(): readonly string[] {
    const root = this.root;
    if (root === undefined) return [];
    return Object.keys(root.paths).filter((key) => !this.askedKeys.has(key));
  }

  /** WP92 (AC3(d)): the OTHER sense — keys asked for that the store had not got. */
  askedButAbsent(): readonly string[] {
    return [...this.missedKeys];
  }

  /** WP92: every key a `load()` has named in this process. The census's denominator. */
  askedEntries(): readonly string[] {
    return [...this.askedKeys];
  }

  /**
   * WP92 (BUILD_SPEC §10): the ONE production emitter of `SEED REFUSAL UNMATCHED:`.
   *
   * Returns the count so a caller — and a test — can be an oracle over STATE
   * rather than over the line. Under S65 a zero-line read of the debug log is
   * not an absence, and this method's entire subject is a thing that produces no
   * line; so the counter is the evidence and the signature is corroboration.
   *
   * PATH AND COUNT ONLY. Never a refusal's reason string, never a node id's
   * content, never file bytes.
   */
  reportUnmatched(): number {
    const unmatched = this.unmatchedEntries();
    if (unmatched.length === 0) return 0;
    this.logger?.warn?.(
      LOG_CATEGORY,
      `SEED REFUSAL UNMATCHED: ${unmatched.length} stored entr${
        unmatched.length === 1 ? "y" : "ies"
      } never looked up — ${unmatched.join(", ")}`,
    );
    return unmatched.length;
  }

  /**
   * ── WP92 (C92 AC2): THE MIGRATION, AND IT IS A WRITE ──────────────────────
   *
   * Move `fromKey`'s entry to `toKey`, once. The cheap answer — "start fresh,
   * the old entries just stop matching" — is PRECISELY the defect this work
   * package exists to close, so it is not available.
   *
   * THREE PROPERTIES, each of which is asserted rather than assumed:
   *
   *   1. IT IS QUEUED LIKE A SAVE, synchronously, before the first await — so a
   *      caller that then awaits `idle()` is waiting for THIS migration. That is
   *      S64's whole point and it is why AC4 is a precondition of AC2 rather
   *      than a neighbour of it: a migration lost at unload leaves a file with
   *      entries under two vocabularies and no way to say which is authoritative,
   *      which is strictly WORSE than not having migrated at all.
   *   2. IT IS IDEMPOTENT ON THE FILE, not on an in-memory object. A second call
   *      finds `fromKey` gone and returns before serialising; even if it did
   *      serialise, `lastQueued` compares BYTES, so the round trip through
   *      `SidecarIO` is the only place the property actually lives.
   *   3. IT MOVES THE RAW ENTRY, unprojected. `load` already refused to hand out
   *      anything `projectRefusal` rejects, so re-projecting here would only be a
   *      second chance to drop a byte the file is entitled to keep. Every OTHER
   *      key — including one that cannot be parsed — is untouched, which is
   *      WP90's own rewrite property.
   *
   * A quarantined store migrates NOTHING (property 4): the bytes are the only
   * surviving record of whatever was there, and moving keys around inside a read
   * that failed is exactly the laundering the quarantine exists to prevent.
   */
  migrate(fromKey: string, toKey: string): void {
    if (fromKey === toKey) return;
    this.queue = this.queue
      .then(() => this.performMigrate(fromKey, toKey))
      .catch((err) => {
        this.logger?.warn?.(
          LOG_CATEGORY,
          `SEED REFUSAL STORE: ${fromKey} could not be re-keyed (${String(err)}) — ` +
            "the entry is left where it is and stays reachable through the legacy lookup",
        );
      });
  }

  private async performMigrate(fromKey: string, toKey: string): Promise<void> {
    await this.ensureLoaded();
    if (this.quarantined) {
      this.narrateQuarantine();
      return;
    }
    const root = this.root;
    if (root === undefined) return;
    const entry = root.paths[fromKey];
    // Already migrated (or never there). Idempotence lives here, not in a flag.
    if (entry === undefined) return;
    // A collision means both vocabularies named the same document and the
    // CURRENT key is authoritative — dropping the legacy one is the migration.
    if (root.paths[toKey] === undefined) root.paths[toKey] = entry;
    delete root.paths[fromKey];
    // The entry now lives under a key this process demonstrably asked for, so it
    // must not be reported as "never looked up" by the very move that saved it.
    this.askedKeys.add(toKey);
    this.missedKeys.delete(toKey);

    const content = serializeRoot(root);
    if (content === this.lastQueued) return;
    this.lastQueued = content;
    await this.writeFile(content);
    this.logger?.debug(
      LOG_CATEGORY,
      `SEED REFUSAL STORE: re-keyed 1 entry ${fromKey} → ${toKey} ` +
        "(the store now speaks the document's identity, not the file's name)",
    );
  }

  /**
   * The standing refusals for one canvas path.
   *
   * Never throws and never writes. An unreadable file answers `[]` — the same
   * answer WP63 gives with no store at all — and says so, loudly, exactly once.
   */
  async load(canvasPath: string): Promise<readonly SeedRefusal[]> {
    await this.ensureLoaded();
    // WP92 (AC3): recorded BEFORE the root check and before every early return,
    // so a lookup against a quarantined store still counts as having been asked.
    // Recording it only on the success path would make the census claim the
    // entry was never wanted, which is the opposite of what happened.
    this.askedKeys.add(canvasPath);
    const root = this.root;
    if (root === undefined) return [];
    const entry = root.paths[canvasPath];
    if (entry === undefined) {
      this.missedKeys.add(canvasPath);
      return [];
    }
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
      this.narrateQuarantine();
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

  /** Said exactly once per store, whichever suppressed write got there first. */
  private narrateQuarantine(): void {
    if (this.quarantineNarrated) return;
    this.quarantineNarrated = true;
    this.logger?.warn?.(
      LOG_CATEGORY,
      `SEED REFUSAL STORE: ${this.filePath} is quarantined — refusals stay ` +
        "in memory for this session and the unreadable bytes are left intact",
    );
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

/** What {@link flushSeedRefusalStore} does. Returned so a caller can narrate it. */
export type SeedRefusalFlushOutcome = "flushed" | "timed-out";

/** The seam {@link flushSeedRefusalStore} needs. A whole store satisfies it. */
export interface FlushableSeedRefusalStore {
  idle(): Promise<void>;
}

export interface SeedRefusalFlushOptions {
  /** Defaults to {@link SEED_REFUSAL_FLUSH_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Injected so the bound is MEASURED by a test rather than read off a constant. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  logger?: SeedRefusalStoreLogger;
}

/**
 * ── WP92 (C92 AC4 / S64): THE WRITE HAS LANDED BEFORE THE PROCESS CAN END ───
 *
 * WP90 built `save()` to extend the queue SYNCHRONOUSLY before its first await —
 * with a comment saying, in as many words, that this is so "a caller which then
 * awaits `idle()` is guaranteed to be waiting for THIS save". Then nothing ever
 * awaited it: `grep -rn "\.idle()" plugin/src` over production returned ZERO,
 * and `onunload` destroyed eleven subsystems without mentioning the store. The
 * mechanism was built and left unwired, so a refusal recorded microseconds
 * before a hard kill was lost.
 *
 * It matters more here than its own severity suggests, and the reason is
 * structural: WP92's MIGRATION is a write, issued at exactly the moments S64
 * says a write can be lost. A half-migrated store — entries under two
 * vocabularies, nothing saying which is authoritative — is strictly worse than
 * an unmigrated one. AC4 is therefore a precondition of AC2, not a neighbour.
 *
 * TWO FAILURE DIRECTIONS, both bounded here rather than at the call site:
 *
 *   ├── A REJECTING WRITE MUST NOT REJECT THE UNLOAD. `save`'s own `catch`
 *   │   already keeps a rejection out of the chain (WP90: "a rejection here
 *   │   would POISON the chain"), and this function never rethrows either, so a
 *   │   store that fails at teardown still lets the plugin unload.
 *   └── A WRITE THAT NEVER SETTLES MUST NOT WEDGE UNLOAD FOREVER. The one timer
 *       this work package is licensed to add. It bounds a TEARDOWN and never
 *       reaches an entry's validity — an expiry by age is this WP's own defect
 *       one lifetime further out and is an abort criterion. Under S71 the bound
 *       can itself stretch on a clamped renderer, so the worst case a user sees
 *       is "unload waits for one clamped timer", not the constant.
 */
export async function flushSeedRefusalStore(
  store: FlushableSeedRefusalStore,
  opts: SeedRefusalFlushOptions = {},
): Promise<SeedRefusalFlushOutcome> {
  const timeoutMs = opts.timeoutMs ?? SEED_REFUSAL_FLUSH_TIMEOUT_MS;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((handle: unknown) => clearTimeout(handle as never));

  let handle: unknown;
  const bound = new Promise<SeedRefusalFlushOutcome>((resolve) => {
    handle = setTimer(() => resolve("timed-out"), timeoutMs);
  });
  // `idle()` resolving is the ONLY thing that produces "flushed". A rejection is
  // swallowed into the same outcome the queue's own catch already produces, so
  // the unload path has exactly two ways to continue and neither of them throws.
  const landed = store
    .idle()
    .then<SeedRefusalFlushOutcome>(() => "flushed")
    .catch<SeedRefusalFlushOutcome>((err) => {
      opts.logger?.warn?.(
        LOG_CATEGORY,
        `SEED REFUSAL STORE: the teardown flush failed (${String(err)}) — ` +
          "unload continues and the unwritten refusals are lost with the process",
      );
      return "flushed";
    });

  const outcome = await Promise.race([landed, bound]);
  clearTimer(handle);
  if (outcome === "timed-out") {
    opts.logger?.warn?.(
      LOG_CATEGORY,
      `SEED REFUSAL STORE: the teardown flush did not land within ${timeoutMs}ms — ` +
        "unload proceeds and the in-flight refusal write may be lost",
    );
  }
  return outcome;
}
