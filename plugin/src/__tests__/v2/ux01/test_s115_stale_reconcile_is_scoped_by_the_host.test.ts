// S115 — THE GUEST'S STALE RECONCILE IS SCOPED BY THE HOST, AND IT REFUSES
// WHEN IT CANNOT FIND OUT.
//
// The companion file `test_s115_guest_stale_reconcile_candidate_set.test.ts`
// demonstrates the DEFECT: `isSharedPath` answers from the LOCAL peer's
// `sharedFolder`, which ships empty, and empty means "the whole vault". That
// file computes the candidate set with the real predicate but transcribes the
// selection; it never executes the trash loop, and it says so.
//
// THIS FILE EXECUTES THE TRASH LOOP. `cleanupStaleFiles` is invoked off
// `LiveSharePlugin.prototype` with a fake `this` (the `v2/wp85` precedent), so
// the body under test — the four evidence floors, the new scope floor, the
// candidate filter and the `for … await trashFile` loop — is the shipped code,
// byte for byte. Only its collaborators are doubles, and the two that carry the
// property are NOT doubled: both `ManifestManager`s are real, connected to one
// real `Y.Doc`, and the host's scope is written by the real `publishManifest`
// rather than hand-poked into the map. What a guest reads here is what a host
// actually emits.
//
// WHAT IS DEMONSTRATED (executed, not argued):
//   ├── AC2 the candidate set follows the HOST's root, across three different
//   │        guest settings that would each have selected something else
//   ├── AC3 an older host that publishes no scope produces ZERO trashFile calls
//   ├── AC4 both halves in one run: a stale file INSIDE the host's tree is
//   │        trashed, a private note OUTSIDE it is not, same pass, same vault
//   └── AC5 the decision's `scope` field and the emitted log line
//
// VACUITY GUARDS, because a destructive test that destroys nothing proves
// nothing:
//   ├── every refusal row asserts `trashed` is empty AND that the positive
//   │        control in the same file DOES trash — a floor that cannot open is
//   │        indistinguishable from a floor that never closes
//   ├── the AC4 row names both paths, never a count, and asserts the survivor
//   │        was genuinely a candidate under the old rule (`isSharedPath` is
//   │        true for it) so the row cannot pass because the file was already
//   │        excluded for some unrelated reason
//   └── the guest's own `sharedFolder` is set to a value that DISAGREES with
//            the host's in every scoped row, so a fix that silently kept
//            reading the local field cannot pass any of them

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// `main.ts` pulls in `Menu`, `requestUrl` and (via `session/commands` ->
// `ui/modals`) `FuzzySuggestModal`, none of which the shared Obsidian double
// exports — and `UserPickerModal` extends the last one AT MODULE SCOPE, so the
// import fails to LOAD before a single assertion runs. Additive and local to
// this file, on the `v2/wp85` precedent; the shared mock is not touched.
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

import { ManifestManager } from "../../../files/manifest";
import LiveSharePlugin from "../../../main";
import {
  DEFAULT_SETTINGS,
  type LiveShareSettings,
  type StaleReconcileDecision,
} from "../../../types";

const HOST_ID = "the-live-host";
const GUEST_ID = "the-guest";
const HOST_ROOT = "_liveshare-test";

/**
 * The guest's vault. Four private notes the host has never heard of, plus two
 * files inside the folder the host actually shares — one of which the host
 * still has (so it must survive) and one it does not (so it must go).
 */
const GUEST_VAULT = [
  "Journal/2026-08-07.md",
  "Taxes/2025 return.md",
  "Thesis/chapter 3.md",
  "attachments/passport.png",
  `${HOST_ROOT}/shared note.md`,
  `${HOST_ROOT}/deleted upstream.md`,
];

/** What the host still has. `deleted upstream.md` is deliberately absent. */
const HOST_VAULT = [`${HOST_ROOT}/shared note.md`];

function vaultDouble(paths: string[]) {
  const files = paths.map((path) => ({ path, stat: { size: 1, mtime: 1, ctime: 1 } }));
  return {
    getFiles: vi.fn(() => files),
    getAllLoadedFiles: vi.fn(() => files),
    getAbstractFileByPath: vi.fn((): Record<string, unknown> | null => null),
    read: vi.fn(async () => "content"),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
    adapter: { exists: vi.fn(async () => false) },
  };
}

function syncDouble(doc: Y.Doc) {
  return {
    getDoc: () => ({ doc, text: doc.getText("content"), awareness: {} }),
    waitForSync: async () => {},
    releaseDoc: vi.fn(),
  };
}

interface Rig {
  run: () => Promise<StaleReconcileDecision>;
  trashed: string[];
  logs: string[];
  guestManifest: ManifestManager;
}

/**
 * One `Y.Doc`, two real `ManifestManager`s, and the real `cleanupStaleFiles`.
 *
 * `hostPublishes: false` stands for an older host — the attestation is written
 * with the exact shape a pre-S115 build emits (no `sharedRoot`), rather than by
 * deleting a field afterwards, so the row measures the real compatibility case.
 */
async function rig(options: {
  guestSharedFolder: string;
  hostSharedFolder?: string;
  /** `false` = a pre-S115 host: it attests, but states no scope. */
  hostStatesScope?: boolean;
  /** `false` = nobody claiming host is present in the session. */
  liveHost?: boolean;
  /** Overrides the guest's vault contents. Defaults to {@link GUEST_VAULT}. */
  guestPaths?: string[];
  /**
   * S116 — the pre-join baseline this session captured. DEFAULTS TO EMPTY, i.e.
   * "this guest joined with an empty vault, so everything present now arrived
   * through the session". That is the configuration in which S116's provenance
   * floor is inert, which is exactly what these rows want: they are about
   * SCOPE, and a row that varies two things at once measures neither. S116's
   * own floor is exercised in `test_s116_*`.
   *
   * `null` stands for "never captured" and makes the reconcile refuse.
   */
  preExisting?: string[] | null;
  /** S116 — whether this guest consented to whole-vault cleanup. */
  allowWholeVaultReconcile?: boolean;
}): Promise<Rig> {
  const guestPaths = options.guestPaths ?? GUEST_VAULT;
  const doc = new Y.Doc();

  const guestSettings: LiveShareSettings = {
    ...DEFAULT_SETTINGS,
    clientId: GUEST_ID,
    githubUserId: "",
    role: "guest",
    sharedFolder: options.guestSharedFolder,
    allowWholeVaultReconcile: options.allowWholeVaultReconcile ?? false,
  };
  const guestVault = vaultDouble(guestPaths);
  const guestManifest = new ManifestManager(guestVault as never, guestSettings as never);
  // The guest connects FIRST, so its freshness baseline is taken before the
  // host speaks — exactly the ordering `joinSession` produces.
  await guestManifest.connect(syncDouble(doc) as never);

  if (options.hostStatesScope === false) {
    // A pre-S115 host. It publishes entries and an attestation; the attestation
    // simply has no `sharedRoot` key, because that build did not know about one.
    doc.transact(() => {
      const files = doc.getMap("files");
      for (const path of HOST_VAULT) {
        files.set(path, { hash: "h", size: 1, mtime: 1 });
      }
      doc.getMap("meta").set("publication", {
        hostId: HOST_ID,
        seq: 99,
        publishedAt: Date.now(),
      });
    });
  } else {
    const hostSettings: LiveShareSettings = {
      ...DEFAULT_SETTINGS,
      clientId: HOST_ID,
      githubUserId: "",
      role: "host",
      sharedFolder: options.hostSharedFolder ?? HOST_ROOT,
    };
    const hostManifest = new ManifestManager(
      vaultDouble(HOST_VAULT) as never,
      hostSettings as never,
    );
    await hostManifest.connect(syncDouble(doc) as never);
    const decision = await hostManifest.publishManifest({ purge: true });
    // Guard: if the host did not actually publish, every row below would be
    // asserting against an empty manifest and would pass for the wrong reason.
    expect(decision.published).toBe(true);
  }

  const trashed: string[] = [];
  const logs: string[] = [];

  // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
  const fake = Object.assign(Object.create((LiveSharePlugin as any).prototype), {
    settings: guestSettings,
    manifestManager: guestManifest,
    remoteUsers: new Map(
      options.liveHost === false ? [] : [[HOST_ID, { userId: HOST_ID, isHost: true }]],
    ),
    app: {
      vault: guestVault,
      fileManager: {
        trashFile: vi.fn(async (file: { path: string }) => {
          trashed.push(file.path);
        }),
      },
    },
    fileOpsManager: {
      mutePathEvents: vi.fn(),
      armMuteRelease: vi.fn(),
    },
    vaultBaseline:
      options.preExisting === null ? null : new Set(options.preExisting ?? []),
    logger: {
      log: (category: string, message: string) => logs.push(`${category}: ${message}`),
      debug: () => {},
      warn: () => {},
      error: () => {},
    },
  });

  return {
    run: () =>
      (
        LiveSharePlugin as never as {
          prototype: { cleanupStaleFiles(): Promise<StaleReconcileDecision> };
        }
      ).prototype.cleanupStaleFiles.call(fake),
    trashed,
    logs,
    guestManifest,
  };
}

describe("S115 — the stale reconcile is scoped by the HOST's shared root", () => {
  it("AC4 — inside the host's tree it still trashes; outside it, it does not", async () => {
    // The guest ships the default: EMPTY, i.e. "my whole vault is shared". That
    // is the value that made every private note a trash candidate.
    const r = await rig({ guestSharedFolder: "" });
    const decision = await r.run();

    expect(decision.ran).toBe(true);
    // THE POSITIVE HALF — a genuinely stale file inside the host's tree is gone.
    // Named, not counted: a bare `toHaveLength(1)` would pass if the wrong file
    // were destroyed.
    expect(r.trashed).toEqual([`${HOST_ROOT}/deleted upstream.md`]);
    // THE NEGATIVE HALF — same pass, same vault, same call.
    expect(r.trashed).not.toContain("Journal/2026-08-07.md");
    expect(r.trashed).not.toContain("Taxes/2025 return.md");
    expect(r.trashed).not.toContain("Thesis/chapter 3.md");
    expect(r.trashed).not.toContain("attachments/passport.png");
    // …and the file the host still has survives too.
    expect(r.trashed).not.toContain(`${HOST_ROOT}/shared note.md`);
    expect(decision.candidates).toBe(1);

    // VACUITY GUARD. Under the old rule every one of those four private notes
    // was in the candidate set, because the local predicate said so. If this
    // assertion ever goes false the row above stops being evidence: the notes
    // would be surviving for some reason other than the host's scope.
    for (const path of ["Journal/2026-08-07.md", "Taxes/2025 return.md"]) {
      expect(r.guestManifest.isSharedPath(path)).toBe(true);
    }
  });

  it("AC2 — the guest's own sharedFolder does not move the candidate set", async () => {
    // Three guest settings that each select something DIFFERENT under the old
    // rule: everything, an unrelated private folder, and a folder that does not
    // exist. All three must produce the same answer, because none of them is
    // the question being asked.
    for (const guestSharedFolder of ["", "Journal", "nowhere-at-all"]) {
      const r = await rig({ guestSharedFolder });
      const decision = await r.run();
      expect(decision.ran).toBe(true);
      expect(decision.scope).toBe(HOST_ROOT);
      expect(r.trashed).toEqual([`${HOST_ROOT}/deleted upstream.md`]);
    }
  });

  it("AC2 — a guest scoped to Journal does NOT trash Journal", async () => {
    // The sharpest form of the same statement. Under the defect this exact
    // configuration trashed `Journal/2026-08-07.md`, because the guest's own
    // folder was the scope and the host's manifest never mentioned it. The
    // companion file pins that as the old behaviour of `isSharedPath`.
    const r = await rig({ guestSharedFolder: "Journal" });
    await r.run();
    expect(r.trashed).not.toContain("Journal/2026-08-07.md");
  });

  it("AC3 — an older host that states no scope destroys NOTHING", async () => {
    const r = await rig({ guestSharedFolder: "", hostStatesScope: false });
    const decision = await r.run();

    expect(decision.ran).toBe(false);
    expect(decision.scope).toBeNull();
    // I11 — the refusal is the whole point: zero calls, not "zero files matched".
    expect(r.trashed).toEqual([]);
    expect(decision.candidates).toBe(0);
    // The reason names the missing evidence, so an operator can tell this apart
    // from the four older floors.
    expect(decision.reason).toContain("shared folder is unknown");
    expect(decision.reason).toContain(HOST_ID);

    // The peer is otherwise fully licensed to delete — this is NOT passing
    // because some earlier floor closed. Everything the old rule required is
    // satisfied here.
    expect(r.guestManifest.hasFreshPublication(GUEST_ID)).toBe(true);
    expect(r.guestManifest.getEntries().size).toBeGreaterThan(0);
  });

  it("AC3 — the scope floor sits BELOW the older floors, which still speak first", async () => {
    // A missing live host must still be reported as a missing live host. If the
    // new floor had been inserted above them, every pre-existing refusal reason
    // would have been replaced by this one and the D2 fixture's diagnostics
    // would silently degrade.
    const r = await rig({ guestSharedFolder: "", liveHost: false });
    const decision = await r.run();
    expect(decision.ran).toBe(false);
    expect(decision.reason).toContain("no peer in this session claims to be host");
    expect(r.trashed).toEqual([]);
  });

  it("AC2/AC4 — a host that shares its WHOLE vault scopes the guest to the whole vault", async () => {
    // The other end of the range. `""` from the host is a STATED scope, not an
    // unknown one, and it means what it has always meant. This row is what
    // stops the fix from being "disable the feature": the reconcile still runs,
    // and it still removes what the host does not have.
    // S116 — this arrangement now additionally requires the guest's consent;
    // without it the reconcile refuses (see `test_s116_*`). Granted here so the
    // row keeps measuring what it was written to measure: the SCOPE.
    const r = await rig({
      guestSharedFolder: "Journal",
      hostSharedFolder: "",
      allowWholeVaultReconcile: true,
    });
    const decision = await r.run();
    expect(decision.ran).toBe(true);
    expect(decision.scope).toBe("");
    expect(r.trashed).toContain("Journal/2026-08-07.md");
    expect(r.trashed).toContain(`${HOST_ROOT}/deleted upstream.md`);
    expect(r.trashed).not.toContain(`${HOST_ROOT}/shared note.md`);
  });

  it("AC5 — the scope and the candidate count are logged on every run", async () => {
    const r = await rig({ guestSharedFolder: "" });
    const decision = await r.run();
    const line = r.logs.find((entry) => entry.includes("stale reconcile ran"));
    expect(line).toBeDefined();
    expect(line).toContain(`scope=${HOST_ROOT}`);
    expect(line).toContain("candidates=1");
    // The field, not only the prose — a validator must not have to parse a
    // sentence to learn which range a destructive pass used.
    expect(decision.scope).toBe(HOST_ROOT);
    expect(decision.reason).toContain(HOST_ROOT);
  });

  it("AC5 — the refusal reason is observable too, and names the scope as the gap", async () => {
    const r = await rig({ guestSharedFolder: "", hostStatesScope: false });
    await r.run();
    const line = r.logs.find((entry) => entry.includes("stale reconcile refused"));
    expect(line).toBeDefined();
    expect(line).toContain("shared folder is unknown");
  });

  it("AC5 — a run that trashes nothing still logs, so silence is not an outcome", async () => {
    // Under the old code the success log fired only when something was
    // destroyed, so "I ran and selected nothing" and "I never ran" were the
    // same observation in the log: none.
    //
    // Reached with a guest whose copy of the host's tree is already correct —
    // NOT with an empty host manifest, which is refused one floor higher by
    // D3's paranoid empty-manifest check and would test that instead.
    const r = await rig({
      guestSharedFolder: "",
      guestPaths: ["Journal/2026-08-07.md", `${HOST_ROOT}/shared note.md`],
    });
    const decision = await r.run();
    expect(decision.ran).toBe(true);
    expect(r.trashed).toEqual([]);
    expect(r.logs.some((entry) => entry.includes("stale reconcile ran"))).toBe(true);
    expect(r.logs.some((entry) => entry.includes("candidates=0"))).toBe(true);
  });
});

describe("S115 — the host states its scope, and the guest reads it off the attestation", () => {
  it("the real publishManifest writes the host's trimmed sharedFolder", async () => {
    const doc = new Y.Doc();
    const settings: LiveShareSettings = {
      ...DEFAULT_SETTINGS,
      clientId: HOST_ID,
      githubUserId: "",
      role: "host",
      // S114's value: truthy whitespace. It must not cross the wire as a scope
      // that matches nothing.
      sharedFolder: "  shared  ",
    };
    const host = new ManifestManager(vaultDouble([]) as never, settings as never);
    await host.connect(syncDouble(doc) as never);
    await host.publishManifest({ purge: true });
    expect(host.getPublication()?.sharedRoot).toBe("shared");
  });

  it("an attestation without sharedRoot is still FRESH but its scope is unknown", async () => {
    // The two questions must not be conflated. An older host is present and
    // alive — freshness has to keep answering `true`, or the peer would look
    // absent and every other behaviour keyed on it would change. Only the
    // scope is unknown.
    const doc = new Y.Doc();
    const guest = new ManifestManager(
      vaultDouble([]) as never,
      { ...DEFAULT_SETTINGS, clientId: GUEST_ID, githubUserId: "", role: "guest" } as never,
    );
    await guest.connect(syncDouble(doc) as never);
    doc.getMap("meta").set("publication", { hostId: HOST_ID, seq: 5, publishedAt: 1 });

    expect(guest.hasFreshPublication(GUEST_ID)).toBe(true);
    const scope = guest.getHostSharedScope();
    expect(scope.known).toBe(false);
    expect(scope.root).toBeNull();
  });

  it("a room nobody published in has no scope either", async () => {
    const doc = new Y.Doc();
    const guest = new ManifestManager(
      vaultDouble([]) as never,
      { ...DEFAULT_SETTINGS, clientId: GUEST_ID, githubUserId: "", role: "guest" } as never,
    );
    await guest.connect(syncDouble(doc) as never);
    const scope = guest.getHostSharedScope();
    expect(scope.known).toBe(false);
    // Narrowed by a throw rather than a cast: if `known` were ever `true` here
    // the row must FAIL, not quietly read `undefined` off the other arm.
    if (scope.known) throw new Error("expected an unknown scope, got a known one");
    expect(scope.reason).toContain("no host has published");
  });

  it("isWithinSharedRoot keeps the LOCAL safety floors under a remote root", async () => {
    // A remote peer must not be able to talk this peer into touching the config
    // tree by naming it as its shared folder. The root is remote; the floors
    // are local, and they are not negotiable.
    const guest = new ManifestManager(
      vaultDouble([]) as never,
      { ...DEFAULT_SETTINGS, clientId: GUEST_ID, githubUserId: "", role: "guest" } as never,
    );
    expect(guest.isWithinSharedRoot(".obsidian/plugins/live-share/main.js", "")).toBe(false);
    expect(guest.isWithinSharedRoot(".git/config", "")).toBe(false);
    expect(guest.isWithinSharedRoot(".obsidian/x.md", ".obsidian")).toBe(false);
    // …while an ordinary note under the same root is admitted, so the row above
    // is not passing because the predicate refuses everything.
    expect(guest.isWithinSharedRoot("notes/a.md", "")).toBe(true);
    expect(guest.isWithinSharedRoot("notes/a.md", "notes")).toBe(true);
    expect(guest.isWithinSharedRoot("other/a.md", "notes")).toBe(false);
  });
});
