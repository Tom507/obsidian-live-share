"""Shared constants for the real-Obsidian E2E rig — the single owning module (WP43).

Authority: ``workflowArtifacts/canvas-v2/T3_SharedContract.md``. Every value below is
transcribed **verbatim** from that contract. WP44–WP49 import from here; no other module
may re-declare any of these values or invent a variant name. If a value here looks wrong,
the fix is to amend the contract and this file together — never to shadow it locally.

Section markers in the comments (``§2``, ``§3``, …) refer to sections of the contract.

This module is pure data plus three tiny pure helpers. It performs no I/O of any kind
beyond reading ``%APPDATA%`` from the environment, and it never writes anything.
"""

from __future__ import annotations

import itertools
import os
import secrets
import threading
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# §1 — Verified environment facts (given; do not re-derive, do not probe for
#      alternatives). These describe the owner's machine.
# ---------------------------------------------------------------------------

OBSIDIAN_EXE_PATH = r"C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe"
OBSIDIAN_EXE_NAME = "Obsidian.exe"

#: Vault registry — ``%APPDATA%\obsidian\obsidian.json``. Shared global state:
#: **read-only, never rewritten**, not even to reformat (invariant S3, STANDING).
VAULT_REGISTRY_REL = os.path.join("obsidian", "obsidian.json")
VAULT_REGISTRY_PATH = os.path.join(
    os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming"),
    VAULT_REGISTRY_REL,
)

#: The owner's two live working vaults. Note the space in vault B — it is load-bearing.
REAL_VAULT_PATH_A = r"H:\Developement\_NeuralAngels\ObsidianOrga"
REAL_VAULT_PATH_B = r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"

# ---------------------------------------------------------------------------
# §2 — Roles and identifiers
# ---------------------------------------------------------------------------

ROLE_A = "a"
ROLE_B = "b"
ROLES = (ROLE_A, ROLE_B)  # ordered; index 0 is always the host role

#: Vault path per role — configuration, not a discovery result (WP43 §2 non-goal).
REAL_VAULT_PATHS = {ROLE_A: REAL_VAULT_PATH_A, ROLE_B: REAL_VAULT_PATH_B}

#: Client ids reused verbatim from the existing headless rig (``two-host-harness.ts``).
CLIENT_ID_A = "e2e-a"
CLIENT_ID_B = "e2e-b"
CLIENT_IDS = {ROLE_A: CLIENT_ID_A, ROLE_B: CLIENT_ID_B}

#: Canvas doc-id scheme, verbatim from ``two-host-harness.ts:34``: ``__canvas__:${path}``.
CANVAS_DOC_ID_PREFIX = "__canvas__:"


def canvas_doc_id(path: str) -> str:
    """Return the shared-doc id for a canvas path (``__canvas__:<path>``)."""
    return f"{CANVAS_DOC_ID_PREFIX}{path}"


# ---------------------------------------------------------------------------
# §3 — Ports. The real rig uses a pair disjoint from the headless rig's (D13) so a
#      stale headless process can never satisfy a real-rig readiness check.
# ---------------------------------------------------------------------------

HEADLESS_RIG_PORT_A = 39421  # existing, launch_liveshare_e2e.py — unchanged, do not touch
HEADLESS_RIG_PORT_B = 39422  # existing, launch_liveshare_e2e.py — unchanged, do not touch

REAL_CONTROL_PORT_A = 39431
REAL_CONTROL_PORT_B = 39432
REAL_CONTROL_PORTS = {ROLE_A: REAL_CONTROL_PORT_A, ROLE_B: REAL_CONTROL_PORT_B}

# ---------------------------------------------------------------------------
# §4 — Plugin settings surface (WP44)
# ---------------------------------------------------------------------------

SETTINGS_PORT_KEY = "e2eControlPort"  # EXISTING hidden loose setting, read by resolvePort()
PLUGIN_ID = "live-share"  # NOT "obsidian-live-share" — that is the repo folder name
PLUGIN_DIR_REL = ".obsidian/plugins/live-share"
PLUGIN_DATA_REL = ".obsidian/plugins/live-share/data.json"
COMMUNITY_PLUGINS_REL = ".obsidian/community-plugins.json"

#: The built plugin bundle. Presence of this file is what "plugin installed" means.
PLUGIN_MAIN_REL = ".obsidian/plugins/live-share/main.js"

# Byte-exact backup + provisioning marker — both live INSIDE the plugin dir (S4).
SETTINGS_BACKUP_REL = ".obsidian/plugins/live-share/data.json.e2e-original"
PROVISION_MARKER_REL = ".obsidian/plugins/live-share/.e2e-provision.json"

#: Keys of the marker file, so a crashed run is recoverable. It records a sha256 of the
#: original bytes and **never** the original content itself (S4, STANDING).
PROVISION_MARKER_FIELDS = (
    "runId",
    "role",
    "port",
    "hadOriginal",
    "originalSha256",
    "pid",
    "createdAt",
)

#: §1.1 — the installed build is a *production* build: ``__LS_E2E__`` is false, so
#: ``./testing/e2e-control`` is tree-shaken out and there is no control server, whatever
#: port is provisioned. Absence of all of these markers in ``main.js`` means the plugin is
#: present, possibly enabled, and still structurally incapable of hosting a control
#: endpoint → :data:`PLUGIN_NOT_E2E_CAPABLE`, never "port not provisioned".
E2E_BUILD_MARKERS = ("e2eControlPort", "LIVESHARE_E2E", "e2e-control")

# ---------------------------------------------------------------------------
# §4.1 — WP69: E2E build mode and bundle install namespace
#
# Owned by WP69 (SharedOwnershipContract_B9b_Gate.md §1). Appended, never inserted into
# another block; WP70 may not modify, move, rename or re-order one line of it.
#
# Why these exist: `npm run build` folds ``__LS_E2E__`` to ``"false"`` and the whole
# ``src/testing/`` tree is eliminated, so the shipped bundle can never host a control
# server; the only instrumented build was ``npm run dev``, which calls ``ctx.watch()`` and
# **never returns**. :data:`E2E_BUILD_ARGV` selects a third mode that builds once and
# exits, reachable through exactly one npm script, :data:`E2E_BUILD_SCRIPT`.
# ---------------------------------------------------------------------------

E2E_BUILD_ARGV = "e2e"  # process.argv[2] token consumed by plugin/esbuild.config.mjs
E2E_BUILD_SCRIPT = "build:e2e"  # the one added plugin/package.json script name

#: The rig's **own** restore point for the plugin bundle, inside the plugin dir (S4). It is
#: deliberately disjoint from the owner's pre-existing ``main.js.bak`` /
#: ``main.js.0.5.9.bak`` / ``manifest.json.bak`` / ``styles.css.bak``, none of which is ever
#: written, moved, renamed, deleted or used as a restore point.
BUNDLE_BACKUP_REL = ".obsidian/plugins/live-share/main.js.e2e-original"
INSTALL_MARKER_REL = ".obsidian/plugins/live-share/.e2e-install.json"

#: Keys of the install marker, so a crashed run is recoverable. Like the WP44 provisioning
#: marker it records sha256 fingerprints and structure only — never file content (S4).
INSTALL_MARKER_FIELDS = (
    "runId",
    "role",
    "hadOriginal",
    "originalSha256",
    "originalSize",
    "installedSha256",
    "pid",
    "createdAt",
)

E2E_BUILD_FAILED = "E2E_BUILD_FAILED"  # WP69 AC1/AC3 — non-zero exit; never a bundle
BUNDLE_NOT_E2E_CAPABLE = "BUNDLE_NOT_E2E_CAPABLE"  # WP69 AC3 — a marker is missing
BUNDLE_RESTORE_MISMATCH = "BUNDLE_RESTORE_MISMATCH"  # WP69 AC4 — non-byte-exact restore
INSTALL_CONFLICT = "INSTALL_CONFLICT"  # WP69 AC4 — irreconcilable leftover install state

# ---------------------------------------------------------------------------
# §5 — Scratch artefacts (WP47)
# ---------------------------------------------------------------------------

SCRATCH_FOLDER = "_e2e-rig"  # vault-relative, rig-owned, created and removed per run
SCRATCH_PREFIX = "e2e-scratch-"
SCRATCH_EXT = ".canvas"

#: Fingerprint (WP47 AC3) walks the vault excluding these; per file it records
#: ``(relative_posix_path, size, sha256_of_bytes)`` — hash only, never content (S4).
FINGERPRINT_EXCLUDED = (SCRATCH_FOLDER, PLUGIN_DIR_REL, ".git", ".trash")


#: Width of the run-id tail, in hexadecimal digits, and the number of distinct values it
#: can carry. The shape ``<stamp>-<pid>-<6 hex>`` is pinned by the contract; what the six
#: digits *carry* is this module's choice.
RUN_ID_TAIL_HEX_DIGITS = 6
RUN_ID_TAIL_SPAN = 1 << (4 * RUN_ID_TAIL_HEX_DIGITS)

#: The tail is a **per-process counter**, not a per-call random draw, started at a random
#: offset. Randomness alone makes uniqueness probabilistic: 6 hex digits are 16.7 million
#: values, so by the birthday bound a few thousand ids in one process already collide with
#: near-certainty — which is exactly what a burst of runs, or a test that generates one,
#: does. A counter cannot repeat within a process at all until it has produced
#: :data:`RUN_ID_TAIL_SPAN` ids, and the random start keeps two *different* processes that
#: happen to share a pid (a recycled pid, a container) from marching in lockstep. The lock
#: makes "cannot repeat" hold across threads, not merely across a single-threaded loop.
_RUN_ID_LOCK = threading.Lock()
_RUN_ID_TAIL = itertools.count(secrets.randbits(4 * RUN_ID_TAIL_HEX_DIGITS))


def _next_run_id_tail() -> str:
    """Return the next never-before-used tail for this process, as lowercase hex."""
    with _RUN_ID_LOCK:
        ordinal = next(_RUN_ID_TAIL)
    return f"{ordinal % RUN_ID_TAIL_SPAN:0{RUN_ID_TAIL_HEX_DIGITS}x}"


def new_run_id() -> str:
    """Return a fresh run identity: ``<utc timestamp>-<pid>-<6 hex>``.

    Uniqueness is carried by three independent components and does **not** depend on the
    clock: the pid separates concurrent processes, the tail separates every id produced
    inside one process (see :data:`_RUN_ID_TAIL` — a counter, so two ids generated in the
    same second, the same millisecond or the same loop iteration still differ), and the
    timestamp is there for human correlation rather than for identity.

    One generator for the whole batch: scratch name, marker file and log correlation all
    use this and nothing else.
    """
    return f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{os.getpid()}-{_next_run_id_tail()}"


def scratch_rel_path(run_id: str) -> str:
    """Vault-relative path of the scratch canvas for ``run_id`` (§5)."""
    return f"{SCRATCH_FOLDER}/{SCRATCH_PREFIX}{run_id}{SCRATCH_EXT}"


# ---------------------------------------------------------------------------
# §6 — Control protocol. ``node:http`` on 127.0.0.1; POST /command -> {cmd, args},
#      GET /events -> SSE. Existing command names are reused verbatim, never renamed.
# ---------------------------------------------------------------------------

CONTROL_HOST = "127.0.0.1"
CONTROL_COMMAND_PATH = "/command"
CONTROL_EVENTS_PATH = "/events"

CMD_SESSION_INFO = "session.info"
CMD_CANVAS_OPEN = "canvas.open"
CMD_CANVAS_STATE = "canvas.state"
CMD_CANVAS_BINDING = "canvas.binding"
CMD_CANVAS_SIMULATE_EDIT = "canvas.simulateEdit"
CMD_CANVAS_SET_FLAG = "canvas.setFlag"
CMD_SYNC_WAIT_QUIESCENT = "sync.waitQuiescent"

SYNC_WAIT_QUIESCENT_DEFAULT_TIMEOUT_MS = 2000

# §6.1 — commands ADDED in this batch (exact names, pinned)
CMD_SCRATCH_CREATE = "scratch.create"  # WP47
CMD_SCRATCH_REMOVE = "scratch.remove"  # WP47
CMD_CANVAS_FILE = "canvas.file"  # WP49 — read-back only; never writes or touches mtime

# ---------------------------------------------------------------------------
# §6.2 — ``session.info`` fields. The first four keep their existing names and
#        semantics; the last five are added by WP46.
# ---------------------------------------------------------------------------

SESSION_INFO_CLIENT_ID = "clientId"
SESSION_INFO_ROLE = "role"
SESSION_INFO_ROOM_ID = "roomId"
SESSION_INFO_CONNECTED = "connected"

SESSION_INFO_VAULT_ID = "vaultId"
SESSION_INFO_VAULT_NAME = "vaultName"
SESSION_INFO_VAULT_PATH = "vaultPath"
SESSION_INFO_PLUGIN_BUILD = "pluginBuild"
SESSION_INFO_CANVAS_SURFACE = "canvasSurface"

SESSION_INFO_FIELDS = (
    SESSION_INFO_CLIENT_ID,
    SESSION_INFO_ROLE,
    SESSION_INFO_ROOM_ID,
    SESSION_INFO_CONNECTED,
    SESSION_INFO_VAULT_ID,
    SESSION_INFO_VAULT_NAME,
    SESSION_INFO_VAULT_PATH,
    SESSION_INFO_PLUGIN_BUILD,
    SESSION_INFO_CANVAS_SURFACE,
)

# ---------------------------------------------------------------------------
# §7 — Named failure reasons. One enum, all WPs use it. Every abort names exactly one
#      of these; no WP invents an ad-hoc reason string and no abort is reported as a
#      bare exception.
# ---------------------------------------------------------------------------

VAULT_NOT_IN_REGISTRY = "VAULT_NOT_IN_REGISTRY"  # WP43 AC1
VAULT_PATH_MISSING = "VAULT_PATH_MISSING"  # WP43 AC1
PLUGIN_MISSING = "PLUGIN_MISSING"  # WP43 AC2
PLUGIN_PRESENT_BUT_DISABLED = "PLUGIN_PRESENT_BUT_DISABLED"  # WP43 AC2 — distinct state
PLUGIN_NOT_E2E_CAPABLE = "PLUGIN_NOT_E2E_CAPABLE"  # §1.1 — production build, no control server
SETTINGS_RESTORE_MISMATCH = "SETTINGS_RESTORE_MISMATCH"  # WP44 AC2 — non-byte-exact restore
PROVISION_CONFLICT = "PROVISION_CONFLICT"  # WP44 AC3
LAUNCH_EXECUTABLE_MISSING = "LAUNCH_EXECUTABLE_MISSING"  # WP45 AC3
RESTART_REQUIRED_OPERATOR = "RESTART_REQUIRED_OPERATOR"  # WP45 AC2 — stop and instruct
READINESS_TIMEOUT = "READINESS_TIMEOUT"  # WP46 AC2/AC3
IDENTITY_SAME_VAULT = "IDENTITY_SAME_VAULT"  # WP46 AC2 — both endpoints, same vault
IDENTITY_UNKNOWN_VAULT = "IDENTITY_UNKNOWN_VAULT"  # WP46 AC3 — not one of the two configured
ROOM_MISMATCH = "ROOM_MISMATCH"  # WP46 AC2
ENDPOINT_LOST_MIDRUN = "ENDPOINT_LOST_MIDRUN"  # WP48 AC3
FINGERPRINT_MISMATCH = "FINGERPRINT_MISMATCH"  # WP47 AC3 — vault changed; fails the run
SCRATCH_STALE_UNRECLAIMED = "SCRATCH_STALE_UNRECLAIMED"  # WP47 AC4 / WP48 AC4
DOC_CONVERGED_FILE_DIVERGED = "DOC_CONVERGED_FILE_DIVERGED"  # WP49 AC2 — the D17 defect class
WAIT_TIMEOUT = "WAIT_TIMEOUT"  # WP48 AC2 — always names the awaited condition

#: Every named failure reason, for validation ("is this a sanctioned reason?").
FAILURE_REASONS = (
    VAULT_NOT_IN_REGISTRY,
    VAULT_PATH_MISSING,
    PLUGIN_MISSING,
    PLUGIN_PRESENT_BUT_DISABLED,
    PLUGIN_NOT_E2E_CAPABLE,
    SETTINGS_RESTORE_MISMATCH,
    PROVISION_CONFLICT,
    LAUNCH_EXECUTABLE_MISSING,
    RESTART_REQUIRED_OPERATOR,
    READINESS_TIMEOUT,
    IDENTITY_SAME_VAULT,
    IDENTITY_UNKNOWN_VAULT,
    ROOM_MISMATCH,
    ENDPOINT_LOST_MIDRUN,
    FINGERPRINT_MISMATCH,
    SCRATCH_STALE_UNRECLAIMED,
    DOC_CONVERGED_FILE_DIVERGED,
    WAIT_TIMEOUT,
    E2E_BUILD_FAILED,  # WP69 AC1
    BUNDLE_NOT_E2E_CAPABLE,  # WP69 AC3
    BUNDLE_RESTORE_MISMATCH,  # WP69 AC4
    INSTALL_CONFLICT,  # WP69 AC4
)

#: Not a failure — the healthy plugin state. §7 enumerates only failure reasons, but a
#: state field needs a value for the good case too. WP43-owned like everything else here;
#: consumers import it rather than testing ``state is None``.
PLUGIN_OK = "PLUGIN_OK"

# ---------------------------------------------------------------------------
# §8 — Entrypoints / rig kind (D13). A run record produced by the headless rig must be
#      structurally impossible to mistake for a real run record.
# ---------------------------------------------------------------------------

RIG_KIND_HEADLESS_MOCK = "headless-mock"
RIG_KIND_REAL_OBSIDIAN = "real-obsidian"

# ---------------------------------------------------------------------------
# §9 — Vault opening uses the Obsidian URI with the vault name URL-encoded (WP45 AC3).
# ---------------------------------------------------------------------------

OBSIDIAN_OPEN_URI_TEMPLATE = "obsidian://open?vault={vault}"

# ---------------------------------------------------------------------------
# §10 — WP70: the local relay, the provisioned gate settings, and the
#       `obsidian-git` precondition borrow.
#
# Owned by WP70 (`WP70_PinnedDecisions.md`, `T3_SharedContract.md` §10b). **Appended,
# never inserted into another block**: §4.1 and every WP43–WP49 block above keeps its
# text *and* its position, not one line moved, renamed or re-indented.
#
# Hard-won rule 10 in its sharpest form — every value below is spelled **here and
# nowhere else**. `relay.py` and `provisioning.py` import them; neither re-declares one,
# neither spells the port digits in a default argument, a docstring example or a URL.
# ---------------------------------------------------------------------------

# --- the relay ---------------------------------------------------------------
#: A third port band, disjoint from the headless-mock pair (39421/39422) and from the
#: real-control pair (39431/39432), one decade above the latter so a transposed digit
#: lands on nothing at all.
RELAY_PORT = 39441
RELAY_HOST = "127.0.0.1"  # what the RIG probes; the server itself binds all interfaces
RELAY_BASE_URL = f"http://{RELAY_HOST}:{RELAY_PORT}"
RELAY_HEALTH_PATH = "/healthz"
RELAY_ROOMS_PATH = "/rooms"
RELAY_ROOM_NAME_PREFIX = "e2e-gate-"  # room name = prefix + run_id
RELAY_SERVER_DIR_REL = "server"  # repo-relative; the module resolves it
RELAY_ENTRY_REL = "server/dist/index.js"
RELAY_BUILD_SCRIPT = "build"  # server/package.json — plain `tsc`, and it TERMINATES

# --- bounded waits (never a sleep as an oracle) ------------------------------
#: Measured on this host: a connection to a port with nothing listening does **not**
#: raise ``ConnectionRefusedError`` — it consumes the whole connect timeout and raises
#: ``TimeoutError``. An oracle written ``except ConnectionRefusedError`` can therefore
#: never fire here, which is why "stopped" means *a connection no longer completes
#: within a bounded budget* and why the stopped probe's connect timeout is small: every
#: negative poll costs it in full.
RELAY_READY_BUDGET_S = 30.0
RELAY_READY_POLL_INTERVAL_S = 0.25
RELAY_READY_CONNECT_TIMEOUT_S = 2.0
RELAY_STOPPED_BUDGET_S = 15.0
RELAY_STOPPED_POLL_INTERVAL_S = 0.25
RELAY_STOPPED_CONNECT_TIMEOUT_S = 0.25

# --- the run-scoped store directory (AC3) ------------------------------------
#: All three of the relay's LevelDB stores resolve **relative to its process cwd** and
#: only one of them (``BLOB_STORE_PATH``) has an environment hook at all, so the cwd is
#: the mechanism: the relay is started *inside* the run-scoped directory below, which is
#: outside the repository and outside both vaults, and is removed at teardown.
RELAY_STORE_ROOT_NAME = "obsidian-e2e-relay"  # under tempfile.gettempdir()
RELAY_STORE_SUBDIRS = ("data/frames", "data/yjs-docs", "data/audit")

# --- the provisioned settings key set (AC1) — pinned ORDER, exhaustive -------
#: Every member is an existing member of ``LiveShareSettings``; no key is invented. The
#: order is pinned because the borrow writes absent members in exactly this sequence.
PROVISIONED_SETTINGS_KEYS = (
    "e2eControlPort",
    "serverUrl",
    "roomId",
    "token",
    "role",
    "permission",
    "sharedFolder",
    "excludePatterns",
    "autoReconnect",
    "debugLogging",
)

SETTINGS_ROLE_HOST = "host"
SETTINGS_ROLE_GUEST = "guest"
SETTINGS_ROLES = {ROLE_A: SETTINGS_ROLE_HOST, ROLE_B: SETTINGS_ROLE_GUEST}
SETTINGS_PERMISSION = "read-write"

#: The shared surface is the rig-owned scratch folder **itself**, not a copy of its
#: spelling: ``isSharedPath`` treats an *empty* ``sharedFolder`` as the whole vault
#: shared, the host publishes its manifest with ``purge: true``, and the guest trashes
#: every shared local file absent from that manifest — so a second spelling that drifted
#: from :data:`SCRATCH_FOLDER` would silently re-open that blast radius.
SETTINGS_SHARED_FOLDER = SCRATCH_FOLDER
SETTINGS_EXCLUDE_PATTERNS = ()  # provisioned as an EMPTY list, never absent, never null
SETTINGS_AUTO_RECONNECT = True
#: Provisioned ``false`` for the duration and restored: a debug log written to
#: ``debugLogPath`` inside the vault is a vault write the C47 AC3 fingerprint reports.
SETTINGS_DEBUG_LOGGING = False

#: Never read, never written, never named in a value position (S4). ``data.json`` holds
#: live credentials; this set and :data:`PROVISIONED_SETTINGS_KEYS` are disjoint by
#: construction, which is what makes "neither read nor written" enforceable at all.
CREDENTIAL_SETTINGS_KEYS = (
    "encryptionPassphrase",
    "encryptionSalt",
    "jwt",
    "serverPassword",
)

# --- the obsidian-git precondition borrow ------------------------------------
#: ``community-plugins.json`` is Obsidian's *enabled* list and is a **different file and
#: a different borrow** from WP44's ``data.json`` — hence its own namespace and its own
#: marker, never a second borrow inside the module whose whole invariant is one borrow
#: over one file. ``lan-vault-sync`` is installed but NOT enabled and cannot run; the
#: engine that can bring content in by a non-relay path is ``obsidian-git``, whose
#: ``autoPullOnBoot`` fires at launch.
DISABLED_PLUGIN_IDS = ("obsidian-git",)
COMMUNITY_PLUGINS_BACKUP_REL = ".obsidian/community-plugins.json.e2e-original"
COMMUNITY_PLUGINS_MARKER_REL = ".obsidian/.e2e-community-plugins.json"

#: Like the WP44 and WP69 markers: fingerprints and structure only, never file content.
COMMUNITY_PLUGINS_MARKER_FIELDS = (
    "runId",
    "role",
    "hadOriginal",
    "originalSha256",
    "originalSize",
    "disabled",
    "pid",
    "createdAt",
)

# --- §10.1 — named failure reasons added by WP70 -----------------------------
#
# These are *appended* to :data:`FAILURE_REASONS` below, in one contiguous run after
# WP69's. The append is written as a rebinding rather than as an edit inside the §7
# tuple literal for a structural reason: §7 is a WP43 block, and the batch rule is that
# WP43–WP49 and §4.1 keep their text *and their position*. Extending the tuple here
# leaves every existing line exactly where it was and still yields one tuple with the
# new reasons at the end.
#
# `RESTART_REQUIRED_OPERATOR` (WP45, existing) is **reused** for AC4's refusal to
# provision a vault whose plugin is already loaded. No new reason is invented for it.

RELAY_PORT_OCCUPIED = "RELAY_PORT_OCCUPIED"  # WP70 AC3 — never adopt, never kill
RELAY_BUILD_FAILED = "RELAY_BUILD_FAILED"  # WP70 AC3
RELAY_READINESS_TIMEOUT = "RELAY_READINESS_TIMEOUT"  # WP70 AC3 — names the condition
RELAY_NOT_STOPPED = "RELAY_NOT_STOPPED"  # WP70 AC3 — an orphaned listener fails the run
ROOM_MINT_FAILED = "ROOM_MINT_FAILED"  # WP70 AC3/AC4
GATE_ORDER_VIOLATION = "GATE_ORDER_VIOLATION"  # WP70 AC4
SHARED_SURFACE_NOT_ESTABLISHED = "SHARED_SURFACE_NOT_ESTABLISHED"  # WP70 AC2
PROPAGATION_EVIDENCE_UNAVAILABLE = "PROPAGATION_EVIDENCE_UNAVAILABLE"  # WP70 AC5
NEGATIVE_CONTROL_LEAKED = "NEGATIVE_CONTROL_LEAKED"  # WP70 AC5 — a FAILED run
COMMUNITY_PLUGINS_CONFLICT = "COMMUNITY_PLUGINS_CONFLICT"  # WP70 precondition
COMMUNITY_PLUGINS_RESTORE_MISMATCH = "COMMUNITY_PLUGINS_RESTORE_MISMATCH"  # WP70 precondition

FAILURE_REASONS = FAILURE_REASONS + (
    RELAY_PORT_OCCUPIED,  # WP70 AC3
    RELAY_BUILD_FAILED,  # WP70 AC3
    RELAY_READINESS_TIMEOUT,  # WP70 AC3
    RELAY_NOT_STOPPED,  # WP70 AC3
    ROOM_MINT_FAILED,  # WP70 AC3
    GATE_ORDER_VIOLATION,  # WP70 AC4
    SHARED_SURFACE_NOT_ESTABLISHED,  # WP70 AC2
    PROPAGATION_EVIDENCE_UNAVAILABLE,  # WP70 AC5
    NEGATIVE_CONTROL_LEAKED,  # WP70 AC5
    COMMUNITY_PLUGINS_CONFLICT,  # WP70 AC4 (precondition)
    COMMUNITY_PLUGINS_RESTORE_MISMATCH,  # WP70 AC4 (precondition)
)

# --- §10.2 — the secret-bearing member names (S4) ----------------------------
#
# Appended after §10.1 so nothing above moves. `PROVISIONED_SETTINGS_KEYS` is pinned and
# is not re-spelled or reordered here; this block names the *subset of it* whose values
# are credentials, so that "a secret is never rendered" can be enforced by a type against
# a single list rather than re-derived at each call site.
#
# The room token is minted server-side by `POST /rooms`, so it is a live credential in
# exactly the sense the four `data.json` members are — it is simply one the rig created
# rather than one the owner did. Nothing downstream may distinguish them.

SETTINGS_TOKEN_KEY = "token"
SECRET_SETTINGS_KEYS = (SETTINGS_TOKEN_KEY,) + CREDENTIAL_SETTINGS_KEYS

#: Drift guard, not decoration: the token key is provisioned, and the four credential
#: keys are provisioned by nobody. If either statement ever stops holding, the redaction
#: is pointed at the wrong member set and this fails at import rather than at a leak.
assert SETTINGS_TOKEN_KEY in PROVISIONED_SETTINGS_KEYS
assert not set(CREDENTIAL_SETTINGS_KEYS) & set(PROVISIONED_SETTINGS_KEYS)
