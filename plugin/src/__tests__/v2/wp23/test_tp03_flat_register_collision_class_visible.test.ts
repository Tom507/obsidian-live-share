// WP23 / AC5 (the mandated op class) — "the op registry must include at least
// one op class that produces a record carrying BOTH the flat and the register
// spelling of the same fact, and one that varies the insertion order of those
// two keys."
//
// This is the razor, stated without any randomness so it cannot be missed: the
// same fact, spelled twice, with the register deliberately STALE, built once
// with the flat keys inserted first and once with the register inserted first.
//
// Why this class exists at all: `migrateV1ToV2` is deliberately ADDITIVE — it
// adds `pos`/`size` built at migration time and KEEPS the flat keys — while
// every live writer on this build moves a card by writing the FLAT keys. From
// that moment the record carries two spellings of one fact and they disagree.
// Before WP17 AC5 the doc→file projection resolved that collision by `Y.Map`
// INSERTION ORDER, which is not a rule at all: it is a function of the local
// integration history. A moved card snapped back to its pre-move coordinate — on
// EVERY replica.
//
// THE POINT OF THIS TEST IS THE CONTRAST. Both halves of it are asserted:
//
//   ├── the four CONVERGENCE families are green in both insertion orders and
//   │      would stay green if the wrong spelling won — every replica agrees,
//   │      the schema holds, the bytes are identical — and
//   └── the value is the one the last op AUTHORED, which is the only assertion
//          that can tell the two apart.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { FUZZ_TEST_TIMEOUT_MS } from "../../harness/fuzz/fuzzer";
import { projectFile } from "../../harness/fuzz/oracle";
import { createReplica, type FuzzReplica } from "../../harness/fuzz/replica";
import { quiesce } from "../../harness/fuzz/scheduler";

const PATH = "collision.canvas";

/** The card's TRUE position — what the last writer authored, in the flat keys. */
const MOVED_TO = { x: 900, y: 640 };
/** What the additive migration left behind in the register: the PRE-MOVE position. */
const STALE_REGISTER = { x: 100, y: 100 };

type Entry = [string, unknown];

function dualSpelledRecord(id: string, order: "flatFirst" | "registerFirst"): Entry[] {
  const flat: Entry[] = [
    ["x", MOVED_TO.x],
    ["y", MOVED_TO.y],
    ["width", 240],
    ["height", 120],
  ];
  const registers: Entry[] = [
    ["pos", encodePos(STALE_REGISTER.x, STALE_REGISTER.y)],
    ["size", encodeSize(240, 120)],
  ];
  return [
    ["id", id],
    ["type", "text"],
    ...(order === "flatFirst" ? [...flat, ...registers] : [...registers, ...flat]),
    ["text", "a card somebody moved"],
  ];
}

async function threeReplicas(): Promise<FuzzReplica[]> {
  return [await createReplica(0, PATH), await createReplica(1, PATH), await createReplica(2, PATH)];
}

function seed(replica: FuzzReplica, id: string, entries: readonly Entry[]): void {
  replica.doc.transact(() => {
    const record = new Y.Map<unknown>();
    for (const [key, value] of entries) record.set(key, value);
    replica.nodes().set(id, record);
  });
}

describe("WP23 AC5 — the flat-vs-register collision class, both insertion orders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const order of ["flatFirst", "registerFirst"] as const) {
    it(`resolves the collision to the AUTHORED value with the ${order} insertion order`, async () => {
      const replicas = await threeReplicas();
      try {
        seed(replicas[0], "card", dualSpelledRecord("card", order));
        expect(quiesce(replicas, () => vi.runOnlyPendingTimers()), "the replicas never settled").toBe(
          true,
        );

        const files = replicas.map(projectFile);

        // ---- the four CONVERGENCE families, all green ----------------------
        // Stated explicitly so the contrast is on the record: NONE of these can
        // tell the authored value from the stale one. They are satisfied by
        // agreement, and every replica agrees either way.
        expect(files[1].text, "replica 1 serialised different bytes").toBe(files[0].text);
        expect(files[2].text, "replica 2 serialised different bytes").toBe(files[0].text);
        for (const [index, file] of files.entries()) {
          const card = file.nodes.find((node) => node.id === "card");
          expect(card, `replica ${index} lost the record entirely`).toBeDefined();
          expect(
            typeof card?.x === "number" && typeof card?.y === "number",
            `replica ${index}: the schema invariant "no record without a position" broke`,
          ).toBe(true);
        }

        // ---- the INTENT-TRACE family, the only one that can fail here ------
        for (const [index, file] of files.entries()) {
          const card = file.nodes.find((node) => node.id === "card") as Record<string, unknown>;
          expect(
            card.x,
            `replica ${index}: the card snapped back to the STALE register's x. Every replica ` +
              `agrees on it, the bytes are identical and the schema holds — and it is still not ` +
              `where the last writer put it.`,
          ).toBe(MOVED_TO.x);
          expect(card.y, `replica ${index}: the card snapped back to the stale register's y`).toBe(
            MOVED_TO.y,
          );
        }
      } finally {
        for (const replica of replicas) replica.destroy();
      }
    }, FUZZ_TEST_TIMEOUT_MS);
  }

  it("the two insertion orders produce the SAME file — resolution is by rule, not by history", async () => {
    const texts: string[] = [];
    for (const order of ["flatFirst", "registerFirst"] as const) {
      const replicas = await threeReplicas();
      try {
        seed(replicas[0], "card", dualSpelledRecord("card", order));
        quiesce(replicas, () => vi.runOnlyPendingTimers());
        texts.push(projectFile(replicas[0]).text);
      } finally {
        for (const replica of replicas) replica.destroy();
      }
    }
    expect(
      texts[1],
      "the projected file depends on which spelling happened to be inserted first — that is a " +
        "function of local integration history, not of the state",
    ).toBe(texts[0]);
  }, FUZZ_TEST_TIMEOUT_MS);
});
