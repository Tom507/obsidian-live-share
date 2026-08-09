/**
 * S143 · S144 · S157 — A FAILURE THAT REPORTS NOTHING LASTS FOREVER.
 *
 * Three functions in this tree survive a failure into a wrong steady state
 * because nothing anywhere records that the failure happened:
 *
 *   `BackgroundSync.subscribe()`   gives up on a path and leaves it out of the
 *                                  session (`S143`)
 *   `ManifestManager.syncFromManifest()`
 *                                  gives up on a path's text and leaves the
 *                                  local bytes for a later arm to overwrite
 *                                  (`S157`)
 *   `ensureFolder()`               swallows every `createFolder` error, so the
 *                                  CALLER's failure — a rename, a move, a
 *                                  file-op — is what the user is told about
 *                                  (`S144`)
 *
 * In all three the product keeps running, everything reports healthy, and the
 * only evidence that anything went wrong is a file that quietly stops
 * participating. This module is the one place all three say what they did.
 *
 * WHY ONE MODULE AND NOT THREE. `empty-write-guard.ts` is the precedent this
 * follows deliberately rather than re-invents: ONE emitter, ONE spelling of the
 * line, and an ARM naming the call site, so a live grep is a census over arms
 * instead of over phrasings. That module already serves two arms in two
 * different files. Three arms in three files is the same shape, not a wider
 * one, and a second emitter module would be the third idiom the charter
 * forbids. `single-writer.ts` and `conflict-copy.ts`'s discard ledger are the
 * same shape again.
 *
 * WHY EVERY BRANCH IS COUNTED, INCLUDING THE ONES THAT DID NOTHING WRONG —
 * this is `S155`, and it has already cost this run a full round.
 * `preserveLocalVersion`'s DISCARD branch returned before every counter in its
 * module, so "the guard ran and declined" produced a reading byte-identical to
 * "the guard was never called": `{total: 0}`. THREE readers in a row — the live
 * validator, the Dispatcher, and a charter — read that zero as *never reached*
 * and sent a worker after a function that was in fact running and answering.
 *
 * So a zero here means ONE thing and one thing only: **this arm did not run for
 * this path**. Every other answer — it ran and completed, it ran and had
 * nothing to do, it ran and gave up — has its own non-zero cell.
 *
 * THE LOGGER IS A PARAMETER, NEVER A MODULE-LEVEL SINK (`S104`). A module sink
 * has to be installed at plugin load, and this project has already paid for
 * exactly that shape: `file-ops.ts` was handed `this.logger` FIFTEEN LINES
 * BEFORE it existed, `logger!` stopped `tsc` objecting and `?.` stopped it
 * throwing, and two signatures were unreachable for the plugin's entire
 * history. Passing it per call makes the wiring visible at every call site and
 * lets the tests drive the real emitter with a recording double.
 *
 * Deliberately a pure module with no imports, for `empty-write-guard.ts`'s
 * reason: `utils.ts`, `files/background-sync.ts` and `files/manifest.ts` all
 * consult it, and a shared spelling is the only thing that keeps three arms
 * from drifting apart.
 */

/**
 * WHAT AN EXIT LEFT BEHIND. Four answers, and the whole reason the ledger
 * exists is that the last three used to be indistinguishable from each other
 * and from never having run at all.
 */
export const PATH_DISPOSITION = {
  /** The arm did its work for this path. */
  COMPLETED: "completed",
  /**
   * The arm ran, and correctly had nothing to do. NOT a failure, and counted
   * precisely so it can never again be mistaken for one — or for silence.
   */
  DO_NOTHING: "do-nothing",
  /**
   * The arm gave up for a reason that may stop being true. A re-arm may
   * re-drive it; until something does, the path is out of the session.
   */
  RETRYABLE: "retryable",
  /**
   * The arm gave up DELIBERATELY — a cancellation, a released document, a path
   * that must never be touched. **`I11`: refusal never destroys.** Retrying one
   * of these would resurrect exactly what somebody asked to have stopped, so
   * nothing in this tree may re-drive a terminal outcome.
   */
  TERMINAL: "terminal",
} as const;

export type PathDisposition = (typeof PATH_DISPOSITION)[keyof typeof PATH_DISPOSITION];

/**
 * The arms that report here. Named, so a typo cannot invent one and the census
 * over them stays closed — `empty-write-guard.ts`'s `EMPTY_WRITE_ARMS` rule.
 */
export const PATH_OUTCOME_ARMS = [
  /** `files/background-sync.ts` — `subscribe()`, one path's admission to the session. */
  "subscribe",
  /** `files/manifest.ts` — `syncFromManifest()`'s text branch, one path's join reconciliation. */
  "manifest-sync",
  /** `utils.ts` — `ensureFolder()`, one folder path's creation. */
  "ensure-folder",
] as const;

export type PathOutcomeArm = (typeof PATH_OUTCOME_ARMS)[number];

export interface PathOutcomeFacts {
  /** What this exit left behind. */
  readonly disposition: PathDisposition;
  /**
   * Does this exit emit a log line? The ordinary success and the ordinary
   * do-nothing do NOT: on a hundred-file vault they would be a hundred lines
   * per join and would bury the four that matter. They are still COUNTED —
   * that is `S155`'s requirement and it is about the ledger, not the log.
   *
   * A field rather than an `if` at each call site, so "which exits are audible"
   * is one table a reader and a test can both point at.
   */
  readonly logged: boolean;
  /** One sentence, stated in the log line. Never a value, never file content. */
  readonly why: string;
}

/**
 * `subscribe()`'S EXITS, ON CURRENT `HEAD`, and this list is smaller than
 * `S143` describes because **WP114 moved `attachObserver` to before
 * `waitForSync`**. Five of the exits `S143` names now happen with the observer
 * already installed, so they no longer leave the path unwatched — they leave it
 * unRECONCILED, which is a different and smaller defect. `no-doc` is the only
 * exit left that returns with the path genuinely outside the session.
 *
 * Pinned against the source by a derivation test rather than by this comment.
 */
export const SUBSCRIBE_OUTCOMES = {
  /**
   * `!isPathSafe(path)` — a peer-supplied manifest key that would escape the
   * vault. TERMINAL by construction: retrying a traversal is the attack.
   */
  UNSAFE_PATH: "unsafe-path",
  /** `observers.has(path)` — already watched. The purest do-nothing branch there is. */
  ALREADY_OBSERVED: "already-observed",
  /** `subscribing.has(path)` — another call owns this path right now and will attach. */
  IN_FLIGHT: "subscribe-in-flight",
  /**
   * `!docHandle` — `SyncManager.getDoc` answers `null` while the session is
   * neither connected nor connecting, or holds no room id. **THE ONE EXIT LEFT
   * THAT RETURNS WITH THE PATH UNOBSERVED**, and the condition is temporary by
   * nature, so it is the one that most needs a re-arm.
   */
  NO_DOC: "no-doc",
  /**
   * `waitForSync` rejected — its 10 s timeout, which a hidden renderer stretches
   * (`S147`). The observer IS attached, so remote deltas still land; what did
   * not happen is the one-off reconciliation, which on a HOST means the file's
   * bytes were never seeded into the document.
   */
  SYNC_FAILED: "sync-failed",
  /** `cancelledSubscribes.has(path)` — somebody asked for this to stop. TERMINAL. */
  CANCELLED: "cancelled",
  /** `docHandle.doc.isDestroyed` — the document was released. TERMINAL. */
  DOC_DESTROYED: "doc-destroyed",
  /** Fell through the whole body. The path is observed and reconciled. */
  COMPLETED: "completed",
} as const;

export type SubscribeOutcome = (typeof SUBSCRIBE_OUTCOMES)[keyof typeof SUBSCRIBE_OUTCOMES];

/** `syncFromManifest()`'s text branch — the four ways one path's text can end. */
export const MANIFEST_SYNC_OUTCOMES = {
  /** `!tempHandle` — `getDoc` answered `null`; the host's content cannot be read at all. */
  NO_DOC: "no-doc",
  /**
   * The `S119` floor refused an empty write. Recorded here TOO, deliberately:
   * `empty-write-guard.ts` counts it as a refusal across arms, and this ledger
   * counts it as one of this arm's four exits. A census over one function's
   * exits has to be closed inside that function or it cannot answer "which exit
   * did this path take". The two counters are independent and must agree; a
   * test asserts they do.
   */
  EMPTY_WRITE_REFUSED: "empty-write-refused",
  /**
   * The bare `catch`. **AND IT IS WIDER THAN `S157` SAYS** — it wraps
   * `waitForSync`, the empty-write decision, `preserveLocalVersion`,
   * `ensureFolder`, and the `vault.modify` / `vault.create` themselves. Which
   * of those threw is carried as the PHASE in `detail`, so the line can be
   * attributed without narrowing the `try` and changing control flow.
   */
  THREW: "threw",
  /** The write reached disk and `synced` was incremented. */
  SYNCED: "synced",
} as const;

export type ManifestSyncOutcome =
  (typeof MANIFEST_SYNC_OUTCOMES)[keyof typeof MANIFEST_SYNC_OUTCOMES];

/**
 * `ensureFolder()`'s exits. ONE OUTCOME PER CALL, not per path segment: the
 * caller asked for one folder to exist, and that question has one answer.
 * When segments disagree the WORST is reported — see `ensureFolder` itself.
 */
export const ENSURE_FOLDER_OUTCOMES = {
  /** The target was already a folder; the function returned on its first line. */
  ALREADY_A_FOLDER: "already-a-folder",
  /** Every segment already existed. Nothing was created and nothing failed. */
  NOTHING_TO_CREATE: "nothing-to-create",
  /** At least one segment was created and none failed. */
  CREATED: "created",
  /**
   * A `createFolder` threw AND the folder exists afterwards — the concurrent
   * create the `catch` was written for. Benign, and now VISIBLE, so it can be
   * told apart from the one below.
   */
  CREATE_RACED: "create-raced",
  /**
   * **S144.** A `createFolder` threw and the folder is STILL NOT THERE. The
   * caller is about to fail at whatever it wanted the folder for, and until
   * this line existed the user was told that operation failed — a rename, a
   * move — with no mention of the folder anywhere.
   */
  CREATE_FAILED: "create-failed",
} as const;

export type EnsureFolderOutcome =
  (typeof ENSURE_FOLDER_OUTCOMES)[keyof typeof ENSURE_FOLDER_OUTCOMES];

export type PathOutcome = SubscribeOutcome | ManifestSyncOutcome | EnsureFolderOutcome;

const { COMPLETED, DO_NOTHING, RETRYABLE, TERMINAL } = PATH_DISPOSITION;

/**
 * THE CLOSED SET, PER ARM, WITH WHAT EACH EXIT MEANS.
 *
 * This table is the whole specification. `notePathOutcome` rejects anything not
 * in it, `retryAbandonedSubscribes` reads `RETRYABLE` off it rather than
 * carrying its own list, and a source-derivation test pins the `subscribe`
 * column against the actual `return` statements in `background-sync.ts` — so a
 * new early return that forgets to report is a RED test rather than a silent
 * hole.
 */
export const PATH_OUTCOME_FACTS: {
  readonly [A in PathOutcomeArm]: Readonly<Record<string, PathOutcomeFacts>>;
} = {
  subscribe: {
    [SUBSCRIBE_OUTCOMES.UNSAFE_PATH]: {
      disposition: TERMINAL,
      logged: true,
      why: "the path is not safe; a peer-supplied key that escapes the vault is never subscribed",
    },
    [SUBSCRIBE_OUTCOMES.ALREADY_OBSERVED]: {
      disposition: DO_NOTHING,
      logged: false,
      why: "an observer is already installed for this path",
    },
    [SUBSCRIBE_OUTCOMES.IN_FLIGHT]: {
      disposition: DO_NOTHING,
      logged: false,
      why: "another subscribe for this path is already running and will attach the observer",
    },
    [SUBSCRIBE_OUTCOMES.NO_DOC]: {
      disposition: RETRYABLE,
      logged: true,
      why: "no document could be obtained, so this path is not observed at all; the session was not connected",
    },
    [SUBSCRIBE_OUTCOMES.SYNC_FAILED]: {
      disposition: RETRYABLE,
      logged: true,
      why: "the initial sync did not resolve; the observer is attached but the one-off reconciliation did not run",
    },
    [SUBSCRIBE_OUTCOMES.CANCELLED]: {
      disposition: TERMINAL,
      logged: true,
      why: "the subscribe was cancelled; a deliberate stop is never retried",
    },
    [SUBSCRIBE_OUTCOMES.DOC_DESTROYED]: {
      disposition: TERMINAL,
      logged: true,
      why: "the document was released; a released document is never resurrected",
    },
    [SUBSCRIBE_OUTCOMES.COMPLETED]: {
      disposition: COMPLETED,
      logged: false,
      why: "the path is observed and its one-off reconciliation ran",
    },
  },
  "manifest-sync": {
    [MANIFEST_SYNC_OUTCOMES.NO_DOC]: {
      disposition: RETRYABLE,
      logged: true,
      why: "no document could be obtained, so the host's content for this path could not be read",
    },
    [MANIFEST_SYNC_OUTCOMES.EMPTY_WRITE_REFUSED]: {
      disposition: TERMINAL,
      logged: true,
      why: "the empty-write floor refused this write; the local bytes were left exactly where they were",
    },
    [MANIFEST_SYNC_OUTCOMES.THREW]: {
      disposition: RETRYABLE,
      logged: true,
      why: "this path threw and the loop continued with the rest",
    },
    [MANIFEST_SYNC_OUTCOMES.SYNCED]: {
      disposition: COMPLETED,
      logged: false,
      why: "the host's content was written to this path",
    },
  },
  "ensure-folder": {
    [ENSURE_FOLDER_OUTCOMES.ALREADY_A_FOLDER]: {
      disposition: DO_NOTHING,
      logged: false,
      why: "the target is already a folder",
    },
    [ENSURE_FOLDER_OUTCOMES.NOTHING_TO_CREATE]: {
      disposition: DO_NOTHING,
      logged: false,
      why: "every segment of the path already existed",
    },
    [ENSURE_FOLDER_OUTCOMES.CREATED]: {
      disposition: COMPLETED,
      logged: false,
      why: "the folder was created",
    },
    [ENSURE_FOLDER_OUTCOMES.CREATE_RACED]: {
      disposition: COMPLETED,
      logged: true,
      why: "a create threw but the folder exists, so something else created it concurrently",
    },
    [ENSURE_FOLDER_OUTCOMES.CREATE_FAILED]: {
      disposition: RETRYABLE,
      logged: true,
      why: "the folder could not be created and does not exist; whatever the caller wanted it for will fail next",
    },
  },
};

/** The debug-log category every arm files under — the same one the other three emitters use. */
export const PATH_OUTCOME_LOG_CATEGORY = "file-op";

/** `S104`'s minimal structural logger. Declared here so this file stays import-free. */
export interface PathOutcomeLogger {
  warn(category: string, message: string): void;
}

export interface PathOutcomeInput {
  readonly arm: PathOutcomeArm;
  readonly outcome: PathOutcome;
  /** The path this outcome is ABOUT. Never its contents. */
  readonly path: string;
  /**
   * One extra fact, when the exit has one worth carrying — the phase that threw,
   * the error's message, the folder segment that failed. Never file content and
   * never a credential: every caller passes a message or a label it constructed,
   * not a value it read.
   */
  readonly detail?: string;
}

export interface PathOutcomeLedger {
  /** Total outcomes recorded since load, every arm, every branch. Never decremented. */
  total: number;
  /** `arm/outcome` → count. The whole point: a zero here means "did not run". */
  byArm: Record<string, number>;
  /** `disposition` → count, so "how much did this session give up on" is one read. */
  byDisposition: Record<string, number>;
}

/**
 * `S137`'S RULE: ONE SPELLING, AND IT NAMES THE PATH.
 *
 * An outcome that cannot be attributed to a file cannot be diagnosed — that was
 * the whole of `S137`, where a floor fired twice on an ordinary rejoin and
 * nobody could say which files it had fired for.
 *
 * `disposition` is on the line and not merely in the ledger because the log is
 * what a validator reads after the fact, and *"did this give up for good or was
 * it going to be retried"* is the question it will be asked.
 */
export function pathOutcomeMessage(input: PathOutcomeInput): string {
  const facts = factsFor(input.arm, input.outcome);
  const detail = input.detail ? ` detail=${input.detail}` : "";
  return (
    `PATH OUTCOME: arm=${input.arm} outcome=${input.outcome} path=${input.path} ` +
    `disposition=${facts.disposition}${detail} reason=${facts.why}`
  );
}

function factsFor(arm: PathOutcomeArm, outcome: string): PathOutcomeFacts {
  const facts = PATH_OUTCOME_FACTS[arm]?.[outcome];
  if (!facts) {
    // A closed set that can be silently widened by a typo is not closed. This
    // throws rather than counting an `undefined` cell, because the failure mode
    // it guards against is precisely a reading nobody can interpret.
    throw new Error(`path-outcome: '${outcome}' is not an outcome of arm '${arm}'`);
  }
  return facts;
}

/** READ-ONLY, and total, so `disposition` can be read without knowing the arms. */
export function pathOutcomeDisposition(
  arm: PathOutcomeArm,
  outcome: PathOutcome,
): PathDisposition {
  return factsFor(arm, outcome).disposition;
}

const countsByArm = new Map<string, number>();
const countsByDisposition = new Map<string, number>();
let outcomeTotal = 0;

/**
 * RECORD ONE OUTCOME: count it, and log it if this exit is one of the audible
 * ones.
 *
 * Counted FIRST, before anything that could return or throw — `single-writer.ts`
 * states the reason and `S155` is what it cost.
 *
 * ONE FUNCTION RATHER THAN THREE LINES PER CALL SITE, deliberately. The
 * empty-write floor shipped as a bare counter with a `console.warn` written out
 * separately at each arm; the two live firings then left a total with NO
 * ATTRIBUTION AT ALL, because the console is not the debug log and the debug log
 * is the one sink a validator reads after the fact.
 *
 * No `console.warn` here, unlike `noteEmptyWriteRefusal`. That one is a
 * near-data-loss and belongs in front of a developer with devtools open; these
 * are ordinary operational facts, several per join, and the debug log is their
 * sink.
 */
export function notePathOutcome(
  input: PathOutcomeInput,
  logger?: PathOutcomeLogger | null,
): string {
  const facts = factsFor(input.arm, input.outcome);
  outcomeTotal += 1;
  const key = `${input.arm}/${input.outcome}`;
  countsByArm.set(key, (countsByArm.get(key) ?? 0) + 1);
  countsByDisposition.set(
    facts.disposition,
    (countsByDisposition.get(facts.disposition) ?? 0) + 1,
  );
  const message = pathOutcomeMessage(input);
  if (facts.logged) logger?.warn(PATH_OUTCOME_LOG_CATEGORY, message);
  return message;
}

/** READ-ONLY. What every arm decided, so a live validator can read it. */
export function getPathOutcomes(): PathOutcomeLedger {
  return {
    total: outcomeTotal,
    byArm: Object.fromEntries(countsByArm),
    byDisposition: Object.fromEntries(countsByDisposition),
  };
}

/** Tests only. Production never resets a counter that answers "how many". */
export function resetPathOutcomes(): void {
  outcomeTotal = 0;
  countsByArm.clear();
  countsByDisposition.clear();
}
