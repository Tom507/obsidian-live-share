// WP36 / C36 AC2 + AC3 — the THREE-WAY merge core, in isolation.
//
// The live rig is the acceptance evidence; this file is the mechanism's own
// arithmetic, and it exists because the failure this WP exists to prevent is
// INVISIBLE to any test that compares two replicas. Both replicas converge on
// the truncated string, so the assertion has to be over ONE client's capture:
// "given what I last saw, what I now save, and what the doc holds, which ops do
// I emit?".
//
// Every case below is written as base / next / current, and the discriminating
// property is always the same one: a character this client never observed the
// user delete must still be there afterwards.

import { describe, expect, it } from "vitest";

import {
  applyTextOps,
  diffBounds,
  planTextMerge,
} from "../../../canvas/canvas-text-merge";

describe("WP36 planTextMerge — the two-way trap, stated as a test", () => {
  it("does NOT delete a peer's merged character when the local file never had it", () => {
    // The worked example from the charter, verbatim.
    const base = "AliceBob"; // what this client last confirmed on its surface
    const next = "AliceXBob"; // this client's own save — no "Y" in it anywhere
    const current = "AliceYBob"; // the doc: peer B's "Y" is already merged in

    const plan = planTextMerge(base, next, current);
    const result = applyTextOps(current, plan.ops);

    expect(result).toContain("Y");
    expect(result).toContain("X");
    expect(result).toBe("AliceXYBob");
    expect(plan.fallback).toBe(false);
  });

  it("the SAME inputs through a two-way diff destroy the peer's character — the control", () => {
    // Passing `current` as the base is exactly what `applyMinimalYTextUpdate`
    // does (`const oldContent = text.toString()`). It is reproduced here so the
    // test above is a discrimination rather than an assertion about nothing.
    const twoWay = planTextMerge("AliceYBob", "AliceXBob", "AliceYBob");
    expect(applyTextOps("AliceYBob", twoWay.ops)).toBe("AliceXBob");
    expect(applyTextOps("AliceYBob", twoWay.ops)).not.toContain("Y");
  });

  it("a single-character SUBSTITUTION at the same offset keeps both markers", () => {
    // A: K -> X. B got there first with K -> Y. The local delete of "K" is a
    // no-op because "K" is already gone; deleting "the same offset" instead
    // would delete B's "Y".
    const plan = planTextMerge("AliceKBob", "AliceXBob", "AliceYBob");
    const result = applyTextOps("AliceYBob", plan.ops);
    expect(result).toContain("X");
    expect(result).toContain("Y");
    expect(result).not.toContain("K");
    expect(plan.resolution).toBe("overlap-delete-already-applied");
  });

  it("two insertions at the SAME offset both survive", () => {
    const plan = planTextMerge("AliceBob", "AliceXBob", "AliceYBob");
    const result = applyTextOps("AliceYBob", plan.ops);
    expect(result).toContain("X");
    expect(result).toContain("Y");
    expect(result.length).toBe("AliceBob".length + 2);
  });

  it("two insertions INSIDE THE SAME WORD both survive", () => {
    // "kollaboration" — A inserts "1" after "kolla", B inserts "2" after "kollabo".
    const base = "kollaboration";
    const next = "kolla1boration"; // the local save
    const current = "kollabo2ration"; // the doc, with the peer's edit merged
    const plan = planTextMerge(base, next, current);
    const result = applyTextOps(current, plan.ops);
    expect(result).toContain("1");
    expect(result).toContain("2");
    expect(result).toBe("kolla1bo2ration");
  });
});

describe("WP36 planTextMerge — a merge that never deletes is not a merge", () => {
  it("a genuine local deletion IS applied when nobody else touched the field", () => {
    const plan = planTextMerge("hello brave world", "hello world", "hello brave world");
    expect(applyTextOps("hello brave world", plan.ops)).toBe("hello world");
    expect(plan.resolution).toBe("exact");
  });

  it("a genuine local deletion is applied even with a DISJOINT peer edit present", () => {
    // Local: delete "brave ". Peer: appended "!".
    const plan = planTextMerge("hello brave world", "hello world", "hello brave world!");
    expect(applyTextOps("hello brave world!", plan.ops)).toBe("hello world!");
    expect(plan.resolution).toBe("disjoint-before");
  });

  it("a local edit AFTER the peer's span is shifted by the peer's length delta", () => {
    // base "one two three"; peer inserted "1" early; local appended "!".
    const plan = planTextMerge("one two three", "one two three!", "one1 two three");
    expect(applyTextOps("one1 two three", plan.ops)).toBe("one1 two three!");
    expect(plan.resolution).toBe("disjoint-after");
  });

  it("clearing a card to the empty string is a real deletion, not a refusal", () => {
    const plan = planTextMerge("something", "", "something");
    expect(applyTextOps("something", plan.ops)).toBe("");
  });

  it("no local change emits no ops at all, whatever the doc holds", () => {
    const plan = planTextMerge("same", "same", "same PEER EDIT");
    expect(plan.ops).toHaveLength(0);
    expect(plan.resolution).toBe("identical");
  });
});

describe("WP36 planTextMerge — the counted fallback CAN fire", () => {
  it("fires, and is reported, when the deleted text is ambiguous in the peer's span", () => {
    // The local user deleted "ab" from `1ab2`. The peer rewrote the span around
    // it into `XabYabZ`, so "ab" now occurs TWICE inside the peer's changed
    // span and there is no way to tell which copy the local user removed. The
    // mechanism does not guess: it falls back to a whole-value replace and says
    // so, which is what makes the counter meaningful in the live runs.
    const plan = planTextMerge("1ab2", "12", "1XabYabZ2");
    expect(plan.fallback).toBe(true);
    expect(plan.resolution).toBe("fallback-replace");
    expect(applyTextOps("1XabYabZ2", plan.ops)).toBe("12");
  });

  it("does NOT fire for any of the merge cases above", () => {
    const cases: [string, string, string][] = [
      ["AliceBob", "AliceXBob", "AliceYBob"],
      ["AliceKBob", "AliceXBob", "AliceYBob"],
      ["kollaboration", "kolla1boration", "kollabo2ration"],
      ["hello brave world", "hello world", "hello brave world!"],
      ["one two three", "one two three!", "one1 two three"],
    ];
    for (const [base, next, current] of cases) {
      expect(planTextMerge(base, next, current).fallback).toBe(false);
    }
  });
});

describe("WP36 planTextMerge — no third operand", () => {
  it("never deletes when the shadow has not observed the field", () => {
    // `base === undefined` is the first capture of a fresh session. A two-way
    // diff here is the forbidden shape, so this branch contributes insertions
    // only and leaves the peer's characters where they are.
    const plan = planTextMerge(undefined, "AliceXBob", "AliceYBob");
    const result = applyTextOps("AliceYBob", plan.ops);
    expect(result).toContain("Y");
    expect(result).toContain("X");
    expect(plan.resolution).toBe("no-base-insert-only");
    for (const op of plan.ops) expect(op.kind).toBe("insert");
  });

  it("emits nothing when the doc already agrees with the save", () => {
    const plan = planTextMerge(undefined, "same", "same");
    expect(plan.ops).toHaveLength(0);
    expect(plan.resolution).toBe("converged");
  });
});

describe("WP36 planTextMerge — an already-landed edit is not applied twice", () => {
  it("a STALE base plus an already-converged doc emits nothing", () => {
    // The shadow says "Alice"; the file says "AliceBob"; the doc already says
    // "AliceBob". Diffing base->next and replaying it would give "AliceBobBob".
    const plan = planTextMerge("Alice", "AliceBob", "AliceBob");
    expect(plan.ops).toHaveLength(0);
    expect(plan.resolution).toBe("converged");
    expect(plan.result).toBe("AliceBob");
  });
});

describe("WP36 diffBounds — the surrogate boundary rule", () => {
  it("never splits a surrogate pair on the prefix boundary", () => {
    // Two DIFFERENT astral characters sharing a high surrogate: U+1F600 and
    // U+1F601 are both \uD83D + a differing low surrogate.
    const a = "😀tail";
    const b = "😁tail";
    const { prefix } = diffBounds(a, b);
    expect(prefix).toBe(0);
  });

  it("produces a well-formed result for an astral replacement", () => {
    const plan = planTextMerge("😀tail", "😁tail", "😀tail");
    const result = applyTextOps("😀tail", plan.ops);
    expect(result).toBe("😁tail");
    expect([...result].length).toBe(5);
  });

  it("keeps an astral character whole when the peer's edit sits beside it", () => {
    const plan = planTextMerge("a😀b", "a😀bZ", "aQ😀b");
    const result = applyTextOps("aQ😀b", plan.ops);
    expect(result).toContain("Q");
    expect(result).toContain("Z");
    expect(result).toContain("😀");
  });
});

describe("WP36 planTextMerge — the plan's own `result` matches applying its ops", () => {
  it("agrees for every case in this file", () => {
    const cases: [string | undefined, string, string][] = [
      ["AliceBob", "AliceXBob", "AliceYBob"],
      ["AliceKBob", "AliceXBob", "AliceYBob"],
      ["kollaboration", "kolla1boration", "kollabo2ration"],
      ["hello brave world", "hello world", "hello brave world!"],
      ["one two three", "one two three!", "one1 two three"],
      ["aXbXc", "abXc", "aXqXbXc"],
      ["same", "same", "same PEER EDIT"],
      [undefined, "AliceXBob", "AliceYBob"],
      ["something", "", "something"],
      ["", "typed", ""],
    ];
    for (const [base, next, current] of cases) {
      const plan = planTextMerge(base, next, current);
      expect(plan.result).toBe(applyTextOps(current, plan.ops));
    }
  });
});
