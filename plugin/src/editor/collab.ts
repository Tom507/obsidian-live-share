import { Compartment, EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { yCollab } from "y-codemirror.next";
import type * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";

import type { SyncManager } from "../sync/sync";
import type { Permission, SessionRole } from "../types";
import { yTextHeldContent } from "../files/ytext-history";
import { applyMinimalYTextUpdate, normalizeLineEndings, skipsAutoTextSync } from "../utils";
import {
  COLLAB_BIND,
  clearCollabBindFailure,
  clearCollabBindRefusal,
  decideCollabBind,
  hostMaySeedFromEditor,
  noteCollabBindFailure,
  noteCollabBindRefusal,
} from "./collab-bind-decision";
import { conflictExtension } from "./conflict-decoration";

export interface CursorUser {
  name: string;
  color: string;
  colorLight: string;
}

export class CollabManager {
  private compartment = new Compartment();
  private currentPath: string | null = null;
  private currentView: EditorView | null = null;
  private currentAwareness: awarenessProtocol.Awareness | null = null;
  private activationGen = 0;
  /** S129 — one-shot observers on documents whose content had not arrived. */
  private contentWatchers = new Map<string, () => void>();
  /** Optional, so every existing construction of this class stays valid. */
  private logger: { log(category: string, message: string): void } | null = null;
  /** S134 AC3 — see {@link setBindStateSink}. Optional for the same reason. */
  private bindStateSink: ((path: string, bound: boolean) => void) | null = null;

  /** S129 AC5 — wired by `main.ts` so a refusal reaches the debug log. */
  setLogger(logger: { log(category: string, message: string): void } | null): void {
    this.logger = logger;
  }

  /**
   * S134 AC3 — THE BIND MUST NOT LIE.
   *
   * `main.ts` sets `backgroundSync.setCollabBoundFile(sharedPath)` SYNCHRONOUSLY,
   * before this class is even called, and nothing ever unsets it when the
   * activation fails. So a note whose `waitForSync` rejected at its 10 s timeout
   * — compartment reconfigured to EMPTY, user shown `sync timed out` — was still
   * reported as bound by every internal indicator, which is precisely how a
   * three-way divergence stayed invisible for a day.
   *
   * This is a REPORT, not a gate: nothing in this class branches on it. The
   * single-writer invariant does not rest on it either — `main.ts` sets
   * `setActiveFile(sharedPath)` on the same line, and both `handleLocalTextModify`
   * and the `Y.Text` observer gate on the active file FIRST, so clearing the
   * collab-bound flag for a file that is still open cannot open a second-writer
   * window. Verified against `background-sync.ts` `:369`/`:370` and `:449`/`:450`,
   * where the two gates sit as a pair.
   */
  setBindStateSink(sink: ((path: string, bound: boolean) => void) | null): void {
    this.bindStateSink = sink;
  }

  /**
   * S129 — RECOVER ON THE EVENT, NOT ON A RETRY BUDGET.
   *
   * S123's lesson at a new site: a refused bind must not need the user to close
   * and reopen the file. The moment the document gains content, re-activate —
   * which re-runs the same decision and, this time, binds.
   *
   * A bounded wait is still legitimate ABOVE this (a human just opened a file
   * and the editor cannot stay unconfigured indefinitely), which is the one way
   * this site differs from S123's background pass. What is not legitimate is
   * the expiry CONTINUING into the destructive path, and it no longer does.
   */
  private watchForContent(
    view: EditorView,
    filePath: string,
    syncManager: SyncManager,
    role?: SessionRole,
    permission?: Permission,
    cursorUser?: CursorUser,
  ): void {
    if (this.contentWatchers.has(filePath)) return;
    const handle = syncManager.getDoc(filePath);
    if (!handle) return;
    const text = handle.text;
    let fired = false;
    const onChange = () => {
      if (fired || text.length === 0) return;
      fired = true;
      this.unwatchContent(filePath);
      clearCollabBindRefusal(filePath);
      clearCollabBindFailure(filePath);
      this.logger?.log("collab", `content arrived for ${filePath}; re-activating`);
      void this.activateForFile(view, filePath, syncManager, role, permission, cursorUser);
    };
    // Defensive: the recovery is an ENHANCEMENT to the refusal, never a
    // precondition for it. A document that cannot be observed still leaves the
    // buffer intact — it simply will not auto-recover — and must not turn a
    // fail-safe into a thrown activation.
    if (typeof text.observe !== "function") return;
    text.observe(onChange);
    this.contentWatchers.set(filePath, () => text.unobserve?.(onChange));
    // It may have landed between the decision and this line.
    onChange();
  }

  private unwatchContent(filePath: string): void {
    const dispose = this.contentWatchers.get(filePath);
    if (!dispose) return;
    this.contentWatchers.delete(filePath);
    try {
      dispose();
    } catch {
      /* unobserve on a destroyed doc is not worth surfacing */
    }
  }

  getBaseExtension(): Extension {
    return this.compartment.of([]);
  }

  async activateForFile(
    view: EditorView,
    filePath: string | null,
    syncManager: SyncManager,
    role?: SessionRole,
    permission?: Permission,
    cursorUser?: CursorUser,
  ) {
    const gen = ++this.activationGen;

    if (filePath !== this.currentPath || view !== this.currentView) {
      if (this.currentAwareness) {
        this.currentAwareness.setLocalState(null);
      }
      if (this.currentView && this.currentView !== view) {
        try {
          this.currentView.dispatch({
            effects: this.compartment.reconfigure([]),
          });
        } catch {
          // Previous view may have been destroyed
        }
      }
      this.currentAwareness = null;
    }
    this.currentPath = filePath;
    this.currentView = view;
    if (!filePath) {
      this.currentAwareness = null;
      view.dispatch({ effects: this.compartment.reconfigure([]) });
      return;
    }
    // WP27 AC4 — the second of the two unguarded bare-path `getDoc` sites (R5).
    //
    // `filePath` is a VAULT PATH. An unguarded host activation over a `.canvas`
    // asks the sync manager for a document under that path, then seeds the whole
    // canvas JSON into a raw `Y.Text` for it and installs a `yCollab` binding —
    // a character-level CRDT over a document `CanvasSync` owns structurally.
    // That is R5 itself, and its merge destroys edge endpoints.
    //
    // Guid-based doc ids defuse the collision structurally, but AC4 asks for the
    // guard as well ("verified by an explicit test rather than by a reachability
    // argument"), so this line is the one a test can point at. It sits BEFORE
    // the `getDoc` because the CALL is what creates the document.
    //
    // `skipsAutoTextSync` is the shared predicate (`utils.ts`): `.canvas` plus
    // the sidecar directory, one definition, no private copy. Nothing legitimate
    // is refused — both this and `BackgroundSync.setActiveFile` are fed from a
    // `MarkdownView`, which a `.canvas` never is, and the R10 text fallback runs
    // through `BackgroundSync.subscribe`, never through an editor binding.
    //
    // The early return takes the same shape as the `!docHandle` one below: drop
    // the awareness reference and reconfigure the compartment to EMPTY, so a
    // previous file's binding is never left live over the canvas.
    if (skipsAutoTextSync(filePath)) {
      this.currentAwareness = null;
      view.dispatch({ effects: this.compartment.reconfigure([]) });
      return;
    }
    const docHandle = syncManager.getDoc(filePath);
    if (!docHandle) {
      this.currentAwareness = null;
      view.dispatch({ effects: this.compartment.reconfigure([]) });
      return;
    }

    try {
      await syncManager.waitForSync(filePath);
    } catch {
      if (this.activationGen !== gen) return;
      // S134 AC3 — THE HALF THAT MADE THE DEFECT INVISIBLE.
      //
      // What happens below has not changed: the compartment goes to EMPTY and
      // the user is told. What used to happen NOWHERE is everything else —
      // nothing counted this, nothing wrote a line, and `collabBoundFile` went
      // on naming a file this editor is not bound to. The Notice was the single
      // trace, it is transient, and `notificationsEnabled` can switch its
      // siblings off (S117).
      //
      // Ordered before the dispatch: the report must survive a destroyed view,
      // and the `try` below deliberately swallows that case.
      noteCollabBindFailure(filePath);
      this.logger?.log(
        "collab",
        `bind FAILED for ${filePath}: waitForSync rejected, so the editor is left ` +
          "unbound and this file is NOT collaborating",
      );
      this.bindStateSink?.(filePath, false);
      new Notice("Live Share: sync timed out");
      this.currentAwareness = null;
      try {
        view.dispatch({ effects: this.compartment.reconfigure([]) });
      } catch {
        // View may have been destroyed during sync
      }
      // S123's lesson, same as the refusal path below: recover on the EVENT.
      // A failed bind that needs the user to close and reopen the file is how
      // three peers end up editing three copies of one note for a whole
      // session — the document arriving is exactly the moment to try again.
      this.watchForContent(view, filePath, syncManager, role, permission, cursorUser);
      return;
    }

    if (this.activationGen !== gen) return;
    if ((view as unknown as { destroyed: boolean }).destroyed) return;

    if (role !== "host" && docHandle.text.length === 0) {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (this.activationGen !== gen) return;
        if ((view as unknown as { destroyed: boolean }).destroyed) return;
        if (docHandle.text.length > 0) break;
      }
    }

    // S129 — THE FALL-THROUGH, WHICH IS THE DEFECT.
    //
    // The loop above is a bounded wait; when it expired this code simply
    // CONTINUED and handed an empty `Y.Text` to `yCollab`, which makes the
    // editor buffer match it. Opening a note before its document arrived
    // emptied the note — on the one path neither empty-write floor covers,
    // because `background-sync.ts` hands the active file to the editor.
    //
    // The evidence is S128's resolution and S126's tombstones, not a longer
    // timer: a longer timer closes this on the runs that happen to be fast
    // enough, which is precisely what S123 looked like before its probe became
    // an event.
    const docTextLength = docHandle.text.length;
    // Only consult the history and the resolution when the document is EMPTY —
    // that is the only case either can change the answer, and it keeps the
    // common path (a doc that already holds content) free of both.
    const docHeldContent = docTextLength === 0 ? yTextHeldContent(docHandle.text) : true;
    if (role !== "host") {
      const verdict = decideCollabBind({
        docTextLength,
        editorBufferLength: view.state.doc.length,
        resolution: docTextLength === 0 ? syncManager.getSyncResolution(filePath) : null,
        docHeldContent,
      });
      if (verdict.decision !== COLLAB_BIND.BIND) {
        noteCollabBindRefusal(filePath);
        this.logger?.log("collab", `bind refused for ${filePath}: ${verdict.reason}`);
        // S134 AC3 — a REFUSAL leaves the compartment empty too, so it tells the
        // same lie. Counted separately above (it is a decision, not a failure);
        // the bound-state report is identical because the fact is identical.
        this.bindStateSink?.(filePath, false);
        // The buffer is left EXACTLY as it was: no `yCollab`, so nothing
        // reconciles the editor against the empty document.
        this.currentAwareness = null;
        try {
          view.dispatch({ effects: this.compartment.reconfigure([]) });
        } catch {
          // The view may have been destroyed during the wait.
        }
        // AC5 — silently not collaborating is the S114 shape. Say so.
        new Notice(
          `Live Share: not syncing "${filePath}" yet — the shared copy has not arrived. ` +
            "Your text is untouched; it will start syncing when the other peers connect.",
        );
        // S123's lesson applied here: recover on the EVENT, not on a retry
        // budget. The moment the document gains content, re-activate.
        this.watchForContent(view, filePath, syncManager, role, permission, cursorUser);
        return;
      }
    }

    if (role === "host" && hostMaySeedFromEditor({ docTextLength: docHandle.text.length, docHeldContent })) {
      // Seed only when Y.Text is empty (mirror the guest logic). Force-seeding
      // on every activation would clobber concurrent guest edits whenever the
      // CM6 doc is momentarily stale relative to Y.Text.
      //
      // S129 AC3 — additionally gated on the absence of TOMBSTONES. Without
      // that, a host whose buffer is stale re-inserts content a peer had just
      // deleted, undoing the deletion: the inverse of S126, and a divergence
      // nobody asked for. Milder than the guest hole (it resurrects rather than
      // destroys), but it is a hole and the evidence to close it was free.
      const localContent = normalizeLineEndings(view.state.doc.toString());
      applyMinimalYTextUpdate(docHandle.doc, docHandle.text, localContent);
    }

    // S129 — this path is now collaborating, so it is no longer refused.
    clearCollabBindRefusal(filePath);
    // S134 AC3 — and it is no longer a failed bind either. `total` is monotonic
    // in both ledgers; only the live `paths` set clears, so a recovery can never
    // erase the record that it happened.
    clearCollabBindFailure(filePath);
    this.bindStateSink?.(filePath, true);
    this.currentAwareness = docHandle.awareness;
    if (cursorUser) {
      docHandle.awareness.setLocalStateField("user", cursorUser);
    }
    const collabExt = yCollab(docHandle.text, docHandle.awareness, {
      undoManager: false,
    });
    const extensions: Extension[] = Array.isArray(collabExt) ? [...collabExt] : [collabExt];
    extensions.push(conflictExtension());
    if (permission === "read-only") {
      extensions.push(EditorState.readOnly.of(true));
    }
    view.dispatch({
      effects: this.compartment.reconfigure(extensions),
    });

    const selection = view.state.selection.main;
    const anchor = Y.createRelativePositionFromTypeIndex(docHandle.text, selection.anchor);
    const head = Y.createRelativePositionFromTypeIndex(docHandle.text, selection.head);
    docHandle.awareness.setLocalStateField("cursor", { anchor, head });
  }

  deactivateAll(view: EditorView) {
    this.activationGen++;
    // S129 — watchers describe one session's documents.
    for (const path of Array.from(this.contentWatchers.keys())) this.unwatchContent(path);
    if (this.currentAwareness) {
      this.currentAwareness.setLocalState(null);
      this.currentAwareness = null;
    }
    this.currentPath = null;
    this.currentView = null;
    view.dispatch({ effects: this.compartment.reconfigure([]) });
  }
}
