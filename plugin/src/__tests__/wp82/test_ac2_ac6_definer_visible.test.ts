// ===========================================================================
// WP82 AC2 + AC6 — the pure, zero-import definer.
//
// These rows exercise the ONE definer directly. It takes facts and returns a
// verdict; it reads no globals, touches no socket and performs no I/O, so it is
// testable without a vault, a relay or a fake plugin — which is exactly the
// property that lets the status bar, `updateOnlineState` and the E2E report all
// resolve through it instead of each answering a fragment of the question.
// ===========================================================================

import { describe, expect, it } from "vitest";

import {
  LINK_READY_STATE,
  type LinkName,
  type LinkSnapshot,
  NO_ANNOUNCEMENT,
  announcementKey,
  beliefAgreesWithSocket,
  decideSharing,
  describeLifecycle,
  isLinkUp,
  nextAnnouncement,
  readyStateName,
  sharingNoticeText,
  sharingStatusText,
} from "../../sync/link-state";

function snapshot(link: LinkName, over: Partial<LinkSnapshot> = {}): LinkSnapshot {
  return {
    link,
    hasSocket: true,
    readyState: LINK_READY_STATE.OPEN,
    believedConnected: true,
    reconnectAttempts: 0,
    maxReconnectAttempts: link === "control" ? 10 : 15,
    retryChainEnded: false,
    lastChangeAt: 1,
    silenced: false,
    ...over,
  };
}

function facts(over: Partial<Parameters<typeof decideSharing>[0]> = {}) {
  return {
    control: snapshot("control"),
    mux: snapshot("mux"),
    sessionActive: true,
    role: "host" as string | null,
    offlineQueueDepth: 0,
    connectionState: "connected",
    ...over,
  };
}

describe("WP82 AC2 — a link is up iff its SOCKET is usable", () => {
  it("is OPEN-only: every other readyState is down, including a socket that is merely CLOSING", () => {
    expect(isLinkUp(snapshot("control", { readyState: LINK_READY_STATE.OPEN }))).toBe(true);
    for (const rs of [
      LINK_READY_STATE.CONNECTING,
      LINK_READY_STATE.CLOSING,
      LINK_READY_STATE.CLOSED,
    ]) {
      expect(isLinkUp(snapshot("control", { readyState: rs }))).toBe(false);
    }
  });

  it("a missing socket object is down even when readyState reads OPEN — ABSENT is its own fact", () => {
    expect(
      isLinkUp(snapshot("mux", { hasSocket: false, readyState: LINK_READY_STATE.ABSENT })),
    ).toBe(false);
    expect(readyStateName(LINK_READY_STATE.ABSENT)).toBe("ABSENT");
  });

  it("THE ANTI-LATCH ROW: belief does not move the verdict, in either direction", () => {
    // This is the WP82 defect and its mirror, side by side.
    // A: the promoted peer — socket OPEN, belief never set. Pre-WP82 it was
    //    reported as disconnected. It is up.
    const promoted = snapshot("control", { believedConnected: false });
    expect(isLinkUp(promoted)).toBe(true);
    expect(beliefAgreesWithSocket(promoted)).toBe(false);

    // B: the demoted peer — belief latched true under a role it no longer
    //    holds, socket gone. Pre-WP82 it was reported as connected. It is down.
    const demoted = snapshot("control", {
      believedConnected: true,
      hasSocket: false,
      readyState: LINK_READY_STATE.ABSENT,
    });
    expect(isLinkUp(demoted)).toBe(false);
    expect(beliefAgreesWithSocket(demoted)).toBe(false);
  });

  it("the break seam's `silenced` flag is NOT an input to the verdict", () => {
    // A silenced socket is the flaky-Wi-Fi shape and the peer cannot know about
    // it except through its own pong deadline. A definer that read this field
    // would let the instrument answer the question the instrument exists to ask.
    const silenced = snapshot("mux", { silenced: true });
    expect(isLinkUp(silenced)).toBe(true);
    expect(decideSharing(facts({ mux: silenced })).sharing).toBe(true);
  });
});

describe("WP82 AC6 — five states, and they must not collapse into two", () => {
  it("no session is not a failure", () => {
    const v = decideSharing(facts({ sessionActive: false }));
    expect(v.state).toBe("no-session");
  });

  it("connecting: a link that is down and has never retried", () => {
    const v = decideSharing(
      facts({ mux: snapshot("mux", { hasSocket: false, readyState: LINK_READY_STATE.ABSENT }) }),
    );
    expect(v.state).toBe("connecting");
    expect(v.downLinks).toEqual(["mux"]);
  });

  it("retrying: a link that is down with attempts already spent", () => {
    const v = decideSharing(
      facts({
        control: snapshot("control", {
          hasSocket: false,
          readyState: LINK_READY_STATE.ABSENT,
          reconnectAttempts: 3,
        }),
      }),
    );
    expect(v.state).toBe("retrying");
    expect(v.downLinks).toEqual(["control"]);
  });

  it("gave-up: a chain that has ended, and it outranks everything but no-session", () => {
    const v = decideSharing(
      facts({
        control: snapshot("control", {
          hasSocket: false,
          readyState: LINK_READY_STATE.ABSENT,
          reconnectAttempts: 10,
          retryChainEnded: true,
        }),
      }),
    );
    expect(v.state).toBe("gave-up");
    expect(v.endedLinks).toEqual(["control"]);
  });

  it("connected: both links OPEN — and `healthy` still refuses while ops are queued", () => {
    const clean = decideSharing(facts());
    expect(clean.state).toBe("connected");
    expect(clean.sharing).toBe(true);
    expect(clean.healthy).toBe(true);

    const queued = decideSharing(facts({ offlineQueueDepth: 4 }));
    expect(queued.state).toBe("connected");
    expect(queued.sharing).toBe(true);
    expect(queued.healthy).toBe(false);
    expect(queued.queuedOps).toBe(4);
  });

  it("roleBacked is a SEPARATE question from role — and `role` itself is never touched", () => {
    const down = decideSharing(
      facts({ mux: snapshot("mux", { hasSocket: false, readyState: LINK_READY_STATE.ABSENT }) }),
    );
    // The peer still holds the role; it is simply not backed by a live link.
    expect(down.roleBacked).toBe(false);
    expect(decideSharing(facts()).roleBacked).toBe(true);
    expect(decideSharing(facts({ role: null })).roleBacked).toBe(false);
  });
});

describe("WP82 AC6 — the status surface stops asserting health it has not measured", () => {
  it("the healthy string is returned VERBATIM — nothing changes in the healthy state", () => {
    const healthy = "Live Share: hosting (2) 41ms";
    expect(sharingStatusText(decideSharing(facts()), healthy)).toBe(healthy);
  });

  it("a broken link replaces `hosting` with a named, German, link-identified text", () => {
    const healthy = "Live Share: hosting";
    const text = sharingStatusText(
      decideSharing(
        facts({
          mux: snapshot("mux", {
            hasSocket: false,
            readyState: LINK_READY_STATE.ABSENT,
            reconnectAttempts: 2,
          }),
        }),
      ),
      healthy,
    );
    expect(text).not.toBe(healthy);
    expect(text).not.toContain("hosting");
    expect(text).toContain("mux");
    // A link is identified by NAME, never by URL — the socket URLs carry
    // `token`, `jwt` and `password` as query parameters.
    expect(text).not.toMatch(/wss?:|token|jwt|password/i);
  });

  it("both links OPEN but ops queued: the surface says NOT SYNCHRONISED, not `hosting`", () => {
    const text = sharingStatusText(decideSharing(facts({ offlineQueueDepth: 7 })), "Live Share: hosting");
    expect(text).toContain("7");
    expect(text).not.toContain("hosting");
  });
});

describe("WP82 AC5 — announce once, then count; recovery re-arms", () => {
  it("the key is bound to the STATE, not to the retry", () => {
    const downOnce = decideSharing(
      facts({
        control: snapshot("control", {
          hasSocket: false,
          readyState: LINK_READY_STATE.ABSENT,
          reconnectAttempts: 1,
        }),
      }),
    );
    const downLater = decideSharing(
      facts({
        control: snapshot("control", {
          hasSocket: false,
          readyState: LINK_READY_STATE.ABSENT,
          // nine more backoff ticks later — SAME key, so no second Notice.
          reconnectAttempts: 9,
        }),
      }),
    );
    expect(announcementKey(downOnce)).toBe(announcementKey(downLater));
    expect(announcementKey(decideSharing(facts()))).toBeNull();
  });

  it("one announcement, then a COUNTER that advances — and the counter is asserted, not just the absence", () => {
    let state = NO_ANNOUNCEMENT;
    const key = "down:control";

    const first = nextAnnouncement(state, key);
    expect(first.announce).toBe(true);
    expect(first.count).toBe(1);
    state = first.state;

    // The next five failures must NOT announce, and the counter MUST advance.
    // Asserting "no second Notice" alone would pass on a build that announces
    // nothing at all, which is why the count is paired with it here.
    const counts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const step = nextAnnouncement(state, key);
      expect(step.announce).toBe(false);
      state = step.state;
      counts.push(step.count);
    }
    expect(counts).toEqual([2, 3, 4, 5, 6]);
  });

  it("a recovery re-arms, and a further exhaustion announces AGAIN", () => {
    let state = nextAnnouncement(NO_ANNOUNCEMENT, "gave-up:control").state;
    const recovery = nextAnnouncement(state, null);
    expect(recovery.rearmed).toBe(true);
    state = recovery.state;
    const again = nextAnnouncement(state, "gave-up:control");
    expect(again.announce).toBe(true);
    expect(again.count).toBe(1);
  });

  it("a DIFFERENT state announces immediately rather than being swallowed by the counter", () => {
    const state = nextAnnouncement(NO_ANNOUNCEMENT, "down:control").state;
    const escalated = nextAnnouncement(state, "gave-up:control");
    expect(escalated.announce).toBe(true);
  });

  it("the notice text names the link and carries no URL fragment", () => {
    const text = sharingNoticeText(
      decideSharing(
        facts({
          control: snapshot("control", {
            hasSocket: false,
            readyState: LINK_READY_STATE.ABSENT,
            reconnectAttempts: 10,
            retryChainEnded: true,
          }),
        }),
      ),
    );
    expect(text).toContain("control");
    expect(text).not.toMatch(/wss?:|token=|jwt=|password=/i);
  });
});

describe("WP82 AC4 — the declared narration signatures", () => {
  it("each lifecycle kind renders a distinct, link-prefixed line", () => {
    const lines = [
      describeLifecycle({ kind: "open", link: "mux", reconnect: true }),
      describeLifecycle({ kind: "close", link: "mux", forced: false }),
      describeLifecycle({ kind: "close", link: "mux", forced: true }),
      describeLifecycle({ kind: "retry", link: "mux", attempt: 3, max: 15, delayMs: 800 }),
      describeLifecycle({
        kind: "gave-up",
        link: "mux",
        attempts: 15,
        max: 15,
        cause: "exhausted",
      }),
      describeLifecycle({
        kind: "abandoned",
        link: "mux",
        at: "openWebSocket",
        reason: "manager destroyed",
      }),
    ];
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) {
      expect(line.startsWith("mux link ")).toBe(true);
      expect(line).not.toMatch(/wss?:|token=|jwt=|password=/i);
    }
    // THE discriminator AC4 turns on: a clean FIN and a watchdog-forced close
    // must not render the same line.
    expect(lines[1]).not.toBe(lines[2]);
    expect(lines[2]).toContain("forced=true");
  });
});
