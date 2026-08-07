// WP95 TP02 — AC1 (every arm), AC3 (the local writer is unaffected) and AC4
// (refusal never destroys).
//
// THE POINT OF THIS FILE IS THAT THE FILE-OP CHANNEL IS NOT THE ONLY ARM. TP01
// drives the nine members of the `FileOp` union through the inbound gate; this
// one drives the arms that never reach that gate at all:
//
//   ├── the MANIFEST-DRIVEN arm (`syncFromManifest`) — its paths are the keys of
//   │   a peer-published `Y.Map`, and it does not consult `isSharedPath`, so the
//   │   `ExclusionManager` pattern that keeps the create arm out of `.obsidian/**`
//   │   never applies to it;
//   ├── the SCOPE predicate (`isSharedPath`) — which every other gate leans on;
//   ├── the MANIFEST-CHANGE RENAME verdict (`decideManifestRename`) — a pure core,
//   │   and the chokepoint the `main.ts` rename arm already routes through; and
//   └── the DOC-DRIVEN writer, reached through `syncFromManifest`'s injected
//       `requestBinary` / `mute` / `unmute` callbacks. `S89` is the warning: a
//       capability passed as a parameter has no call site to grep, so it is
//       followed by TYPE and driven at RUNTIME here rather than searched for.
//
// AC3 IS ONE TEST, NOT TWO, deliberately. "A peer op refused" and "the local
// sidecar write succeeds" are asserted over the SAME vault in the SAME run,
// because a repair that bought the first by breaking the second would otherwise
// pass two green tests.
//
// AC4's oracle is SHA-256 OF BYTES, never an absence of an error and never the
// content itself. In a real vault the file this suite targets holds credentials;
// the digest is the only thing this suite ever looks at, and the fixture bytes
// are synthetic.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../ui/modals", () => ({
  ConfirmModal: class {
    open() {}
  },
  UserPickerModal: class {
    open() {}
  },
}));
vi.mock("../../../ui/approval-modal", () => ({
  ApprovalModal: class {
    open() {}
  },
}));
vi.mock("../../../ui/focus-notification", () => ({
  showFocusNotification: () => {},
}));

import { RENAME_DECISION, decideManifestRename } from "../../../files/manifest-removal-decision";
import { ManifestManager } from "../../../files/manifest";
import { SIDECAR_DIR, sidecarIndexPath } from "../../../files/canvas-sidecar";
import type { LiveShareSettings } from "../../../types";

const { registerControlHandlers } = await import("../../../sync/control-handlers");

const {
  GIT_HOOK,
  PLACEHOLDER_BYTES,
  PLUGIN_CODE,
  PLUGIN_DATA,
  SHARED_NOTE,
  createInboundRig,
  createRecordingVault,
  digestAt,
} = await import("./harness");

/** A `ManifestManager` over a recording vault, with no `ExclusionManager` set —
 * the configuration `manifest.ts`'s own comment names as one of the three that
 * break the `${configDir}/**` coincidence. Nothing but the WP95 predicate can
 * refuse here. */
function manifestOver(sharedFolder = ""): ManifestManager {
  const vault = createRecordingVault({});
  const settings = { sharedFolder } as unknown as LiveShareSettings;
  return new ManifestManager(vault as never, settings);
}

describe("WP95 AC1 — the arms that never reach the file-op gate", () => {
  it("SCOPE — `isSharedPath` refuses a protected path with NO ExclusionManager installed", () => {
    const manifest = manifestOver();
    // The premise, measured rather than recalled: with no `ExclusionManager` and
    // no `sharedFolder`, `isSharedPath` returns TRUE for everything it is not
    // told otherwise about. That is what made `.git/**` reachable in the DEFAULT
    // configuration — no pattern anywhere in this tree ever excluded it.
    expect(manifest.isSharedPath(SHARED_NOTE)).toBe(true);
    expect(manifest.isSharedPath("notes/deep/a.md")).toBe(true);
    // And the repair.
    expect(manifest.isSharedPath(PLUGIN_CODE)).toBe(false);
    expect(manifest.isSharedPath(PLUGIN_DATA)).toBe(false);
    expect(manifest.isSharedPath(GIT_HOOK)).toBe(false);
    // WP68's answer is unchanged — the repair widened, it did not replace.
    expect(manifest.isSharedPath(sidecarIndexPath())).toBe(false);
  });

  it("MANIFEST RENAME — the pure core refuses a protected DESTINATION, and says why", () => {
    // The knowledge that would otherwise produce a `RENAME` verdict: a genuine
    // content pair, a real local file, nothing at the destination. The attacker
    // supplies the hash, so `hasContentPair` is no defence — which is exactly
    // why the protected test has to come FIRST.
    const admitted = decideManifestRename({
      oldPath: SHARED_NOTE,
      newPath: "notes/renamed.md",
      hasContentPair: true,
      oldKind: "file",
      newExists: false,
    });
    expect(admitted.verdict).toBe(RENAME_DECISION.RENAME);

    const refused = decideManifestRename({
      oldPath: SHARED_NOTE,
      newPath: PLUGIN_CODE,
      hasContentPair: true,
      oldKind: "file",
      newExists: false,
    });
    expect(refused.verdict).toBe(RENAME_DECISION.REFUSED);
    expect(refused.reason).toContain(".obsidian/**");
    // The reason names the ROOT, which is a class, and never the path.
    expect(refused.reason).not.toContain("main.js");
  });

  it("MANIFEST SYNC — a peer-published protected KEY materialises nothing", async () => {
    // The manifest-driven arm, driven through the real method. Its entries are
    // peer-published `Y.Map` keys and it consults neither `isSharedPath` nor
    // `ExclusionManager`, so before WP95 the only things between these keys and
    // `vault.create` were `isPathSafe` and `isSidecarPath`.
    const vault = createRecordingVault({});
    const manifest = new ManifestManager(vault as never, {
      sharedFolder: "",
    } as unknown as LiveShareSettings);

    // A hand-built stand-in for the connected manifest state: the method reads
    // `this.manifest.entries()` and `this.syncManager`, and nothing else about
    // them matters for the refusal, which happens at the top of the loop.
    const entries = new Map([
      [PLUGIN_CODE, { hash: "h1", size: 1, mtime: 0 }],
      [GIT_HOOK, { hash: "h2", size: 1, mtime: 0 }],
      [`${GIT_HOOK}-dir`, { hash: "", size: 0, mtime: 0, directory: true }],
      [SHARED_NOTE, { hash: "h3", size: 1, mtime: 0 }],
    ]);
    const getDoc = vi.fn(() => null);
    (manifest as unknown as Record<string, unknown>).manifest = entries;
    (manifest as unknown as Record<string, unknown>).syncManager = {
      getDoc,
      waitForSync: vi.fn(async () => {}),
      releaseDoc: vi.fn(),
    };

    const requestBinary = vi.fn();
    await manifest.syncFromManifest(vi.fn(), vi.fn(), requestBinary);

    // Nothing was created, modified or folder-created for any protected key.
    expect(vault.journal).toEqual([]);
    // And the CALLBACK arm — `requestBinary?.(path)`, a capability passed as a
    // parameter with no call site to grep (S89) — was never invoked for one
    // either. This is the arm that would otherwise ask the host to send the
    // bytes of the plugin's own code back over the file-op channel.
    expect(requestBinary).not.toHaveBeenCalled();
    // POSITIVE CONTROL, same run: the ordinary key DID reach the doc lookup, so
    // the loop was not simply skipping everything.
    expect(getDoc).toHaveBeenCalledWith(SHARED_NOTE);
  });
});

describe("WP95 AC3 + AC4 — refused inbound, byte-identical, local writer alive", () => {
  it("the peer op is refused, the target's BYTES are unchanged, and the sidecar still writes", async () => {
    const rig = createInboundRig(registerControlHandlers, {
      [PLUGIN_DATA]: PLACEHOLDER_BYTES,
      [PLUGIN_CODE]: PLACEHOLDER_BYTES,
    });

    const dataBefore = digestAt(rig.vault, PLUGIN_DATA);
    const codeBefore = digestAt(rig.vault, PLUGIN_CODE);
    expect(dataBefore).not.toBeNull();

    // Four peer ops at the two files S94 names, including the one B56
    // demonstrated live (a rename whose destination is inside the plugin dir).
    await rig.deliver({ type: "modify", path: PLUGIN_DATA, content: "overwritten" });
    await rig.deliver({ type: "create", path: PLUGIN_CODE, content: "payload()" });
    await rig.deliver({ type: "delete", path: PLUGIN_DATA });
    await rig.deliver({ type: "rename", oldPath: PLUGIN_DATA, newPath: PLUGIN_CODE });

    // AC4 — BYTES, not the absence of an error. A refusal that trashed the file
    // "safely" would pass an error-shaped assertion and fail this one.
    expect(digestAt(rig.vault, PLUGIN_DATA)).toBe(dataBefore);
    expect(digestAt(rig.vault, PLUGIN_CODE)).toBe(codeBefore);
    expect(rig.vault.journal).toEqual([]);
    expect(rig.admitted).toEqual([]);

    // AC3, THE OTHER HALF, IN THE SAME RUN AND OVER THE SAME VAULT. The plugin's
    // own sidecar writer does not go through any WP95 guard — it reaches its
    // adapter directly — so a local write under `.obsidian/liveshare/state/**`
    // must still land. If the repair had been implemented by widening a shared
    // predicate the local writer also asks, this line reddens.
    const sidecarFile = sidecarIndexPath();
    expect(sidecarFile.startsWith(`${SIDECAR_DIR}/`)).toBe(true);
    await (rig.vault.create as unknown as (p: string, c: string) => Promise<unknown>)(
      sidecarFile,
      "{}",
    );
    expect(rig.vault.bytes.has(sidecarFile)).toBe(true);
    expect(rig.vault.journal).toEqual([`create ${sidecarFile}`]);
  });

  it("APPLY-REMOTE-OP refuses on its own, with the channel gate out of the picture", async () => {
    // `applyRemoteOp` is PUBLIC. The channel gate constrains the callers that go
    // through the channel and says nothing about the others — which is the exact
    // argument WP68's own comment made about the sender-side guard and then did
    // not apply to itself. This case calls the manager DIRECTLY, so the
    // `control-handlers.ts` refusal cannot account for the green: delete the
    // guard inside `applyRemoteOpInner` and this reddens while every other case
    // in this suite stays green.
    const rig = createInboundRig(registerControlHandlers, { [PLUGIN_DATA]: PLACEHOLDER_BYTES });
    const before = digestAt(rig.vault, PLUGIN_DATA);

    await rig.manager.applyRemoteOp({ type: "modify", path: PLUGIN_DATA, content: "payload" });
    await rig.manager.applyRemoteOp({ type: "delete", path: PLUGIN_DATA });

    expect(digestAt(rig.vault, PLUGIN_DATA)).toBe(before);
    expect(rig.vault.journal).toEqual([]);
    // No mute was taken either, so nothing can be stranded — the refusal is
    // above `mutePathEvents`, not merely above the vault call.
    expect(rig.manager.isPathMuted(PLUGIN_DATA)).toBe(false);

    // POSITIVE CONTROL on the same manager: an ordinary path still applies.
    await rig.manager.applyRemoteOp({ type: "create", path: "notes/x.md", content: "hi" });
    expect(rig.vault.journal).not.toEqual([]);
  });

  it("POSITIVE CONTROL — an ordinary file's bytes DO change through the same rig", async () => {
    // The digest oracle must be able to notice a change, or every assertion
    // above is an assertion about a broken instrument.
    const rig = createInboundRig(registerControlHandlers, { [SHARED_NOTE]: "before" });
    const before = digestAt(rig.vault, SHARED_NOTE);
    await rig.deliver({ type: "modify", path: SHARED_NOTE, content: "after" });
    expect(digestAt(rig.vault, SHARED_NOTE)).not.toBe(before);
  });
});
