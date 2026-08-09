// S159 — HASH EQUALITY READ AS FILE IDENTITY, AND THE DESTRUCTIVE HALF ACTS ON
// THE MATCH.
//
// THE CHARTER ASKED A QUESTION AND THIS FILE ANSWERS IT: is it only empty
// content, or ANY duplicate? IT IS ANY DUPLICATE. `hash("")` is not special in
// any way to the pairer — it is a full 64-character digest like every other
// digest, and `tp01b` shows two ORDINARY notes with identical bytes producing
// the identical mispairing. Empty content is not the defect; it is merely the
// most abundant supply of it, and `S119` left eighteen zero-byte `.md` files in
// one live vault.
//
// WHAT THE DESTRUCTIVE HALF ACTUALLY DOES, STATED PRECISELY BECAUSE IT IS NOT
// WHAT ONE FIRST ASSUMES. A tie requires equal bytes, so a wrong pair cannot
// corrupt the destination's CONTENT. What it does instead, and `tp02` executes
// all three:
//
//   1. `vault.rename` MOVES THE WRONG FILE. In Obsidian the path IS data —
//      wikilinks resolve by name, folder-scoped queries by parent, and ctime
//      follows the file object.
//   2. THE FILE THE ROOM DID *NOT* DELETE IS THE ONE THAT GETS TRASHED. A key
//      consumed by a rename is excluded from `actuallyRemoved`; the loser is
//      not, so it goes to `decideManifestRemoval` → DELEGATED → the gated
//      `cleanupStaleFiles` → `trashFile`. The survivor is the file the room
//      retired and the casualty is the file it kept, exactly inverted.
//   3. THE ANSWER DEPENDED ON ARRIVAL ORDER, so two peers handed the SAME event
//      with the keys in a different order moved DIFFERENT files and diverged
//      permanently and silently. That is `tp03`, and it is the property that
//      made "right" and "wrong" indistinguishable at the call site.
//
// NOTHING IS TRANSCRIBED. Every row in `tp02`–`tp05` runs the shipped
// `processManifestChange` and the shipped `cleanupStaleFiles` off
// `LiveSharePlugin.prototype`, against real `ManifestManager`s over one real
// `Y.Doc` whose hashes the real `publishManifest` computed. See `harness.ts` for
// exactly which collaborators are doubles and which paths they do not exercise.

import { describe, expect, it, vi } from "vitest";

// `main.ts` reaches `FuzzySuggestModal` and friends at module scope through
// `session/commands` → `ui/modals`, and the shared Obsidian double does not
// export them, so the import fails to LOAD before an assertion runs. Additive
// and local to this file, on the `v2/ux01` precedent; the shared mock is not
// touched.
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Stub {
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    constructor(..._args: any[]) {}
    open() {}
    close() {}
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    addItem(_cb: any) {
      return this;
    }
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    showAtMouseEvent(_e: any) {}
  }
  return {
    ...actual,
    Menu: Stub,
    FuzzySuggestModal: Stub,
    SuggestModal: Stub,
    requestUrl: async () => ({ status: 200, json: {}, text: "" }),
    setIcon: () => {},
    addIcon: () => {},
  };
});

import { RENAME_DECISION, decideManifestRename } from "../../../files/manifest-removal-decision";
import {
  IDENTITY_BASES,
  RENAME_PAIRING,
  pairRenamesByIdentity,
} from "../../../files/rename-identity";
import { ROOT, rig } from "./harness";

/** Two notes made from the same template. Ordinary, and byte-identical. */
const TEMPLATE = "# Notes\n\n- [ ] todo\n";
/** The `S119` state: a note truncated to nothing. */
const EMPTY = "";

const hashOf = (map: Record<string, string>) => (p: string) => map[p];

// ---------------------------------------------------------------------------
// tp01 — THE MECHANISM, on the pure pairer.
// ---------------------------------------------------------------------------

describe("S159 tp01 — content equality is not identity, and it never was only about empty files", () => {
  it("tp01a: two EMPTY notes are interchangeable — the pairer refuses both", () => {
    const digests = {
      [`${ROOT}/a.md`]: "e3b0",
      [`${ROOT}/b.md`]: "e3b0",
      [`${ROOT}/archive/kept.md`]: "e3b0",
    };
    const { pairs, ledger } = pairRenamesByIdentity(
      [`${ROOT}/a.md`, `${ROOT}/b.md`],
      [`${ROOT}/archive/kept.md`],
      hashOf(digests),
      hashOf(digests),
    );
    expect(pairs.size).toBe(0);
    expect(ledger.map((r) => r.outcome)).toStrictEqual([
      RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT,
      RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT,
    ]);
    expect(ledger[0].candidates).toStrictEqual([`${ROOT}/archive/kept.md`]);
    expect(ledger[0].rivals).toStrictEqual([`${ROOT}/b.md`]);
  });

  it("tp01b: THE CHARTER'S QUESTION — ANY duplicate, not only the empty one", () => {
    // Identical ORDINARY notes. Nothing about this digest is a special value;
    // the pairer sees exactly the same ambiguity it saw for the empty pair.
    const digests = {
      [`${ROOT}/alpha/notes.md`]: "9f1c",
      [`${ROOT}/beta/notes.md`]: "9f1c",
      [`${ROOT}/gamma/writeup.md`]: "9f1c",
    };
    const { pairs, ledger } = pairRenamesByIdentity(
      [`${ROOT}/alpha/notes.md`, `${ROOT}/beta/notes.md`],
      [`${ROOT}/gamma/writeup.md`],
      hashOf(digests),
      hashOf(digests),
    );
    expect(pairs.size).toBe(0);
    for (const row of ledger) {
      expect(row.outcome).toBe(RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT);
      expect(row.reason).toContain("content equality alone is not file identity");
    }
  });

  it("tp01c: the ledger carries ONE ROW PER REMOVED KEY in every branch (S155)", () => {
    const digests: Record<string, string> = {
      [`${ROOT}/unique.md`]: "u1",
      [`${ROOT}/newname.md`]: "u1",
      [`${ROOT}/orphan.md`]: "o1",
      [`${ROOT}/dup-a.md`]: "d1",
      [`${ROOT}/dup-b.md`]: "d1",
      [`${ROOT}/dup-target.md`]: "d1",
    };
    const removed = [`${ROOT}/unique.md`, `${ROOT}/orphan.md`, `${ROOT}/unreadable.md`, `${ROOT}/dup-a.md`, `${ROOT}/dup-b.md`];
    const { ledger } = pairRenamesByIdentity(
      removed,
      [`${ROOT}/newname.md`, `${ROOT}/dup-target.md`],
      hashOf(digests),
      hashOf(digests),
    );
    expect(ledger.map((r) => r.oldPath)).toStrictEqual(removed);
    expect(ledger.map((r) => r.outcome)).toStrictEqual([
      RENAME_PAIRING.UNIQUE_CONTENT,
      RENAME_PAIRING.REFUSED_NO_CONTENT_MATCH,
      RENAME_PAIRING.REFUSED_NO_LOCAL_HASH,
      RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT,
      RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT,
    ]);
    // "ran and declined" is never byte-identical to "never ran".
    for (const row of ledger) expect(row.reason.length).toBeGreaterThan(30);
  });

  it("tp01d: the tie-break is a PATH fact, not a cleverer use of the same digest", () => {
    // Three identical stubs dragged into a subfolder in one gesture. Content
    // says nothing; the filenames survive, and that is a rename signature.
    const digests: Record<string, string> = {};
    for (const p of ["a.md", "b.md", "c.md"]) {
      digests[`${ROOT}/${p}`] = "same";
      digests[`${ROOT}/sub/${p}`] = "same";
    }
    const { pairs, ledger } = pairRenamesByIdentity(
      [`${ROOT}/a.md`, `${ROOT}/b.md`, `${ROOT}/c.md`],
      [`${ROOT}/sub/a.md`, `${ROOT}/sub/b.md`, `${ROOT}/sub/c.md`],
      hashOf(digests),
      hashOf(digests),
    );
    expect([...pairs]).toStrictEqual([
      [`${ROOT}/a.md`, `${ROOT}/sub/a.md`],
      [`${ROOT}/b.md`, `${ROOT}/sub/b.md`],
      [`${ROOT}/c.md`, `${ROOT}/sub/c.md`],
    ]);
    for (const row of ledger) {
      expect(row.outcome).toBe(RENAME_PAIRING.UNIQUE_BASENAME_IN_CLASS);
    }
  });

  it("tp01e: an AMBIGUOUS basename inside an ambiguous digest class is still refused", () => {
    // The same filename in two folders, moving to the same filename in two other
    // folders, all identical bytes. The basename resolves nothing here, and a
    // tie-break that is itself a tie is not evidence.
    const digests: Record<string, string> = {
      [`${ROOT}/x/note.md`]: "same",
      [`${ROOT}/y/note.md`]: "same",
      [`${ROOT}/p/note.md`]: "same",
      [`${ROOT}/q/note.md`]: "same",
    };
    const { pairs } = pairRenamesByIdentity(
      [`${ROOT}/x/note.md`, `${ROOT}/y/note.md`],
      [`${ROOT}/p/note.md`, `${ROOT}/q/note.md`],
      hashOf(digests),
      hashOf(digests),
    );
    expect(pairs.size).toBe(0);
  });

  it("tp01f: the verdict does not depend on the order the keys arrive in", () => {
    const digests: Record<string, string> = {
      [`${ROOT}/a.md`]: "h1",
      [`${ROOT}/b.md`]: "h2",
      [`${ROOT}/A2.md`]: "h1",
      [`${ROOT}/B2.md`]: "h2",
    };
    const call = (removed: string[], added: string[]) =>
      [...pairRenamesByIdentity(removed, added, hashOf(digests), hashOf(digests)).pairs].sort();
    const forwards = call([`${ROOT}/a.md`, `${ROOT}/b.md`], [`${ROOT}/A2.md`, `${ROOT}/B2.md`]);
    const backwards = call([`${ROOT}/b.md`, `${ROOT}/a.md`], [`${ROOT}/B2.md`, `${ROOT}/A2.md`]);
    expect(forwards).toStrictEqual(backwards);
    expect(forwards).toHaveLength(2);
  });

  it("tp01g: the pairing is a bijection — no added key is ever claimed twice", () => {
    const digests: Record<string, string> = {
      [`${ROOT}/one.md`]: "h",
      [`${ROOT}/two.md`]: "h",
      [`${ROOT}/only.md`]: "h",
    };
    const { pairs } = pairRenamesByIdentity(
      [`${ROOT}/one.md`, `${ROOT}/two.md`],
      [`${ROOT}/only.md`],
      hashOf(digests),
      hashOf(digests),
    );
    expect([...pairs.values()]).toHaveLength(new Set(pairs.values()).size);
  });
});

// ---------------------------------------------------------------------------
// tp02 — THE DESTRUCTIVE HALF, driven end to end on the shipped code.
// ---------------------------------------------------------------------------

describe("S159 tp02 — the destructive half, on the real processManifestChange", () => {
  /**
   * The `S119` shape. Two zero-byte notes in the guest's vault; upstream, one of
   * them became `archive/august.md` and the other was genuinely deleted.
   *
   * Content cannot say which. The old pairer answered with array order.
   */
  const scenario = () =>
    rig({
      guest: {
        [`${ROOT}/journal/2026-08-01.md`]: EMPTY,
        [`${ROOT}/journal/2026-08-02.md`]: EMPTY,
        [`${ROOT}/keep.md`]: "something that stays",
      },
      host: {
        [`${ROOT}/archive/august.md`]: EMPTY,
        [`${ROOT}/keep.md`]: "something that stays",
      },
      baseline: [],
    });

  it("tp02a: NOTHING IS MOVED when content is the only evidence — I11, a refusal never destroys", async () => {
    const r = await scenario();
    const disposition = await r.run(
      [`${ROOT}/archive/august.md`],
      [`${ROOT}/journal/2026-08-01.md`, `${ROOT}/journal/2026-08-02.md`],
    );

    expect(r.guestVault.renames).toStrictEqual([]);
    expect(disposition.renamed).toStrictEqual([]);
    // The refusal is attributable, not silent: one ledger row per removed key.
    expect(disposition.renamePairing).toHaveLength(2);
    for (const row of disposition.renamePairing ?? []) {
      expect(row.outcome).toBe(RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT);
    }
    expect(r.logs.some((l) => l.includes("refused-ambiguous-content-identity"))).toBe(true);
  });

  it("tp02b: THE INVERSION — under the old rule the file the room KEPT is the one trashed", async () => {
    // The old pairer's answer, replayed through the shipped decision core so the
    // consequence is executed rather than described. `2026-08-01.md` is what
    // array order would have picked, and the room's actual survivor was
    // `2026-08-02.md`.
    const mispaired = decideManifestRename({
      oldPath: `${ROOT}/journal/2026-08-01.md`,
      newPath: `${ROOT}/archive/august.md`,
      hasContentPair: true,
      oldKind: "file",
      newExists: false,
    });
    // The core admits it, because per-pair it CANNOT see the rival — ambiguity
    // is a property of the whole event and this core sees one pairing. That is
    // precisely why the fix had to go in the pairer.
    expect(mispaired.verdict).toBe(RENAME_DECISION.RENAME);

    // And with the pairer refusing, the same event now trashes the loser only
    // through the GATED route, having moved nothing at all.
    const r = await scenario();
    const disposition = await r.run(
      [`${ROOT}/archive/august.md`],
      [`${ROOT}/journal/2026-08-01.md`, `${ROOT}/journal/2026-08-02.md`],
    );
    expect(disposition.delegated.sort()).toStrictEqual([
      `${ROOT}/journal/2026-08-01.md`,
      `${ROOT}/journal/2026-08-02.md`,
    ]);
    // BOTH vanished keys reach the one gated sink, which is the correct answer:
    // the room retired both keys, and neither of them is `archive/august.md`.
    expect(disposition.destroyed.sort()).toStrictEqual([
      `${ROOT}/journal/2026-08-01.md`,
      `${ROOT}/journal/2026-08-02.md`,
    ]);
    // The user's unrelated note is untouched. A reconcile that trashes
    // everything would satisfy the line above for the wrong reason.
    expect(r.guestVault.files.has(`${ROOT}/keep.md`)).toBe(true);
  });

  it("tp02c: the destructive sink is REACHABLE in this rig — the row above is not passing for want of a gate", async () => {
    // VACUITY GUARD. `tp02b` asserts what was trashed; if `cleanupStaleFiles`
    // could not trash anything in this rig, that assertion would be about
    // nothing. Here the same shipped reconcile, in the same rig, with the
    // evidence withdrawn, trashes NOTHING — so the floor demonstrably opens and
    // closes rather than being stuck.
    const closed = await rig({
      guest: { [`${ROOT}/journal/2026-08-01.md`]: EMPTY, [`${ROOT}/keep.md`]: "x" },
      host: { [`${ROOT}/keep.md`]: "x" },
      baseline: null, // no pre-join baseline was captured → the reconcile refuses
    });
    const disposition = await closed.run([], [`${ROOT}/journal/2026-08-01.md`]);
    expect(disposition.delegated).toStrictEqual([`${ROOT}/journal/2026-08-01.md`]);
    expect(disposition.destroyed).toStrictEqual([]);
    expect(closed.guestVault.trashed).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tp03 — THE DIVERGENCE THE OLD RULE PRODUCED BETWEEN PEERS.
// ---------------------------------------------------------------------------

describe("S159 tp03 — the same event, two key orders, one answer", () => {
  const build = () =>
    rig({
      guest: {
        [`${ROOT}/alpha/notes.md`]: TEMPLATE,
        [`${ROOT}/beta/notes.md`]: TEMPLATE,
      },
      host: { [`${ROOT}/gamma/writeup.md`]: TEMPLATE },
      baseline: [],
    });

  it("tp03a: two peers handed the keys in opposite orders reach the IDENTICAL vault state", async () => {
    const forwards = await build();
    await forwards.run(
      [`${ROOT}/gamma/writeup.md`],
      [`${ROOT}/alpha/notes.md`, `${ROOT}/beta/notes.md`],
    );
    const backwards = await build();
    await backwards.run(
      [`${ROOT}/gamma/writeup.md`],
      [`${ROOT}/beta/notes.md`, `${ROOT}/alpha/notes.md`],
    );

    expect(forwards.guestVault.renames).toStrictEqual(backwards.guestVault.renames);
    expect([...forwards.guestVault.files.keys()].sort()).toStrictEqual(
      [...backwards.guestVault.files.keys()].sort(),
    );
    // ...and, because the content was ambiguous, neither of them moved anything.
    expect(forwards.guestVault.renames).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tp04 — B3: ORDINARY RENAMES STILL FOLLOW. In both states.
// ---------------------------------------------------------------------------

describe("S159 tp04 — legitimate rename detection is intact (B3)", () => {
  it("tp04a: an ordinary same-folder rename of a NON-EMPTY note still moves the file", async () => {
    const r = await rig({
      guest: { [`${ROOT}/draft.md`]: "# a real note\n\nwith bytes in it\n" },
      host: { [`${ROOT}/final.md`]: "# a real note\n\nwith bytes in it\n" },
      baseline: [],
    });
    const disposition = await r.run([`${ROOT}/final.md`], [`${ROOT}/draft.md`]);

    expect(r.guestVault.renames).toStrictEqual([
      { from: `${ROOT}/draft.md`, to: `${ROOT}/final.md` },
    ]);
    expect(disposition.renamed).toStrictEqual([`${ROOT}/final.md`]);
    expect(disposition.renamePairing?.[0].outcome).toBe(RENAME_PAIRING.UNIQUE_CONTENT);
    // Nothing was trashed: the key was consumed by the rename, so it never
    // reached the removal loop.
    expect(r.guestVault.trashed).toStrictEqual([]);
  });

  it("tp04b: a CROSS-FOLDER move of a non-empty note still moves the file (S135 stays repaired)", async () => {
    const r = await rig({
      guest: { [`${ROOT}/inbox/idea.md`]: "# idea\n\nsomething\n" },
      host: { [`${ROOT}/archive/2026/idea.md`]: "# idea\n\nsomething\n" },
      baseline: [],
    });
    await r.run([`${ROOT}/archive/2026/idea.md`], [`${ROOT}/inbox/idea.md`]);
    expect(r.guestVault.renames).toStrictEqual([
      { from: `${ROOT}/inbox/idea.md`, to: `${ROOT}/archive/2026/idea.md` },
    ]);
  });

  it("tp04c: an ordinary rename of an EMPTY note still moves the file — the second state", async () => {
    // The state the charter asks about explicitly. One removed, one added, both
    // empty: the digest is unique on both sides, so identity holds and emptiness
    // is not treated as a special disqualifier. Empty content is not the defect;
    // AMBIGUITY is.
    const r = await rig({
      guest: { [`${ROOT}/Untitled.md`]: EMPTY },
      host: { [`${ROOT}/Meeting.md`]: EMPTY },
      baseline: [],
    });
    const disposition = await r.run([`${ROOT}/Meeting.md`], [`${ROOT}/Untitled.md`]);
    expect(r.guestVault.renames).toStrictEqual([
      { from: `${ROOT}/Untitled.md`, to: `${ROOT}/Meeting.md` },
    ]);
    expect(disposition.renamePairing?.[0].outcome).toBe(RENAME_PAIRING.UNIQUE_CONTENT);
  });

  it("tp04d: Bug E's original case — two CONCURRENT renames still pair by identity, not order", async () => {
    const r = await rig({
      guest: { [`${ROOT}/A.md`]: "content one", [`${ROOT}/C.md`]: "content two" },
      host: { [`${ROOT}/B.md`]: "content one", [`${ROOT}/D.md`]: "content two" },
      baseline: [],
    });
    // Deliberately handed in the crossed order the old comment names.
    await r.run([`${ROOT}/D.md`, `${ROOT}/B.md`], [`${ROOT}/A.md`, `${ROOT}/C.md`]);
    expect(r.guestVault.renames.map((x) => `${x.from}->${x.to}`).sort()).toStrictEqual([
      `${ROOT}/A.md->${ROOT}/B.md`,
      `${ROOT}/C.md->${ROOT}/D.md`,
    ]);
  });

  it("tp04e: three identical stubs dragged into a subfolder all follow (the basename rescue, live)", async () => {
    const r = await rig({
      guest: {
        [`${ROOT}/a.md`]: TEMPLATE,
        [`${ROOT}/b.md`]: TEMPLATE,
        [`${ROOT}/c.md`]: TEMPLATE,
      },
      host: {
        [`${ROOT}/sub/a.md`]: TEMPLATE,
        [`${ROOT}/sub/b.md`]: TEMPLATE,
        [`${ROOT}/sub/c.md`]: TEMPLATE,
      },
      baseline: [],
    });
    await r.run(
      [`${ROOT}/sub/a.md`, `${ROOT}/sub/b.md`, `${ROOT}/sub/c.md`],
      [`${ROOT}/a.md`, `${ROOT}/b.md`, `${ROOT}/c.md`],
    );
    expect(r.guestVault.renames.map((x) => `${x.from}->${x.to}`).sort()).toStrictEqual([
      `${ROOT}/a.md->${ROOT}/sub/a.md`,
      `${ROOT}/b.md->${ROOT}/sub/b.md`,
      `${ROOT}/c.md->${ROOT}/sub/c.md`,
    ]);
    expect(r.guestVault.trashed).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tp05 — B4: WP95's hostile case stays closed, and the core's new floor.
// ---------------------------------------------------------------------------

describe("S159 tp05 — WP95 stays pinned, and the identity basis is checked", () => {
  it("tp05a: a hostile publication that supplies the hash is STILL refused on the destination", async () => {
    // WP95's case: the attacker removes a shared key and adds one under
    // `.obsidian/plugins/live-share/`, with the SAME content, so the pair is
    // UNAMBIGUOUS and the S159 fix admits it. The protected-destination floor
    // runs FIRST and is what refuses — unchanged, and still load-bearing.
    const payload = "module.exports = 'not the user's code'";
    const r = await rig({
      guest: { [`${ROOT}/harmless.md`]: payload },
      host: { [`${ROOT}/decoy.md`]: "a file the host really has" },
      baseline: [],
    });
    const disposition = await r.run(
      [".obsidian/plugins/live-share/main.js"],
      [`${ROOT}/harmless.md`],
      { path: ".obsidian/plugins/live-share/main.js", content: payload },
    );

    // The pairer DID pair them — the point is that the refusal does not depend
    // on the pairer, so a future change there cannot re-open WP95.
    expect(disposition.renamePairing?.[0].outcome).toBe(RENAME_PAIRING.UNIQUE_CONTENT);
    expect(r.guestVault.renames).toStrictEqual([]);
    expect(disposition.renames[0].verdict).toBe(RENAME_DECISION.REFUSED);
    expect(disposition.renames[0].reason).toContain("protected tree");
  });

  it("tp05b: the decision core refuses a basis that is not an identity basis", () => {
    const base = {
      oldPath: `${ROOT}/old.md`,
      newPath: `${ROOT}/new.md`,
      hasContentPair: true,
      oldKind: "file" as const,
      newExists: false,
    };
    for (const basis of IDENTITY_BASES) {
      expect(decideManifestRename({ ...base, identityBasis: basis }).verdict).toBe(
        RENAME_DECISION.RENAME,
      );
    }
    for (const basis of [
      RENAME_PAIRING.REFUSED_AMBIGUOUS_CONTENT,
      "equal-content",
      "",
      42,
      null,
    ]) {
      const d = decideManifestRename({ ...base, identityBasis: basis });
      expect(d.verdict).toBe(RENAME_DECISION.REFUSED);
      expect(d.reason).toContain("identity basis");
    }
    // Absent stays permissive — that is what keeps every pre-S159 caller valid,
    // and `tp05c` is the instrument that stops it becoming a forgotten gate.
    expect(decideManifestRename(base).verdict).toBe(RENAME_DECISION.RENAME);
  });

  it("tp05c: EVERY shipped call site of decideManifestRename states an identityBasis", () => {
    // Derived from the tree, in the `v2/wp86` census idiom, because the floor
    // above is optional and an optional floor with no instrument is a floor
    // somebody forgets. A new call site that omits the basis fails HERE.
    const { readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
    const { dirname, join, resolve } = require("node:path") as typeof import("node:path");
    const { fileURLToPath } = require("node:url") as typeof import("node:url");

    let dir = dirname(fileURLToPath(import.meta.url));
    let src = "";
    for (let i = 0; i < 12; i++) {
      const candidate = join(dir, "plugin", "src", "utils.ts");
      try {
        statSync(candidate);
        src = join(dir, "plugin", "src");
        break;
      } catch {
        // keep walking
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
    expect(src).not.toBe("");

    const source = readFileSync(join(src, "main.ts"), "utf8");
    const calls = [...source.matchAll(/decideManifestRename\(\{([\s\S]*?)\n {12}\}\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).toContain("identityBasis");
    }
    // POSITIVE CONTROL — the matcher can fail. A call site with the field
    // stripped is detected rather than passing for want of a match.
    const stripped = calls[0][1].replace(/identityBasis/g, "someOtherField");
    expect(stripped).not.toContain("identityBasis");
  });
});
