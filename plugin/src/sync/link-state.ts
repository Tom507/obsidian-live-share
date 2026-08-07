// ===========================================================================
// WP82 — THE definer of "is this peer sharing right now?"
//
// PURE and ZERO-IMPORT by contract (the `canvas-seed-decision.ts` /
// `canvas-mirror-decision.ts` precedent). It takes facts and returns a verdict:
// it reads no globals, holds no state, touches no socket and performs no I/O,
// so it is testable without a vault, a relay or a fake plugin. There is
// deliberately not even a `import type` here — `WebSocket.OPEN` is mirrored as
// a numeral below rather than imported, because the DOM lib is not available in
// every consumer of this module and a constant that cannot be reached is a
// constant that gets re-invented at the call site.
//
// WHY THIS FILE EXISTS. Before WP82 the process held THREE independent and
// mutually contradictory notions of connectivity:
//
//   1. `ConnectionStateManager` — drives the status bar, and NEVER SEES THE MUX.
//   2. `muxConnected && controlConnected` — drives `session.info` and
//      `FileOpsManager.setOnline`, and both operands were LATCHES set on
//      mutually exclusive, role-gated paths.
//   3. the two WebSocket objects — the only ones that are true, and they were
//      read by nothing.
//
// A peer that resumed as guest and was then promoted by the relay's
// `join-response` fell between both latch sites and was `connected: false` for
// the life of the session, while both of its sockets were open and its status
// bar read `Live Share: hosting`. Every file operation it performed went into
// an unbounded `OfflineQueue` whose only drain is an edge that could no longer
// occur.
//
// The repair is not a better latch. It is that notion 3 becomes the definer,
// notions 1 and 2 become OPERANDS of it, and the peer's own belief is reported
// BESIDE the measurement instead of standing in for it.
// ===========================================================================

/** The two links a peer holds. A link is identified by NAME, never by URL —
 * the socket URLs carry `token`, `jwt` and `password` as query parameters. */
export type LinkName = "control" | "mux";

/**
 * `WebSocket.readyState` numerals, mirrored so this module imports nothing,
 * plus one value the DOM does not have: `ABSENT`, for "there is no socket
 * object at all". That distinction is load-bearing — a peer between a close and
 * the next reconnect attempt holds `null`, which is a different fact from a
 * socket sitting in `CLOSED`, and collapsing the two is how "not connected"
 * came to mean four different things.
 */
export const LINK_READY_STATE = {
  ABSENT: -1,
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export function readyStateName(readyState: number): string {
  switch (readyState) {
    case LINK_READY_STATE.ABSENT:
      return "ABSENT";
    case LINK_READY_STATE.CONNECTING:
      return "CONNECTING";
    case LINK_READY_STATE.OPEN:
      return "OPEN";
    case LINK_READY_STATE.CLOSING:
      return "CLOSING";
    case LINK_READY_STATE.CLOSED:
      return "CLOSED";
    default:
      return `UNKNOWN(${readyState})`;
  }
}

/**
 * Everything known about one link at one instant. Every field is READ AT CALL
 * TIME by the producer; none is a stored verdict.
 */
export interface LinkSnapshot {
  link: LinkName;
  /** Does a socket object exist at all? */
  hasSocket: boolean;
  /** The LIVE `readyState`, read from the socket. `ABSENT` when there is none. */
  readyState: number;
  /**
   * The peer's OWN BELIEF about this link — the value that used to be the whole
   * story (`plugin.controlConnected` / `plugin.muxConnected`). Reported so that
   * belief and measurement can be seen to DISAGREE; never used as the verdict.
   */
  believedConnected: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  /** The retry chain has ended — this link will not come back on its own. */
  retryChainEnded: boolean;
  /** When this link's state last changed, epoch ms, or `null` if never. */
  lastChangeAt: number | null;
  /**
   * The E2E break seam has traffic suppressed on this link. Reported for the
   * rig's benefit and DELIBERATELY NOT an input to {@link isLinkUp}: a silenced
   * socket is the flaky-Wi-Fi shape, and the entire point of that shape is that
   * the peer CANNOT know about it except through its own pong deadline. A
   * definer that read this field would let the instrument answer the question
   * the instrument exists to ask.
   */
  silenced: boolean;
}

/**
 * THE predicate. A link is up when, and only when, its socket is usable —
 * exactly the condition `ControlChannel.send` and `SyncManager.sendMux` apply
 * before putting a byte on the wire. Not "the peer thinks so", not "the peer
 * held role X when the socket opened".
 */
export function isLinkUp(snapshot: LinkSnapshot): boolean {
  return snapshot.hasSocket && snapshot.readyState === LINK_READY_STATE.OPEN;
}

/**
 * Do the peer's belief and the socket agree? `false` is not automatically a
 * defect — there is a real window between a close and the `onclose` callback —
 * but a `false` that persists is the WP82 defect itself.
 */
export function beliefAgreesWithSocket(snapshot: LinkSnapshot): boolean {
  return snapshot.believedConnected === isLinkUp(snapshot);
}

/** Facts about the whole peer, assembled by the caller, decided here. */
export interface PeerLinkFacts {
  control: LinkSnapshot;
  mux: LinkSnapshot;
  /** Is there a session at all? `enabled === false` is not a failure. */
  sessionActive: boolean;
  /** `settings.role` verbatim. The QUALIFIED question gets its own field below. */
  role: string | null;
  /** `OfflineQueue.size` — how many ops are waiting for a drain. */
  offlineQueueDepth: number;
  /**
   * `ConnectionStateManager.getState()`. An OPERAND of this definer, not a
   * rival to it — it is the only thing that knows about `auth-required`.
   */
  connectionState: string;
}

/**
 * Five states, and they must not collapse into two. `enabled === false` is not
 * a failure (WP81's distinction, transposed).
 */
export type SharingState = "no-session" | "connecting" | "retrying" | "gave-up" | "connected";

export interface SharingVerdict {
  state: SharingState;
  /** Both links measurably usable. This is the answer to "am I sharing?". */
  sharing: boolean;
  /** Is `role` currently BACKED by a live link? NOT the same question as `role`. */
  roleBacked: boolean;
  /** Links that are not up, by name. */
  downLinks: LinkName[];
  /** Links whose retry chain has ended, by name. */
  endedLinks: LinkName[];
  /** Links whose belief contradicts their socket, by name. */
  desyncedLinks: LinkName[];
  queuedOps: number;
  /**
   * Sharing AND nothing queued AND no chain has ended. The status surface may
   * claim health only when this is true.
   */
  healthy: boolean;
  reason: string;
}

/**
 * The one decision. Every consumer — the status bar, `updateOnlineState`, and
 * the E2E link report — resolves through this function.
 */
export function decideSharing(facts: PeerLinkFacts): SharingVerdict {
  const links: LinkSnapshot[] = [facts.control, facts.mux];
  const downLinks = links.filter((l) => !isLinkUp(l)).map((l) => l.link);
  const endedLinks = links.filter((l) => l.retryChainEnded).map((l) => l.link);
  const desyncedLinks = links.filter((l) => !beliefAgreesWithSocket(l)).map((l) => l.link);
  const sharing = downLinks.length === 0;
  const queuedOps = facts.offlineQueueDepth;

  let state: SharingState;
  let reason: string;
  if (!facts.sessionActive) {
    state = "no-session";
    reason = "no session is active";
  } else if (endedLinks.length > 0) {
    state = "gave-up";
    reason = `retry chain ended on: ${endedLinks.join(", ")}`;
  } else if (sharing) {
    state = "connected";
    reason = "both links are OPEN";
  } else if (links.some((l) => !isLinkUp(l) && l.reconnectAttempts > 0)) {
    state = "retrying";
    reason = `reconnecting: ${downLinks.join(", ")}`;
  } else {
    state = "connecting";
    reason = `not yet established: ${downLinks.join(", ")}`;
  }

  const healthy = state === "connected" && queuedOps === 0;
  if (state === "connected" && queuedOps > 0) {
    reason = `both links are OPEN but ${queuedOps} op(s) are still queued`;
  }

  return {
    state,
    sharing,
    roleBacked: sharing && facts.role !== null && facts.role !== "",
    downLinks,
    endedLinks,
    desyncedLinks,
    queuedOps,
    healthy,
    reason,
  };
}

// ---------------------------------------------------------------------------
// The status surface, and the once-then-count announcement discipline.
// ---------------------------------------------------------------------------

/**
 * The text the status bar shows when the peer is NOT healthy but a session is
 * active. German (§1 UI-language rule) — the pre-existing English strings are
 * untouched and keep their language, which is not this WP's subject.
 *
 * `healthyText` is passed in and returned VERBATIM when the verdict is healthy,
 * so the existing healthy string is byte-unchanged.
 */
export function sharingStatusText(verdict: SharingVerdict, healthyText: string): string {
  if (verdict.healthy) return healthyText;
  const queued = verdict.queuedOps > 0 ? ` — ${verdict.queuedOps} Ops in Warteschlange` : "";
  switch (verdict.state) {
    case "no-session":
      return healthyText;
    case "gave-up":
      return `Live Share: Verbindung aufgegeben (${verdict.endedLinks.join(", ")})${queued}`;
    case "retrying":
      return `Live Share: Verbindung unterbrochen (${verdict.downLinks.join(", ")})${queued}`;
    case "connecting":
      return `Live Share: verbinde (${verdict.downLinks.join(", ")})${queued}`;
    default:
      // Both links OPEN, but something is still queued: this peer is NOT
      // synchronised and must not say `hosting`.
      return `Live Share: nicht synchronisiert${queued}`;
  }
}

/** The `Notice` text for the transition into an unhealthy state. German. */
export function sharingNoticeText(verdict: SharingVerdict): string {
  switch (verdict.state) {
    case "gave-up":
      return `Live Share: Verbindung aufgegeben (${verdict.endedLinks.join(", ")}) — es werden keine Änderungen mehr übertragen`;
    case "retrying":
    case "connecting":
      return `Live Share: diese Sitzung überträgt gerade nicht (${verdict.downLinks.join(", ")})`;
    default:
      return `Live Share: ${verdict.queuedOps} Änderung(en) konnten noch nicht übertragen werden`;
  }
}

/**
 * The key an announcement is bound to. Bound to the STATE, never to the retry —
 * a `Notice` per backoff tick at 300 ms base delay would be a worse defect than
 * the silence it replaces. `null` means "healthy, nothing to announce".
 */
export function announcementKey(verdict: SharingVerdict): string | null {
  if (verdict.healthy || verdict.state === "no-session") return null;
  if (verdict.state === "gave-up") return `gave-up:${verdict.endedLinks.join(",")}`;
  if (!verdict.sharing) return `down:${verdict.downLinks.join(",")}`;
  return "queued";
}

export interface AnnouncementState {
  key: string | null;
  /** How many times this key has been observed since it was announced. */
  count: number;
}

export const NO_ANNOUNCEMENT: AnnouncementState = { key: null, count: 0 };

export interface AnnouncementDecision {
  state: AnnouncementState;
  /** Raise a `Notice` exactly now. */
  announce: boolean;
  /** The state re-armed: it was unhealthy and is healthy again. */
  rearmed: boolean;
  /** Occurrences of this key so far, this one included. */
  count: number;
}

/**
 * ANNOUNCE ONCE, THEN COUNT — WP81's landed discipline, as a pure reducer so
 * the caller holds nothing but the previous state.
 *
 * - a new key announces and sets the count to 1
 * - the same key again only advances the count
 * - `null` (recovery) re-arms, so the next occurrence announces again
 */
export function nextAnnouncement(
  previous: AnnouncementState,
  key: string | null,
): AnnouncementDecision {
  if (key === null) {
    return {
      state: NO_ANNOUNCEMENT,
      announce: false,
      rearmed: previous.key !== null,
      count: previous.count,
    };
  }
  if (previous.key === key) {
    const count = previous.count + 1;
    return { state: { key, count }, announce: false, rearmed: false, count };
  }
  return { state: { key, count: 1 }, announce: true, rearmed: false, count: 1 };
}

// ===========================================================================
// WP88 — the terminal state's CONSUMERS. No new state, no second definer.
//
// `SharingState` already carries `"gave-up"` and `decideSharing` already
// resolves it at the top of its chain. Everything below reads that verdict and
// nothing below decides what "gave up" means. The defect WP88 repairs is not a
// missing state — it is that five production routes destroyed the session
// identity without ever asking this module whether a chain had ended.
//
// THE RULING, so the next reader does not have to reconstruct it: losing the
// connection is a fact about the network; losing `roomId` / `token` / `role` is
// a fact the client MANUFACTURES about itself, on local, negative, momentary
// evidence. Stale credentials cost one failed join. Discarded good ones cost a
// fresh invite for every peer and — on a host, which issues
// `DELETE /rooms/{roomId}` first — a room nobody has. I11: a refusal never
// destroys.
// ===========================================================================

/**
 * WHY a peer stopped sharing. Every member is a CONNECTIVITY fact, never a
 * decision about the session: none of them is evidence that the room is gone,
 * that the credentials are wrong, or that the user wanted to leave.
 *
 * - `retry-exhausted`   — the chain ended after having connected at least once
 *                         (control `disconnected`, mux `onMaxReconnect`).
 * - `never-established` — the chain ended without the relay ever answering on
 *                         this link (control `auth-required`). **This is S39.**
 *                         The old code rendered it as "authentication required
 *                         — sign in via settings", which is a claim about the
 *                         SERVER'S ANSWER made when there was no answer at all.
 * - `resume-failed`     — the plugin-load resume threw (E5, no ceiling at all).
 */
export type SeveranceCause = "retry-exhausted" | "never-established" | "resume-failed";

/**
 * WP88 — S46. A digest proves WHICH build, not WHOSE. This literal is unique to
 * this batch's own change, is referenced from `severanceReport()` so it cannot
 * be tree-shaken out of either bundle, and is greppable in the INSTALLED bytes
 * before any live row is trusted. It carries no credential, no URL and no
 * version number.
 */
export const WP88_BUILD_MARKER = "WP88-B34-RETRY-CEILING-SEVERANCE";

/**
 * The `Notice` for a severance. German (§1). Each string states the fact and
 * the remedy and asserts NOTHING the peer cannot know.
 *
 * `never-established` deliberately names BOTH possibilities. A client that has
 * never had an answer from the relay cannot tell "the relay rejected these
 * credentials" from "the relay was never reached" — the socket is closed either
 * way and no close code is captured anywhere in this plugin. Naming one of them
 * as the diagnosis is the same move the whole defect is made of. Recorded, not
 * repaired: distinguishing them needs close-code inspection nobody owns.
 */
export function severanceNoticeText(cause: SeveranceCause, links: LinkName[]): string {
  const named = links.length > 0 ? ` (${links.join(", ")})` : "";
  switch (cause) {
    case "retry-exhausted":
      return `Live Share: Verbindung verloren${named} — es werden keine Änderungen mehr übertragen. Die Sitzung bleibt bestehen; "Live Share: Verbindung erneut versuchen" stellt sie wieder her.`;
    case "never-established":
      return `Live Share: Verbindung zum Relay konnte nicht hergestellt werden${named} — entweder ist das Relay nicht erreichbar oder die Zugangsdaten wurden abgelehnt; das lässt sich hier nicht unterscheiden. Die Sitzung bleibt bestehen; "Live Share: Verbindung erneut versuchen" versucht es erneut.`;
    case "resume-failed":
      return `Live Share: Sitzung konnte nicht fortgesetzt werden — die Sitzungsdaten bleiben erhalten. "Live Share: Verbindung erneut versuchen" versucht es erneut.`;
  }
}

/**
 * The log line for a severance. A DECLARED machine contract (BUILD_SPEC §10),
 * new in WP88 — no existing signature changes. Uppercase ASCII, no URL, no
 * credential value, and it names the keys that were RETAINED rather than any of
 * their contents.
 */
export function severanceLogLine(cause: SeveranceCause, links: LinkName[]): string {
  return `SHARING HALTED: cause=${cause} links=${links.join(",") || "none"} sessionIdentityRetained=true roomDeleted=false`;
}

/**
 * The announcement key for a severance, on the landed once-then-count
 * discipline. Bound to the CAUSE and the links, never to the retry.
 */
export function severanceAnnouncementKey(cause: SeveranceCause, links: LinkName[]): string {
  return `halted:${cause}:${links.join(",")}`;
}

// ---------------------------------------------------------------------------
// WP88 (AC6) — S40's coupling, bounded BY CONSTRUCTION rather than by a cap.
//
// C82 ruled that an `OfflineQueue` cap is a data-retention decision and left it
// unowned. That ruling stands: nothing here introduces a cap constant, chooses
// an eviction policy, or discards anything already queued.
//
// What WP88 owns is the bound it REMOVES. Today the queue is bounded by the
// session being destroyed ~128 s after the link dies — an accidental,
// destructive bound, but a bound. After WP88 a peer can sit in `"gave-up"`
// indefinitely with `FileOpsManager.isOnline === false`, enqueuing forever.
//
// The structural answer needs no constant: once the chain that CARRIES file
// operations has ended, the peer KNOWS it will not send these ops. Continuing
// to accept them is the same lie the status bar told before WP82. So it stops
// accepting, counts the refusals, and says so once.
// ---------------------------------------------------------------------------

/**
 * The link file operations travel on. Named once, here, so `main.ts` does not
 * spell the coupling out a second time: `FileOpsManager`'s sender is
 * `ControlChannel.send({type:"file-op"})`.
 */
export const FILE_OP_CARRIER_LINK: LinkName = "control";

/**
 * May the offline queue still accept? `false` once the CARRIER's retry chain
 * has ended — not merely when the peer is offline, which is the ordinary,
 * recoverable case the queue exists for.
 */
export function acceptsIntoOfflineQueue(
  verdict: SharingVerdict,
  carrier: LinkName = FILE_OP_CARRIER_LINK,
): boolean {
  return !verdict.endedLinks.includes(carrier);
}

/**
 * The announcement key for the seal, or `null` while the queue still accepts.
 * Separate from {@link announcementKey} on purpose: "this peer is not sharing"
 * and "this peer has stopped accepting work" are different facts and a user who
 * saw the first is still entitled to be told the second.
 */
export function offlineQueueSealKey(
  verdict: SharingVerdict,
  carrier: LinkName = FILE_OP_CARRIER_LINK,
): string | null {
  return acceptsIntoOfflineQueue(verdict, carrier) ? null : `queue-sealed:${carrier}`;
}

/** The `Notice` for the seal. German. States that nothing queued was thrown away. */
export function offlineQueueSealNoticeText(queued: number, carrier: LinkName): string {
  return `Live Share: Dateiänderungen werden nicht mehr zwischengespeichert (${carrier}) — ${queued} bereits vorgemerkte Änderung(en) bleiben erhalten.`;
}

// ---------------------------------------------------------------------------
// Link lifecycle narration (AC4 / AC5).
// ---------------------------------------------------------------------------

/**
 * Every exit a link's lifecycle can take, INCLUDING the ones that produced no
 * observable outcome at all before WP82 (S38: two early `return`s that abandon
 * a scheduled reconnect, and an unguarded `new WebSocket(url)` whose throw
 * inside a reconnect timer terminated the chain permanently and invisibly).
 *
 * `forced` on a close distinguishes the two break shapes and is the reason a
 * naive "some line appeared" assertion cannot satisfy AC4: only the pong
 * deadline produces `forced: true`.
 */
export type LinkLifecycleEvent =
  | { kind: "open"; link: LinkName; reconnect: boolean }
  | { kind: "close"; link: LinkName; forced: boolean }
  | { kind: "retry"; link: LinkName; attempt: number; max: number; delayMs: number }
  | {
      kind: "gave-up";
      link: LinkName;
      attempts: number;
      max: number;
      cause: "exhausted" | "socket-construction-threw";
      detail?: string;
    }
  | {
      kind: "abandoned";
      link: LinkName;
      /** Which silent early return was taken. */
      at: string;
      reason: string;
    };

/**
 * The one-line narration for a lifecycle event. A DECLARED machine contract
 * (BUILD_SPEC §1/§10): the shape is `<link> link <verb> …`, always prefixed by
 * the link's NAME and never by its URL.
 */
export function describeLifecycle(event: LinkLifecycleEvent): string {
  switch (event.kind) {
    case "open":
      return `${event.link} link open (reconnect=${event.reconnect})`;
    case "close":
      return `${event.link} link closed (forced=${event.forced})`;
    case "retry":
      return `${event.link} link retry ${event.attempt}/${event.max} in ${event.delayMs}ms`;
    case "gave-up":
      return `${event.link} link gave up after ${event.attempts}/${event.max} attempts (cause=${event.cause}${
        event.detail ? `, detail=${event.detail}` : ""
      })`;
    case "abandoned":
      return `${event.link} link reconnect abandoned at ${event.at} (${event.reason})`;
  }
}
