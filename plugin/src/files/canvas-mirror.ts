// ---------------------------------------------------------------------------
// WP79 — THE MIRROR PASS. Headless wiring, in the precedent of
// `files/canvas-sidecar-lifecycle.ts`'s `wireCanvasSidecar`: every decision
// lives here so `main.ts` gains CALLS ONLY and never a conditional over canvas
// state.
//
// WHAT IT DOES NOT DO, stated first because each one is the likely wrong repair:
//
//   ├── It does not touch `skipsAutoTextSync` or either of its consulting
//   │   sites. Both `.canvas` skips are correct and stay byte-unchanged.
//   ├── It does not call `subscribeCanvasWithHandover`. That helper installs the
//   │   announced R10 raw-text fallback when `CanvasSync` does not take the
//   │   path, and running it across a whole shared folder would mass-install the
//   │   forbidden second CRDT for every canvas whose guid does not resolve. Here
//   │   an unresolvable identity is a SKIP, never a fallback. The helper keeps
//   │   its two existing call sites, unchanged.
//   ├── It adds no serialiser. The bytes a guest receives are
//   │   `serializeCanvas(...)` applied to the same doc the host holds — the same
//   │   call `CanvasPersistence` makes at `canvas-persistence.ts:324`. Byte
//   │   agreement is a consequence of ONE definer, not a comparison.
//   └── It adds no CRDT→disk writer. `CanvasPersistence` stays the single
//       writer; this module performs no `vault.create` / `adapter.write` /
//       `vault.modify` of its own. `materialise` hands the path to the existing
//       writer attach and nothing else.
//
// EAGER, and the reason is that the lazy alternative does not exist: the only
// user act that could trigger a lazy materialisation is opening the file, and
// Obsidian cannot open a file that is not on disk. Making "open" available would
// mean writing a placeholder first, and a placeholder is an empty `.canvas` that
// a later reconcile can win with — the E2 cascade, re-armed.
// ---------------------------------------------------------------------------

import {
  MIRROR_VERDICT,
  type MirrorVerdict,
  admitsCanvasMirror,
  decideCanvasMirror,
} from "./canvas-mirror-decision";

/**
 * The two record containers a canvas doc keeps. Named constants because AC4's
 * "an empty doc materialises no file" is unfalsifiable if the emptiness probe
 * reads maps that are always empty because the names are wrong — a test that
 * passes for that reason has measured nothing. `CanvasSync` writes exactly these
 * two names (`canvas-sync.ts`, `subscribe`).
 */
export const CANVAS_RECORD_MAPS = ["nodes", "edges"] as const;

/** The minimum a doc has to expose for the record probe. Structural, so a real
 * `Y.Doc` satisfies it without this module importing Yjs. */
export interface CanvasMirrorDoc {
  getMap(name: string): { size: number };
}

/**
 * The slice of `CanvasSync` this pass uses, taken as one object rather than as
 * three loose callbacks.
 *
 * WHY THE WHOLE OBJECT. WP6 AC8 requires that `main.ts` itself contain no direct
 * canvas subscribe — every canvas subscribe written in that file has to route
 * through `subscribeCanvasWithHandover`, so the `backgroundSync.unsubscribe`
 * ordering can never be forgotten at a call site. WP79's pass must NOT use that
 * helper (its unowned branch installs the R10 raw-text fallback, which across a
 * whole shared folder is the forbidden second CRDT). Both requirements are
 * satisfied at once by keeping the subscribe out of `main.ts` entirely: the file
 * forwards this object and states no canvas operation of its own, and the
 * subscribe lives here, in a module that has tests.
 */
export interface CanvasMirrorSync {
  isSubscribed(path: string): boolean;
  subscribe(path: string, role: "host" | "guest"): Promise<void>;
  getCanvasDocHandle(path: string): { doc: CanvasMirrorDoc } | null | undefined;
}

/** One path's outcome, for the receipt. */
export interface CanvasMirrorEntry {
  readonly path: string;
  readonly verdict: MirrorVerdict;
  /**
   * What actually happened. `verdict` is the decision; `outcome` is the world.
   * They differ exactly when an admitted path could not be carried out, which is
   * the case I5 requires to degrade that path alone.
   */
  readonly outcome:
    | "published"
    | "bound"
    | "materialised"
    | "adopted"
    | "skipped"
    | "failed";
  readonly reason?: string;
}

/**
 * The pass's receipt. AC5 requires the mirror to be COUNTED and falsifiable: a
 * canvas that is skipped is skipped by its own named verdict and is reported,
 * never dropped silently, and the completeness claim is a number a test can read
 * rather than an absence it has to trust.
 */
export interface CanvasMirrorReport {
  readonly role: "host" | "guest";
  readonly considered: number;
  readonly published: number;
  /**
   * WP122 — host paths whose file was handed to the ONE existing writer as well
   * as published. Counted APART from `published`, and the reason is `S138`:
   * throughout the 240-second stall the host's mirror read
   * `role=host considered=14 published=14 failed=0` — a completely healthy pass
   * on a peer whose file was two records behind its own document. `published`
   * means "the guid is bound" and nothing more, and collapsing the two would
   * make "the host's boards have writers" unfalsifiable from the receipt in
   * exactly the way it already was.
   *
   * It is still not the oracle for AC B1. A number this pass writes about its
   * own last completed run cannot witness the writer's CURRENT state; that is
   * read from the writer registry itself.
   */
  readonly bound: number;
  readonly materialised: number;
  /**
   * WP117 — paths whose EXISTING local file was handed to the writer because
   * this peer originated the creation. Counted apart from `materialised`: one is
   * a file that did not exist, the other is a file that did, and collapsing them
   * would make "the mirror created nothing over a user file" unfalsifiable.
   */
  readonly adopted: number;
  readonly skippedLocalFile: number;
  readonly skippedNoSource: number;
  readonly failed: number;
  readonly entries: readonly CanvasMirrorEntry[];
}

/** Every impure thing the pass needs, by argument. */
export interface CanvasMirrorDeps {
  readonly role: "host" | "guest";
  /** Every path the manifest currently lists. Filtering is this module's job. */
  listManifestPaths(): Iterable<string>;
  /**
   * Does a file exist at this path in THIS vault right now?
   *
   * Asynchronous on purpose: the truth has to come from the same layer the
   * single writer writes through (the vault ADAPTER), not from Obsidian's
   * metadata cache. `CanvasPersistence` writes with `adapter.write`, so a file
   * it has just created is not yet a `TFile` — a cache-based probe would report
   * a materialisation as failed, and worse, would report an existing
   * adapter-written file as absent and licence a write over it.
   */
  localFileExists(path: string): Promise<boolean>;
  /** The published guid for this path, or null. The guest never mints one. */
  guidForPath(path: string): string | null;
  /** `CanvasSync`. Its `subscribe` is called DIRECTLY, never via the handover helper. */
  readonly canvasSync: CanvasMirrorSync;
  /** Attach the ONE existing writer, which cold-opens and flushes the doc to disk. */
  materialise(path: string): Promise<void>;
  /**
   * WP122 (`S146`) — THE HOST'S OWN FILE, handed to the ONE existing writer.
   *
   * Optional, and its PRESENCE is the capability the verdict reads (`=== true`
   * on `bindsHostWriter`): a deps object without it degrades to exactly the
   * pre-WP122 behaviour — `PUBLISH`, no attach, no cold open — rather than
   * throwing. Every pre-WP122 caller and every pre-WP122 test double is such an
   * object, which is why this package changes none of their verdicts.
   *
   * SEPARATE FROM {@link CanvasMirrorDeps.materialise} because the two are
   * different acts on different populations: `materialise` gives a guest a file
   * that does not exist yet (or adopts one the guest itself authored), and this
   * binds a writer to a file the HOST already holds and has just seeded the
   * document from. Production points both at the SAME `attachCanvasWriter`, so
   * `hasCanvasWriter` remains the single definition of "already attached" and
   * this is a second REFERENCE to one route rather than a second route.
   *
   * ORDERING IS THE SAFETY ARGUMENT AND IT IS NOT ENFORCED BY ANY TYPE: this
   * runs AFTER `canvasSync.subscribe`, whose host arm merges the local file into
   * the document. Hoisting it above the subscribe would cold-open a document
   * that is empty-or-peer-only and flush a board missing everything the host
   * authored. Nothing in the codebase catches a refactor that reorders those two
   * statements except `__tests__/v2/wp122/`'s hoisted-attach row.
   */
  bindHostWriter?(path: string): Promise<void>;
  /**
   * S123 — RE-ASK WHEN THE RECORDS ARRIVE.
   *
   * `docHasRecords` below is a ONE-SHOT PROBE of a value that is still in
   * flight, and this pass is armed only by manifest key changes. The host
   * publishes the canvas guid BEFORE it seeds the doc (`resolveGuidForSubscribe`
   * binds, then `subscribe` awaits `waitForSync` and only then applies the file
   * to the maps), so the guest is notified by the first event and needs the
   * second. A guest whose probe lands in that window skips — and because the
   * host performs no further manifest write for that path, NOTHING re-arms and
   * the file never arrives for the rest of the session.
   *
   * That is the whole of S123: one guest's probe landed after the seed and it
   * got the file; another's landed before and it never did. Widening the window
   * further, `waitForSync` resolves IMMEDIATELY on a brand-new canvas doc id
   * whenever the relay reports `peerCount === 0` — the same signal that caused
   * S119, consumed here one layer over.
   *
   * So the probe stops being the decision. The caller installs a one-shot
   * watcher on the doc's record maps and re-runs the pass when records actually
   * land. Optional: a deps object without it degrades to exactly the previous
   * behaviour rather than throwing.
   */
  watchForRecords?(path: string): void;
  /**
   * WP117 (S122) — did THIS peer ask the host to create this canvas, and did the
   * host accept?
   *
   * Optional and read `=== true` by the verdict: a deps object without it
   * degrades to exactly the pre-WP117 behaviour rather than throwing, and every
   * path nobody asked about keeps `skip-local-file`.
   */
  originatedHere?(path: string): boolean;
  /**
   * WP117 — the adoption was carried out, so it must not be carried out again.
   * One-shot: without this the flag would re-admit the path on every later pass
   * and the writer attach would be re-entered for the life of the session.
   */
  noteAdopted?(path: string): void;
  readonly logger?: {
    log(category: string, message: string): void;
    warn(category: string, message: string, err?: unknown): void;
  };
}

/**
 * SELECTOR, not a guard.
 *
 * This says which paths the mirror pass CONSIDERS. It is deliberately NOT
 * `skipsAutoTextSync`: that predicate is the guard on the raw-text doors and
 * also matches the sidecar directory, which contains no canvases at all. Using
 * it here would be a category error in both directions. Nothing about the four
 * guarded doors changes because of this line, and this line is not a fifth copy
 * of any of them.
 */
export function isCanvasPath(path: string): boolean {
  return typeof path === "string" && path.endsWith(".canvas");
}

/** Does this doc hold at least one node or edge record? */
export function docHasRecords(doc: CanvasMirrorDoc | null | undefined): boolean {
  if (doc === null || doc === undefined || typeof doc.getMap !== "function") return false;
  for (const name of CANVAS_RECORD_MAPS) {
    try {
      const map = doc.getMap(name);
      if (map && typeof map.size === "number" && map.size > 0) return true;
    } catch {
      // A doc that cannot answer is not evidence that it holds records.
      return false;
    }
  }
  return false;
}

function empty(role: "host" | "guest"): CanvasMirrorReport {
  return {
    role,
    considered: 0,
    published: 0,
    bound: 0,
    materialised: 0,
    adopted: 0,
    skippedLocalFile: 0,
    skippedNoSource: 0,
    failed: 0,
    entries: [],
  };
}

/**
 * Run the pass over every shared canvas the manifest lists.
 *
 * SEQUENTIAL, matching `BackgroundSync.startAll`. Each path is wrapped
 * individually, so a canvas that fails to subscribe, fails to sync or fails to
 * materialise degrades THAT canvas and nothing else (I5) — the join still
 * completes and the other N−1 still arrive.
 *
 * The caller is expected to invoke this WITHOUT awaiting it at a session entry
 * point: a slow relay must not hold up the join.
 */
export async function mirrorSharedCanvases(deps: CanvasMirrorDeps): Promise<CanvasMirrorReport> {
  const role = deps?.role === "host" ? "host" : deps?.role === "guest" ? "guest" : null;
  if (role === null) return empty("guest");

  const entries: CanvasMirrorEntry[] = [];
  let paths: string[];
  try {
    paths = [...deps.listManifestPaths()].filter(isCanvasPath);
  } catch (err) {
    deps.logger?.warn("canvas-mirror", "could not read the manifest entries", err);
    return empty(role);
  }

  for (const path of paths) {
    try {
      entries.push(await mirrorOne(deps, role, path));
    } catch (err) {
      deps.logger?.warn("canvas-mirror", `mirror pass failed for ${path}`, err);
      entries.push({
        path,
        verdict: MIRROR_VERDICT.SKIP_NO_SOURCE,
        outcome: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const report: CanvasMirrorReport = {
    role,
    considered: entries.length,
    published: entries.filter((e) => e.outcome === "published").length,
    bound: entries.filter((e) => e.outcome === "bound").length,
    materialised: entries.filter((e) => e.outcome === "materialised").length,
    adopted: entries.filter((e) => e.outcome === "adopted").length,
    skippedLocalFile: entries.filter((e) => e.verdict === MIRROR_VERDICT.SKIP_LOCAL_FILE).length,
    skippedNoSource: entries.filter(
      (e) => e.verdict === MIRROR_VERDICT.SKIP_NO_SOURCE && e.outcome === "skipped",
    ).length,
    failed: entries.filter((e) => e.outcome === "failed").length,
    entries,
  };
  deps.logger?.log(
    "canvas-mirror",
    `CANVAS MIRROR: role=${report.role} considered=${report.considered} ` +
      `published=${report.published} bound=${report.bound} ` +
      `materialised=${report.materialised} ` +
      `adopted=${report.adopted} ` +
      `skipped(local-file)=${report.skippedLocalFile} ` +
      `skipped(no-source)=${report.skippedNoSource} failed=${report.failed}`,
  );
  return report;
}

async function mirrorOne(
  deps: CanvasMirrorDeps,
  role: "host" | "guest",
  path: string,
): Promise<CanvasMirrorEntry> {
  // WP117 — measured ONCE and used for both the admission gate and the verdict,
  // so an adoption that is armed cannot be admitted and then re-decided as a
  // skip (or the reverse) because the flag moved between two reads.
  const originatedHere = deps.originatedHere?.(path) === true;
  // WP122 — the CAPABILITY, taken from the object that owns it rather than
  // stated by the caller as a preference. Measured once, beside `originatedHere`
  // and for the same reason: the admission gate and the verdict must be asked
  // the same question.
  const bindsHostWriter = typeof deps.bindHostWriter === "function";
  const pre = {
    role,
    localFileExists: (await deps.localFileExists(path)) === true,
    identityResolves: isUsableGuid(deps.guidForPath(path)),
    originatedHere,
    bindsHostWriter,
  };

  if (!admitsCanvasMirror(pre)) {
    const verdict = decideCanvasMirror({ ...pre, docHasRecords: false });
    return { path, verdict, outcome: "skipped" };
  }

  if (!deps.canvasSync.isSubscribed(path)) {
    // DIRECT — deliberately not `subscribeCanvasWithHandover`. See the header.
    await deps.canvasSync.subscribe(path, role);
  }

  if (role === "host") {
    // The host already holds the file; the point of the subscribe is that
    // `resolveGuidForSubscribe` mints and BINDS the guid, which is the only way
    // a peer can resolve this path at all.
    //
    // The identity is re-measured AFTER the subscribe, never carried over from
    // `pre`: on the mint case there was nothing to resolve before it.
    const published = isUsableGuid(deps.guidForPath(path));
    // ASKED, not re-stated. The host arm of `decideCanvasMirror` reads `role`,
    // `localFileExists` and `bindsHostWriter` and nothing else, so `pre` is a
    // complete input for it and the doc probe is genuinely not part of this
    // question — the same `docHasRecords: false` the not-admitted branch above
    // passes, for the same reason.
    const verdict = decideCanvasMirror({ ...pre, docHasRecords: false });
    if (!published) {
      return {
        path,
        verdict,
        outcome: "failed",
        reason: "the subscribe did not leave a resolvable identity",
      };
    }
    if (verdict !== MIRROR_VERDICT.PUBLISH_AND_BIND_WRITER || deps.bindHostWriter === undefined) {
      // The pre-WP122 answer, byte for byte: no write, no attach, no cold open.
      return { path, verdict, outcome: "published" };
    }

    // ── WP122 (`S146`) — THE BIND, AND ITS POSITION IS THE WHOLE SAFETY ──────
    //
    // AFTER the subscribe above, never before it. `CanvasSync.subscribe`'s host
    // arm reads the file and MERGES it into the document (`applyCanvasToYMaps`),
    // so by this line the doc is the union of what the peers hold and what the
    // host's file names. The writer's cold open then finds a non-empty doc,
    // takes `doc-wins`, and flushes that union to the host's disk — which is the
    // fix: the guest's edit is already in the doc and now reaches the file.
    //
    // Hoisted above the subscribe, the doc would be empty-or-peer-only and the
    // same flush would write a board MISSING EVERYTHING THE HOST AUTHORED. No
    // type enforces this ordering; only the order of two statements in this
    // function does.
    //
    // THE FLUSH IS NOT UNGUARDED. It travels the same `attachCanvasWriter`
    // route the guest-create handshake has used since WP117, so WP121's
    // conflict copy — the only caller of which is `coldOpen` — runs immediately
    // before it whenever the projection about to land is missing records the
    // file holds. WP122 depends on WP121 as a hard PRECONDITION, not as a
    // safety net: this pass fires `doc-wins` on every host-held canvas in the
    // manifest, including boards that are already divergent today.
    try {
      await deps.bindHostWriter(path);
    } catch (err) {
      // I5 — degrade THIS path. The publication above really happened and the
      // receipt must not pretend otherwise, so the reason names both facts.
      deps.logger?.warn("canvas-mirror", `the host writer bind failed for ${path}`, err);
      return {
        path,
        verdict,
        outcome: "failed",
        reason:
          "the path was published but the host writer could not be bound: " +
          (err instanceof Error ? err.message : String(err)),
      };
    }
    const stillThere = (await deps.localFileExists(path)) === true;
    return {
      path,
      verdict,
      outcome: stillThere ? "bound" : "failed",
      reason: stillThere
        ? undefined
        : "the bind left no file at the host's own path, which a bind must never do",
    };
  }

  // Re-measured AFTER the subscribe, not carried over from before it: the doc
  // is only knowable once `waitForSync` has resolved, and the local file is
  // re-read so a file that appeared during the await is still create-only.
  const post = {
    role,
    localFileExists: (await deps.localFileExists(path)) === true,
    identityResolves: isUsableGuid(deps.guidForPath(path)),
    docHasRecords: docHasRecords(deps.canvasSync.getCanvasDocHandle(path)?.doc ?? null),
    originatedHere,
  };
  const verdict = decideCanvasMirror(post);

  // WP117 — THE ADOPTION, and it is scored on DISK BYTES, never on the verdict
  // (S138: `canvas.mirror` reports the last completed pass, not the current
  // state). The file already exists, so "did it land" is not the question the
  // materialise arm asks; the question is whether the writer took the path over,
  // which is what `bytesAfter` witnesses.
  if (verdict === MIRROR_VERDICT.ADOPT_LOCAL_FILE) {
    await deps.materialise(path);
    deps.noteAdopted?.(path);
    const stillThere = (await deps.localFileExists(path)) === true;
    return {
      path,
      verdict,
      outcome: stillThere ? "adopted" : "failed",
      reason: stillThere
        ? undefined
        : "the adoption left no file at the path, which an adoption must never do",
    };
  }

  if (verdict !== MIRROR_VERDICT.MATERIALISE) {
    // S123 — the ONE skip that is provably premature rather than final: this
    // guest has no local file and CAN resolve the identity, so the only thing
    // missing is the host's records, and those are on their way. Every other
    // skip is a settled answer (the user already has the file; there is no
    // published identity to resolve) and must not install a watcher.
    //
    // `identityResolves === true` is SUBSUMED by `admitsCanvasMirror(pre)`
    // above, which already early-returns for a guest that cannot resolve the
    // identity — so this conjunct can never be false here. Measured, not
    // assumed: breaking it reddens NOTHING (break table B30). It is kept
    // because the pre-gate is a cost optimisation that could legitimately be
    // relaxed, and this condition must not silently become wrong if it is;
    // `decideCanvasMirror` refusing that combination is pinned by its own test
    // so the subsumption itself is falsifiable rather than folklore.
    if (
      post.localFileExists === false &&
      post.identityResolves === true &&
      post.docHasRecords === false
    ) {
      deps.watchForRecords?.(path);
    }
    return { path, verdict, outcome: "skipped" };
  }

  await deps.materialise(path);
  const landed = (await deps.localFileExists(path)) === true;
  return {
    path,
    verdict,
    outcome: landed ? "materialised" : "failed",
    reason: landed ? undefined : "the writer attach produced no file",
  };
}

function isUsableGuid(guid: string | null | undefined): boolean {
  return typeof guid === "string" && guid.trim().length > 0;
}
