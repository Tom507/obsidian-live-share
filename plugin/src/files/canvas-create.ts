// ---------------------------------------------------------------------------
// WP117 (S122) — HOST-MEDIATED GUEST CANVAS CREATION. Headless wiring, in the
// precedent of `files/canvas-mirror.ts`: every decision lives in a pure core
// (`files/canvas-create-decision.ts`) or in this tested module, so `main.ts` and
// `sync/control-handlers.ts` gain CALLS ONLY and never a conditional over canvas
// state.
//
// THE PROTOCOL, in three messages and one adoption:
//
//   GUEST   a `.canvas` appears in the shared folder. The guest reads it and
//           sends `canvas-create-request {requestId, path, content}`.
//   HOST    validates every claim in the request against ITS OWN vault, creates
//           the file, publishes the manifest entry, and subscribes as host —
//           which mints the guid, binds it into the manifest and seeds the
//           document from the file it has just written.
//   BOTH    the host answers `canvas-create-result {requestId, accepted, reason}`
//           to everybody; exactly one peer recognises the id.
//   GUEST   on `accepted`, the originating guest marks the path ADOPTABLE, so
//           the next mirror pass joins the host's document instead of answering
//           `skip-local-file` and keeping a private copy.
//
// WHAT THIS DOES NOT DO, stated first because each one is the likely wrong
// repair:
//
//   ├── It does not open `skipsAutoTextSync`. The handoff is a one-shot
//   │   structured transfer of the WHOLE file over the control channel, decoded
//   │   by the host and seeded through the ordinary canvas path. No `.canvas` is
//   │   ever synchronised as raw character-merged text, in either direction.
//   ├── It does not let a guest mint a guid, write the manifest, or seed. The
//   │   host does all three, exactly as it always did. That is why this shape was
//   │   sanctioned over the content-free variant.
//   ├── It does not overwrite. A path the host already holds is REFUSED and the
//   │   guest is told; a refusal never destroys (I11).
//   └── It adds no writer. `CanvasPersistence` stays the single writer; the
//       adoption hands the path to the existing attach and nothing else.
//
// THE SIZE BOUND IS A PROPERTY OF THE RELAY, NOT A GUESS. The control
// `WebSocketServer` is constructed with `maxPayload: 2 MB`
// (`server/src/control-handler.ts`), and the file-transfer path chunks at 512 KB
// for the same reason. End-to-end encryption expands a payload by base64 plus an
// IV, so the wire form of a payload is roughly 1.4x its text length. A request
// above {@link CANVAS_CREATE_MAX_BYTES} is therefore refused BY THE GUEST,
// before a frame is sent, counted, and reported to the user in a sentence that
// names the file and the limit — because the alternative is a frame the relay
// drops on the floor, which is `S114`'s silence with a dead link on top.
// ---------------------------------------------------------------------------

import {
  CANVAS_CREATE_VERDICT,
  type CanvasCreateDecision,
  type CanvasCreateVerdict,
  decideCanvasCreate,
} from "./canvas-create-decision";
// THE SELECTOR, IMPORTED — never a private `endsWith(".canvas")`. WP83's census
// pins the set of modules that spell it privately and would name this one on the
// day it was added; four private copies of the canvas test is exactly how the
// defect class this feature sits next to propagated. `isCanvasPath` is the same
// selector the mirror pass filters its candidates with, and it is deliberately
// NOT `skipsAutoTextSync`: that predicate is the guard on the raw-text doors and
// also matches the sidecar directory, which holds no canvases at all.
import { isCanvasPath } from "./canvas-mirror";

/**
 * The largest canvas this handoff carries in one frame, in UTF-16 code units —
 * the same unit `files/file-ops.ts` measures `CHUNK_SIZE` in.
 *
 * 512 KB is over ten times the largest board in this project's own shared vault
 * (45 KB) and leaves the encrypted wire form comfortably inside the relay's
 * 2 MB frame ceiling. Above it the guest refuses locally and says so; see the
 * header, and the residual in the WP117 report for the chunked variant.
 */
export const CANVAS_CREATE_MAX_BYTES = 512 * 1024;

/**
 * How long a guest waits for the host's answer before telling the user nobody
 * answered.
 *
 * This is a SAFETY NET for a silence the protocol cannot otherwise report — an
 * absent host, a relay that does not carry these types, a peer on an older
 * build. It is a `setTimeout` and is therefore clampable (S71); the consequence
 * of a clamp is a LATE notice and never a wrong action, because nothing but the
 * notice hangs off it.
 */
export const CANVAS_CREATE_TIMEOUT_MS = 30_000;

/** Why a guest did not even ask. Every branch has a name, including the two
 * that do nothing at all (S155). */
export const CANVAS_CREATE_LOCAL_REFUSAL = {
  /** This client is the host: it already holds the file and needs no request. */
  NOT_GUEST: "not-guest",
  /** Not a `.canvas`. The ordinary file-op path owns it. */
  NOT_CANVAS: "not-canvas",
  /** Outside this client's shared tree. */
  OUTSIDE_SHARE: "outside-share",
  /**
   * The session already knows this path — it is in the manifest, so this
   * `create` event is the session delivering the file TO this guest rather than
   * the user authoring one. Asking the host to create what the host already has
   * would earn an `already-exists` refusal and a pointless notice.
   */
  ALREADY_SHARED: "already-shared",
  /** The file could not be read back. */
  UNREADABLE: "unreadable",
  /** Above {@link CANVAS_CREATE_MAX_BYTES}. Reported to the user. */
  TOO_LARGE: "too-large",
  /** No control channel to ask over. */
  NO_CHANNEL: "no-channel",
} as const;

export type CanvasCreateLocalRefusal =
  (typeof CANVAS_CREATE_LOCAL_REFUSAL)[keyof typeof CANVAS_CREATE_LOCAL_REFUSAL];

/** What one guest-side request attempt did. `"sent"` is the only one that asks. */
export type CanvasCreateRequestOutcome = "sent" | CanvasCreateLocalRefusal;

/**
 * READ-ONLY accounting, and it counts EVERY branch including the do-nothing
 * ones (S155). A ledger in which "was never called" and "ran and declined" read
 * the same is the defect that cost this project a whole round.
 *
 * Counts and classes only — never a path, never file content.
 */
export interface CanvasCreateStats {
  /** Guest side: requests actually put on the wire. */
  requested: number;
  /** Guest side: `create` events this module looked at and did not ask about. */
  declinedLocally: number;
  /** …by named reason. Every member of {@link CANVAS_CREATE_LOCAL_REFUSAL}. */
  declinedByReason: Record<string, number>;
  /** Host side: requests received, INCLUDING the ones this peer is not host for. */
  received: number;
  /** Host side: one key per {@link CANVAS_CREATE_VERDICT}, `not-host` included. */
  decided: Record<string, number>;
  /** Host side: materialisations that completed. */
  materialised: number;
  /** Host side: materialisations that were admitted and then threw. */
  materialiseFailed: number;
  /** Guest side: results seen, including other guests' results. */
  results: number;
  /** Guest side: results matching a request THIS peer made and accepted. */
  accepted: number;
  /** Guest side: results matching a request THIS peer made and refused. */
  refused: number;
  /** …by the host's verdict token. */
  refusedByReason: Record<string, number>;
  /** Guest side: results whose id this peer never issued. The ordinary case. */
  unmatchedResults: number;
  /** Guest side: requests that got no answer inside the timeout. */
  timedOut: number;
  /** Guest side: paths marked adoptable by an accepted result. */
  adoptionsArmed: number;
  /** Guest side: adoptable paths consumed by a mirror pass. */
  adoptionsCleared: number;
}

/** The wire shape of a request, so the handler and the sender agree on it. */
export interface CanvasCreateRequest {
  requestId: string;
  path: string;
  content: string;
}

/** The wire shape of the host's answer. */
export interface CanvasCreateResult {
  requestId: string;
  path: string;
  accepted: boolean;
  /** A {@link CanvasCreateVerdict} token, so a reader never parses English. */
  reason: string;
  /** The prose the refusing clause produced. Shown to the user verbatim. */
  detail: string;
}

/**
 * The slice of `CanvasSync` the host arm uses. Structural, so the real object
 * satisfies it as-is and this module imports nothing from it.
 */
export interface CanvasCreateSync {
  subscribe(path: string, role: "host" | "guest"): Promise<void>;
}

/** A clock/timer seam, so the timeout is testable without real timers. */
export interface CanvasCreateScheduler {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Every impure thing this module needs, by argument. Each member is a
 * MEASUREMENT or an ACTION taken from the object that owns it; this module
 * performs none of them itself and decides everything.
 */
export interface CanvasCreateEnv {
  /** This client's live role. `null` before a session starts. */
  role(): "host" | "guest" | null;
  /** Put one message on the control channel. `false` when there is no channel. */
  send(message: unknown): boolean;
  /** `ManifestManager.isSharedPath`, evaluated on THIS client. */
  isSharedPath(path: string): boolean;
  /** Does the manifest already list this path? Guest-side echo guard. */
  manifestKnows(path: string): boolean;
  /** `utils.isPathSafe`. */
  isPathSafe(path: string): boolean;
  /** `files/protected-paths.isProtectedPath`. */
  isProtectedPath(path: string): boolean;
  /** Does a file exist at this path in THIS vault, read through the ADAPTER. */
  fileExists(path: string): Promise<boolean>;
  /** Read a file back, or `null` when it cannot be read. */
  readFile(path: string): Promise<string | null>;
  /** Do the bytes parse as a canvas document? `parseCanvasReport(...).degraded`. */
  isCanvasDocument(content: string): boolean;
  /** HOST ONLY: create the file in the shared space, under a path mute. */
  createFile(path: string, content: string): Promise<void>;
  /** HOST ONLY: `ManifestManager.updateFile` for the file just created. */
  publishManifestEntry(path: string, content: string): Promise<void>;
  /**
   * `CanvasSync` itself, or `null` before a session builds one.
   *
   * THE WHOLE OBJECT, and the reason is WP6 AC8, exactly as `canvas-mirror.ts`
   * states it: every canvas subscribe WRITTEN IN `main.ts` has to route through
   * `subscribeCanvasWithHandover`, so the `backgroundSync.unsubscribe` ordering
   * can never be forgotten at a call site. This subscribe must NOT use that
   * helper — its unowned branch installs the announced raw-text fallback, which
   * for a freshly created canvas is the forbidden second CRDT over a path
   * `CanvasSync` is about to own. Both requirements hold at once by keeping the
   * subscribe out of `main.ts` entirely: that file forwards this object and
   * states no canvas operation of its own, and the subscribe lives here, in a
   * module that has tests.
   */
  canvasSync(): CanvasCreateSync | null;
  /**
   * HOST ONLY: attach the ONE existing writer to the path just created, which
   * cold-opens the seeded document and projects it back over the file.
   *
   * WHY THE HOST WRITES ITS OWN NEW FILE, when WP79's mirror pass is absolute
   * that a host's file is never rewritten by a pass: the bytes on disk here are
   * the GUEST'S serialisation, and every peer that mirrors this canvas will
   * write the CANONICAL one — `serializeCanvas` applied to the doc. Leaving the
   * host on the guest's spelling makes the host the one peer whose bytes differ
   * from everybody else's for the same records, from the moment of creation.
   *
   * It is not the WP79 case in any event: this file did not exist a moment ago,
   * it was created by this operation out of bytes this host still holds, and the
   * doc it is projected from was seeded from exactly those bytes. No user file
   * is at risk, which is the criterion WP79's rule is protecting.
   */
  attachWriter(path: string): Promise<void>;
  /** `ManifestManager.getCanvasGuid`, to report whether the mint landed. */
  identityFor(path: string): string | null;
  /** Show the user a message. Never suppressed by a notification preference. */
  notify(message: string): void;
  /** A fresh, unguessable request id. */
  newRequestId(): string;
  readonly scheduler?: CanvasCreateScheduler;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly logger?: {
    log(category: string, message: string): void;
    warn(category: string, message: string, err?: unknown): void;
    debug?(category: string, message: string): void;
  };
}

interface PendingRequest {
  path: string;
  timer: unknown;
}

const REAL_SCHEDULER: CanvasCreateScheduler = {
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function emptyCounts(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) out[key] = 0;
  return out;
}

const LOCAL_REFUSAL_KEYS = Object.values(CANVAS_CREATE_LOCAL_REFUSAL);
const VERDICT_KEYS = Object.values(CANVAS_CREATE_VERDICT);

/**
 * The coordinator. One per session, held by `main.ts`, driven by
 * `sync/control-handlers.ts` and `files/vault-events.ts`.
 *
 * It holds the only mutable state this feature has: the requests this peer has
 * in flight, and the paths an accepted result made adoptable. Both are per-peer
 * and neither is shared with anything.
 */
export class CanvasCreateCoordinator {
  private readonly env: CanvasCreateEnv;
  private readonly scheduler: CanvasCreateScheduler;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly adoptable = new Set<string>();
  private readonly stats: CanvasCreateStats;

  constructor(env: CanvasCreateEnv) {
    this.env = env;
    this.scheduler = env.scheduler ?? REAL_SCHEDULER;
    this.timeoutMs = env.timeoutMs ?? CANVAS_CREATE_TIMEOUT_MS;
    this.maxBytes = env.maxBytes ?? CANVAS_CREATE_MAX_BYTES;
    this.stats = {
      requested: 0,
      declinedLocally: 0,
      declinedByReason: emptyCounts(LOCAL_REFUSAL_KEYS),
      received: 0,
      decided: emptyCounts(VERDICT_KEYS),
      materialised: 0,
      materialiseFailed: 0,
      results: 0,
      accepted: 0,
      refused: 0,
      refusedByReason: emptyCounts(VERDICT_KEYS),
      unmatchedResults: 0,
      timedOut: 0,
      adoptionsArmed: 0,
      adoptionsCleared: 0,
    };
  }

  /** A snapshot a live validator (or a test) can assert on. */
  getStats(): CanvasCreateStats {
    return {
      ...this.stats,
      declinedByReason: { ...this.stats.declinedByReason },
      decided: { ...this.stats.decided },
      refusedByReason: { ...this.stats.refusedByReason },
    };
  }

  /**
   * A6 — has an accepted result made this path adoptable on THIS peer?
   *
   * Read by the mirror pass. `false` for every path nobody asked about, which is
   * what keeps `skip-local-file` byte-identical everywhere else.
   */
  originatedHere(path: string): boolean {
    return this.adoptable.has(path);
  }

  /** The mirror pass consumed the adoption. One-shot, so a later pass over the
   * same path is an ordinary `skip-local-file` again. */
  noteAdopted(path: string): void {
    if (!this.adoptable.delete(path)) return;
    this.stats.adoptionsCleared += 1;
  }

  /** Session teardown. Clears the timers so none outlives the session. */
  reset(): void {
    for (const entry of this.pending.values()) this.scheduler.clearTimeout(entry.timer);
    this.pending.clear();
    this.adoptable.clear();
  }

  // ── GUEST: ask the host to materialise a canvas this user just made ────────

  /**
   * The guest side, driven by the vault `create` event.
   *
   * Returns the branch it took, so "declined" and "never called" are different
   * observations at the call site as well as in the ledger.
   */
  async requestCreate(path: string): Promise<CanvasCreateRequestOutcome> {
    const decline = (reason: CanvasCreateLocalRefusal): CanvasCreateRequestOutcome => {
      this.stats.declinedLocally += 1;
      this.stats.declinedByReason[reason] = (this.stats.declinedByReason[reason] ?? 0) + 1;
      this.env.logger?.debug?.(
        "canvas-create",
        `CANVAS CREATE NOT REQUESTED: ${path} reason=${reason}`,
      );
      return reason;
    };

    if (this.env.role() !== "guest") return decline(CANVAS_CREATE_LOCAL_REFUSAL.NOT_GUEST);
    if (!isCanvasPath(path)) return decline(CANVAS_CREATE_LOCAL_REFUSAL.NOT_CANVAS);
    if (!this.env.isSharedPath(path)) return decline(CANVAS_CREATE_LOCAL_REFUSAL.OUTSIDE_SHARE);
    if (this.env.manifestKnows(path)) return decline(CANVAS_CREATE_LOCAL_REFUSAL.ALREADY_SHARED);

    let content: string | null = null;
    try {
      content = await this.env.readFile(path);
    } catch {
      content = null;
    }
    if (typeof content !== "string") return decline(CANVAS_CREATE_LOCAL_REFUSAL.UNREADABLE);

    // A5 — THE BOUND, ENFORCED BEFORE A FRAME IS SENT, AND SAID OUT LOUD.
    if (content.length > this.maxBytes) {
      this.env.notify(
        `Live Share: ${path} is ${Math.round(content.length / 1024)} KB, above the ` +
          `${Math.round(this.maxBytes / 1024)} KB limit for sharing a new canvas. ` +
          "Ask the host to add it to the shared folder instead — it stays in your vault either way.",
      );
      this.env.logger?.warn(
        "canvas-create",
        `CANVAS CREATE REFUSED LOCALLY: ${path} is ${content.length} bytes, ` +
          `above the ${this.maxBytes} byte transfer bound`,
      );
      return decline(CANVAS_CREATE_LOCAL_REFUSAL.TOO_LARGE);
    }

    const requestId = this.env.newRequestId();
    const sent = this.env.send({
      type: "canvas-create-request",
      requestId,
      path,
      content,
    });
    if (!sent) return decline(CANVAS_CREATE_LOCAL_REFUSAL.NO_CHANNEL);

    const timer = this.scheduler.setTimeout(() => {
      const entry = this.pending.get(requestId);
      if (!entry) return;
      this.pending.delete(requestId);
      this.stats.timedOut += 1;
      // S114's shape is a creation that vanished with nothing said. This is the
      // sentence that stops it being that.
      this.env.notify(
        `Live Share: no answer from the host about ${entry.path}. It is still in your ` +
          "vault, but the others do not have it yet.",
      );
      this.env.logger?.warn(
        "canvas-create",
        `CANVAS CREATE UNANSWERED: ${entry.path} after ${this.timeoutMs} ms`,
      );
    }, this.timeoutMs);
    this.pending.set(requestId, { path, timer });
    this.stats.requested += 1;
    this.env.logger?.log("canvas-create", `CANVAS CREATE REQUESTED: ${path} (${content.length} B)`);
    return "sent";
  }

  // ── HOST: validate, materialise, mint, seed, answer ───────────────────────

  /**
   * The host side. Every peer in the room receives the request; the `not-host`
   * clause of the pure core is what makes exactly one of them act.
   *
   * Returns the decision so a test and a live validator read the same verdict
   * the ledger counted.
   */
  async handleRequest(request: CanvasCreateRequest): Promise<CanvasCreateDecision> {
    this.stats.received += 1;
    const path = typeof request?.path === "string" ? request.path : "";
    const content = typeof request?.content === "string" ? request.content : "";
    const role = this.env.role();

    // Measured on THIS client, from the objects that own each answer. A guest is
    // not trusted to name a path, so nothing in the request is taken on trust —
    // not the membership, not the safety, not the size, not the shape.
    const observation = {
      role: role === "host" ? ("host" as const) : ("guest" as const),
      canvasPath: isCanvasPath(path),
      pathSafe: this.env.isPathSafe(path),
      protectedPath: this.env.isProtectedPath(path),
      sharedPath: this.env.isSharedPath(path),
      contentBytes: content.length,
      maxBytes: this.maxBytes,
      parsable: content.length > 0 && this.env.isCanvasDocument(content),
      localFileExists: role === "host" ? await this.env.fileExists(path) : true,
    };
    const decision = decideCanvasCreate(observation);
    this.stats.decided[decision.verdict] = (this.stats.decided[decision.verdict] ?? 0) + 1;

    if (decision.verdict === CANVAS_CREATE_VERDICT.NOT_HOST) {
      // THE DO-NOTHING BRANCH, AND IT IS COUNTED (S155). A guest receiving
      // another guest's request answers nothing at all: a second answer on the
      // wire is a second authority, which is the thing this design exists to
      // avoid.
      return decision;
    }

    if (decision.verdict !== CANVAS_CREATE_VERDICT.MATERIALISE) {
      this.env.logger?.warn(
        "canvas-create",
        `CANVAS CREATE REFUSED: ${path} verdict=${decision.verdict} — ${decision.reason}`,
      );
      this.answer(request, false, decision);
      return decision;
    }

    try {
      // ORDER IS THE DESIGN, and every step is the host's own:
      //   1. the file, so the seed below has something to read;
      //   2. the manifest entry, so the path is a shared file with a hash;
      //   3. the subscribe, which mints the guid, BINDS it into the manifest and
      //      seeds the document from the file written in step 1.
      // Reversing 1 and 3 would seed an empty document and then write a file
      // nothing is subscribed to.
      await this.env.createFile(path, content);
      await this.env.publishManifestEntry(path, content);
      // DIRECT — deliberately not `subscribeCanvasWithHandover`. See
      // `CanvasCreateEnv.canvasSync`. A session torn down across the two awaits
      // above leaves no `CanvasSync` to subscribe with, and that is a failure
      // rather than a silent success: the file and the manifest entry exist but
      // nothing minted an identity, so the guest must be told.
      const sync = this.env.canvasSync();
      if (sync === null) throw new Error("the session ended before the canvas could be seeded");
      await sync.subscribe(path, "host");
      // 4. the writer, so the host's own file is the canonical projection of the
      //    document rather than the guest's spelling of the same records. An
      //    EMPTY canvas writes nothing at all here: the cold open finds an empty
      //    doc, and the seed branch refuses to project an empty file.
      await this.env.attachWriter(path);
      this.stats.materialised += 1;
      this.env.logger?.log(
        "canvas-create",
        `CANVAS CREATE MATERIALISED: ${path} guid=${this.env.identityFor(path) ?? "<none>"}`,
      );
      this.answer(request, true, decision);
      return decision;
    } catch (err) {
      this.stats.materialiseFailed += 1;
      this.env.logger?.warn("canvas-create", `CANVAS CREATE FAILED: ${path}`, err);
      // I5 — degrade this request alone, and TELL THE GUEST. An admitted request
      // that then fails is the one case in which silence would be indefensible:
      // the user's canvas is in their vault and in nobody else's.
      this.answer(request, false, {
        verdict: decision.verdict,
        reason:
          "the host accepted the canvas but could not create it: " +
          (err instanceof Error ? err.message : String(err)),
      });
      return decision;
    }
  }

  private answer(
    request: CanvasCreateRequest,
    accepted: boolean,
    decision: CanvasCreateDecision,
  ): void {
    this.env.send({
      type: "canvas-create-result",
      requestId: typeof request?.requestId === "string" ? request.requestId : "",
      path: typeof request?.path === "string" ? request.path : "",
      accepted,
      reason: accepted ? CANVAS_CREATE_VERDICT.MATERIALISE : decision.verdict,
      detail: decision.reason,
    });
  }

  // ── GUEST: the answer comes back ──────────────────────────────────────────

  /** Returns `true` when this peer issued the request the result names. */
  handleResult(result: CanvasCreateResult): boolean {
    this.stats.results += 1;
    const requestId = typeof result?.requestId === "string" ? result.requestId : "";
    const entry = this.pending.get(requestId);
    if (!entry) {
      // The ordinary case for every peer but one — the relay broadcasts.
      this.stats.unmatchedResults += 1;
      return false;
    }
    this.pending.delete(requestId);
    this.scheduler.clearTimeout(entry.timer);

    if (result.accepted === true) {
      this.stats.accepted += 1;
      // A6 — the local file already exists, so the mirror's `skip-local-file` is
      // wrong for this path and this path only. Arming the adoption is what
      // replaces it.
      this.adoptable.add(entry.path);
      this.stats.adoptionsArmed += 1;
      this.env.logger?.log(
        "canvas-create",
        `CANVAS CREATE ACCEPTED: ${entry.path} — adopting the host's document`,
      );
      return true;
    }

    const reason = typeof result.reason === "string" ? result.reason : "unknown";
    this.stats.refused += 1;
    this.stats.refusedByReason[reason] = (this.stats.refusedByReason[reason] ?? 0) + 1;
    // A4 — THE REFUSAL REACHES THE USER. A silently dropped creation is S114's
    // shape: the user made a canvas, nothing happened, and nothing said why.
    const detail = typeof result.detail === "string" && result.detail.length > 0
      ? result.detail
      : reason;
    this.env.notify(
      `Live Share: the host did not add ${entry.path} to the session — ${detail}. ` +
        "The file is still in your vault.",
    );
    this.env.logger?.warn(
      "canvas-create",
      `CANVAS CREATE REFUSED BY HOST: ${entry.path} reason=${reason}`,
    );
    return true;
  }
}

export { CANVAS_CREATE_VERDICT, decideCanvasCreate };
export type { CanvasCreateDecision, CanvasCreateVerdict };
