// WP37 (C37 AC6) — the instrument the rig did not have.
//
// WHY THIS FILE EXISTS
// --------------------
// Every command `testing/e2e-control.ts` exposed before this one either reads
// state or writes the shared `Y.Doc`. NONE of them types into anything. The whole
// subject of WP37 — an inline editor the user is typing in, with characters
// Obsidian has not yet flushed — is a state the rig had no way to create, so
// AC3 and AC5 had no instrument and a criterion with no instrument is not a
// criterion.
//
// WHAT THIS IS NOT
// ----------------
// It is NOT `canvas.simulateEdit`. That command writes straight into the `Y.Doc`
// (`e2e-control.ts`, `simulateEdit`) and returns a hardcoded `applied: true`,
// which has produced several false greens in this project. This driver:
//
//   ├── never touches a `Y.Doc`  — it holds no Yjs import and no doc handle;
//   ├── never writes the `.canvas` file — it holds no vault/adapter writer; and
//   └── returns NO literal — every field of its result is read back from the
//       live surface AFTER the attempt, including `applied`, which is computed
//       by comparing the surface text before and after and is therefore capable
//       of being `false` on a real instance.
//
// It drives the editing surface Obsidian itself uses: the canvas node's own
// editor (`startEditing()` + the CodeMirror instance behind it), falling back to
// the contenteditable DOM the same editor renders. Both paths leave the typed
// characters where a real keystroke leaves them — in the editor, NOT in the file
// and NOT in the doc — which is exactly the precondition AC3 needs.
//
// Everything private is validated defensively. A shape this driver does not
// recognise produces a STRUCTURED FAILURE naming what was missing, never a
// success and never a throw.

/** What the caller asks for. `text` absent ⇒ focus/blur only, nothing typed. */
export interface CanvasNodeEditRequest {
  path: string;
  nodeId: string;
  /** Characters to insert at the end of the node's current text. */
  text?: string;
  /** Blur/commit the editor after the insert (or on its own when `text` is absent). */
  blur?: boolean;
  /** Open the canvas in a workspace leaf first when it is not already showing. */
  open?: boolean;
}

/** Which surface actually took the characters. Measured, never assumed. */
export type EditingSurface = "node-editor" | "contenteditable" | "none";

/**
 * Structured failures. Each names a condition the caller can create on purpose,
 * which is what makes AC6's two negative cases exercisable rather than argued.
 */
export type CanvasNodeEditError =
  | "workspace-unavailable"
  | "canvas-not-open"
  | "canvas-surface-unavailable"
  | "node-not-found"
  | "no-editing-surface";

export interface CanvasNodeEditResult {
  ok: boolean;
  error?: CanvasNodeEditError;
  /** Human-readable elaboration of `error`; absent on success. */
  reason?: string;
  path: string;
  nodeId: string;
  /** A canvas leaf showing `path` was found. */
  canvasOpen: boolean;
  /** `open:true` was asked for and a leaf was opened by this call. */
  opened: boolean;
  /** `nodeId` is present in the live canvas's node map. */
  nodeFound: boolean;
  /** Ids the live canvas does hold — present so a miss is diagnosable, not guessed at. */
  liveNodeIds: string[];
  /** `startEditing()` existed and was invoked without throwing. */
  editingStarted: boolean;
  /** The node's own `isEditing` after the attempt, when it exposes one. */
  editingReported: boolean | null;
  /** Which surface the characters were handed to. */
  surface: EditingSurface;
  /** `document.activeElement` is inside this node's element. Measured after the insert. */
  focusTaken: boolean;
  /** The editing surface's text BEFORE the insert. */
  textBefore: string | null;
  /** The editing surface's text AFTER the insert — read back, never echoed. */
  textAfter: string | null;
  /**
   * WHERE `textAfter` was read. `"editor"` is the only source that can hold
   * characters Obsidian has not flushed; `"model"` is what the card renders. A
   * scenario that does not distinguish them can measure the wrong surface and
   * call it a pass.
   */
  textSource: TextSource;
  /**
   * MEASURED, never a literal: the surface text changed. This is the field
   * `canvas.simulateEdit` hardcoded to `true`; here it is a comparison of two
   * reads of the live surface and it is `false` whenever nothing landed.
   */
  applied: boolean;
  /** The characters the surface gained, derived from the two reads. */
  inserted: string;
  /** A blur was requested and a blur affordance was invoked without throwing. */
  blurred: boolean;
  /**
   * What was found on the private shape. Diagnostics only — it is what makes a
   * `no-editing-surface` failure actionable instead of mysterious.
   */
  probe: {
    hasStartEditing: boolean;
    hasNodeEl: boolean;
    hasChild: boolean;
    editorMembers: string[];
    contenteditableFound: boolean;
  };
}

// --- The private shapes, held loosely and validated at every access ----------

interface EditorLike {
  getValue?: () => unknown;
  setValue?: (v: string) => unknown;
  replaceSelection?: (v: string) => unknown;
  setCursor?: (line: number, ch?: number) => unknown;
  lastLine?: () => unknown;
  getLine?: (line: number) => unknown;
  focus?: () => unknown;
  blur?: () => unknown;
}

interface CanvasNodeLike {
  id?: unknown;
  text?: unknown;
  nodeEl?: unknown;
  isEditing?: unknown;
  startEditing?: unknown;
  stopEditing?: unknown;
  blur?: unknown;
  child?: unknown;
  editor?: unknown;
  getData?: unknown;
}

interface CanvasLike {
  nodes?: unknown;
  wrapperEl?: unknown;
  // Deliberately NOT declaring the canvas's save/persist members. This driver has
  // no business reaching them, and a type that cannot name them is one fewer way
  // for a later edit to start writing a file from here.
}

interface CanvasViewLike {
  canvas?: unknown;
  file?: { path?: unknown };
}

/** Everything this driver needs from the outside world, injected so it is testable. */
export interface CanvasNodeEditorDeps {
  /** Canvas leaf views currently open, in workspace order. */
  canvasViews(): CanvasViewLike[];
  /** Open `path` in a leaf. Absent ⇒ `open:true` degrades to "not opened". */
  openCanvas?(path: string): Promise<boolean>;
  /** `document`, or null when there is no DOM (unit tests, mobile shapes). */
  document(): DocumentLike | null;
  /** Bounded wait — injected so no test ever sleeps on a wall clock. */
  wait(ms: number): Promise<void>;
}

/** The narrow slice of `Document` used here. Structural so a fake satisfies it. */
export interface DocumentLike {
  activeElement?: unknown;
  createRange?: () => unknown;
  execCommand?: (cmd: string, showUi?: boolean, value?: string) => boolean;
  defaultView?: { getSelection?: () => unknown } | null;
}

/** How long to wait for the editor to mount after `startEditing()`, in ms. */
export const EDITOR_MOUNT_BUDGET_MS = 1200;
/** Poll interval inside that budget. */
export const EDITOR_MOUNT_POLL_MS = 50;

function isFn(v: unknown): v is (...a: unknown[]) => unknown {
  return typeof v === "function";
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** The node map, only when it really is a `Map`. */
function nodeMap(canvas: CanvasLike | null): Map<string, CanvasNodeLike> | null {
  return canvas?.nodes instanceof Map ? (canvas.nodes as Map<string, CanvasNodeLike>) : null;
}

/**
 * The editor object behind a canvas node, if one of the known shapes is present.
 *
 * Obsidian's canvas text node keeps its live editor on `child` (the embedded
 * markdown view) in current builds and has exposed it directly in others. Both
 * are probed, and a candidate only counts when it can actually be read from
 * (`getValue`) — an object that merely has the right name proves nothing.
 */
export function resolveNodeEditor(node: CanvasNodeLike | null): EditorLike | null {
  if (!node) return null;
  const child = node.child as { editor?: unknown; editMode?: { editor?: unknown } } | undefined;
  const candidates: unknown[] = [
    child?.editor,
    child?.editMode?.editor,
    node.editor,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const editor = candidate as EditorLike;
      if (isFn(editor.getValue)) return editor;
    }
  }
  return null;
}

/** The `.cm-content` contenteditable inside a node element, or null. */
function resolveContentEditable(node: CanvasNodeLike | null): {
  focus?: () => void;
  blur?: () => void;
  textContent?: unknown;
  isContentEditable?: unknown;
} | null {
  const el = node?.nodeEl as { querySelector?: (s: string) => unknown } | undefined;
  if (!el || !isFn(el.querySelector)) return null;
  for (const selector of [
    ".cm-content[contenteditable='true']",
    ".cm-content",
    "[contenteditable='true']",
  ]) {
    let found: unknown;
    try {
      found = el.querySelector(selector);
    } catch {
      found = null;
    }
    if (found && typeof found === "object") {
      return found as { focus?: () => void; textContent?: unknown };
    }
  }
  return null;
}

/** Where a text read came from. Reported, so an oracle is never mistaken for another. */
export type TextSource = "editor" | "dom" | "model" | "none";

/**
 * The text this node currently shows, and WHERE that was read.
 *
 * Which source wins depends on `isEditing`, and that is not a detail:
 *
 *   ├── EDITING  → the editor's own buffer, because that is where characters the
 *   │              user has typed but Obsidian has not yet flushed actually live.
 *   │              It is the only read that can observe the state WP37 protects.
 *   └── NOT editing → the node MODEL (`node.text`), which is what the card
 *                  renders. A stale editor object left over from a previous edit
 *                  would otherwise make a closed card report text it is not
 *                  showing — an oracle that quietly measures the wrong surface.
 */
function readSurface(node: CanvasNodeLike | null): { text: string | null; source: TextSource } {
  const editing = node?.isEditing === true;
  const editor = resolveNodeEditor(node);
  if (editing && editor && isFn(editor.getValue)) {
    try {
      const value = editor.getValue();
      if (typeof value === "string") return { text: value, source: "editor" };
    } catch {
      /* fall through */
    }
  }
  const modelText = asString(node?.text);
  if (modelText !== null) return { text: modelText, source: "model" };
  if (editor && isFn(editor.getValue)) {
    try {
      const value = editor.getValue();
      if (typeof value === "string") return { text: value, source: "editor" };
    } catch {
      /* fall through */
    }
  }
  const editable = resolveContentEditable(node);
  if (editable && typeof editable.textContent === "string") {
    return { text: editable.textContent, source: "dom" };
  }
  const getData = node?.getData;
  if (isFn(getData)) {
    try {
      const data = getData.call(node) as { text?: unknown } | undefined;
      const fromData = asString(data?.text);
      if (fromData !== null) return { text: fromData, source: "model" };
    } catch {
      /* a private accessor that throws is an absent one */
    }
  }
  return { text: null, source: "none" };
}

/** Convenience wrapper for the places that only need the string. */
function readSurfaceText(node: CanvasNodeLike | null): string | null {
  return readSurface(node).text;
}

/** The suffix `after` gained over `before`; `""` when nothing was gained. */
export function insertedSuffix(before: string | null, after: string | null): string {
  if (after === null) return "";
  if (before === null) return after;
  if (after.length <= before.length) return "";
  return after.startsWith(before) ? after.slice(before.length) : "";
}

function canonicalPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** The open canvas leaf whose file is `path`, or null. */
export function findCanvasViewForPath(
  views: CanvasViewLike[],
  path: string,
): CanvasViewLike | null {
  const wanted = canonicalPath(path);
  for (const view of views) {
    const filePath = asString(view?.file?.path);
    if (filePath !== null && canonicalPath(filePath) === wanted) return view;
  }
  return null;
}

function baseResult(req: CanvasNodeEditRequest): CanvasNodeEditResult {
  return {
    ok: false,
    path: req.path,
    nodeId: req.nodeId,
    canvasOpen: false,
    opened: false,
    nodeFound: false,
    liveNodeIds: [],
    editingStarted: false,
    editingReported: null,
    surface: "none",
    focusTaken: false,
    textBefore: null,
    textAfter: null,
    textSource: "none",
    applied: false,
    inserted: "",
    blurred: false,
    probe: {
      hasStartEditing: false,
      hasNodeEl: false,
      hasChild: false,
      editorMembers: [],
      contenteditableFound: false,
    },
  };
}

/**
 * Drive the real inline editor of one canvas node.
 *
 * The sequence is deliberately the one a user performs: open the editor, put the
 * caret at the end, insert, read back, optionally blur. Nothing here writes a
 * file or a CRDT — the characters live in the editor exactly as an unflushed
 * keystroke does, which is the state WP37 exists to protect.
 */
export async function driveCanvasNodeEdit(
  deps: CanvasNodeEditorDeps,
  req: CanvasNodeEditRequest,
): Promise<CanvasNodeEditResult> {
  const out = baseResult(req);

  let views: CanvasViewLike[];
  try {
    views = deps.canvasViews() ?? [];
  } catch (err) {
    out.error = "workspace-unavailable";
    out.reason = err instanceof Error ? err.message : String(err);
    return out;
  }

  let view = findCanvasViewForPath(views, req.path);
  if (!view && req.open === true && isFn(deps.openCanvas)) {
    try {
      out.opened = (await deps.openCanvas(req.path)) === true;
    } catch {
      out.opened = false;
    }
    // The leaf mounts asynchronously; poll rather than assume.
    for (let waited = 0; !view && waited < EDITOR_MOUNT_BUDGET_MS; waited += EDITOR_MOUNT_POLL_MS) {
      await deps.wait(EDITOR_MOUNT_POLL_MS);
      view = findCanvasViewForPath(deps.canvasViews() ?? [], req.path);
    }
  }
  if (!view) {
    out.error = "canvas-not-open";
    out.reason =
      `no open canvas leaf is showing '${req.path}'` +
      (req.open === true ? " and opening one did not produce a leaf in budget" : "");
    return out;
  }
  out.canvasOpen = true;

  const canvas = (view.canvas ?? null) as CanvasLike | null;
  const nodes = nodeMap(canvas);
  if (!nodes) {
    out.error = "canvas-surface-unavailable";
    out.reason = "the open canvas exposes no node Map (private shape drift)";
    return out;
  }
  out.liveNodeIds = Array.from(nodes.keys());

  const node = nodes.get(req.nodeId) ?? null;
  if (!node) {
    out.error = "node-not-found";
    out.reason = `the open canvas holds no node '${req.nodeId}'`;
    return out;
  }
  out.nodeFound = true;
  out.probe.hasStartEditing = isFn(node.startEditing);
  out.probe.hasNodeEl = !!node.nodeEl;
  out.probe.hasChild = !!node.child;

  const before = readSurface(node);
  out.textBefore = before.text;
  out.textSource = before.source;

  const wantsText = typeof req.text === "string" && req.text.length > 0;
  const wantsBlur = req.blur === true;

  // --- open the editor -----------------------------------------------------
  //
  // ONLY when this call is going to do something. A call with neither `text` nor
  // `blur` is a NON-INVASIVE READ of what this card is showing right now, and it
  // must stay one: a scenario has to be able to look at card Y without stealing
  // focus from the editor it has open on card X — the whole state under test.
  if ((wantsText || wantsBlur) && isFn(node.startEditing)) {
    try {
      node.startEditing.call(node);
      out.editingStarted = true;
    } catch {
      out.editingStarted = false;
    }
  }
  // The editor mounts asynchronously. Poll for it inside a bounded budget; a
  // budget that expires is REPORTED, never silently treated as success.
  let editor = resolveNodeEditor(node);
  let editable = resolveContentEditable(node);
  for (
    let waited = 0;
    (wantsText || wantsBlur) &&
    !editor &&
    !editable &&
    waited < EDITOR_MOUNT_BUDGET_MS;
    waited += EDITOR_MOUNT_POLL_MS
  ) {
    await deps.wait(EDITOR_MOUNT_POLL_MS);
    editor = resolveNodeEditor(node);
    editable = resolveContentEditable(node);
  }
  out.probe.contenteditableFound = !!editable;
  out.probe.editorMembers = editor
    ? ["getValue", "setValue", "replaceSelection", "setCursor", "focus", "blur"].filter((m) =>
        isFn((editor as unknown as Record<string, unknown>)[m]),
      )
    : [];

  const doc = deps.document();
  const text = typeof req.text === "string" ? req.text : "";

  // --- insert --------------------------------------------------------------
  if (text.length > 0) {
    if (editor) {
      out.surface = "node-editor";
      try {
        editor.focus?.();
      } catch {
        /* focus is measured below, never assumed */
      }
      let placed = false;
      if (isFn(editor.setCursor) && isFn(editor.lastLine) && isFn(editor.getLine)) {
        try {
          const last = editor.lastLine() as number;
          const line = (editor.getLine(last) as string) ?? "";
          editor.setCursor(last, line.length);
          placed = true;
        } catch {
          placed = false;
        }
      }
      let inserted = false;
      if (placed && isFn(editor.replaceSelection)) {
        try {
          editor.replaceSelection(text);
          inserted = true;
        } catch {
          inserted = false;
        }
      }
      if (!inserted && isFn(editor.setValue) && isFn(editor.getValue)) {
        // Last resort within the SAME editor: append through the editor's own
        // API. Still the editor, still unflushed — never the file, never the doc.
        try {
          const current = editor.getValue();
          editor.setValue(`${typeof current === "string" ? current : ""}${text}`);
        } catch {
          /* the read-back below reports the failure honestly */
        }
      }
    } else if (editable && doc) {
      out.surface = "contenteditable";
      try {
        editable.focus?.();
      } catch {
        /* measured below */
      }
      placeCaretAtEnd(doc, editable);
      try {
        doc.execCommand?.("insertText", false, text);
      } catch {
        /* the read-back reports it */
      }
    } else {
      out.error = "no-editing-surface";
      out.reason =
        "the node exposes neither a readable editor nor a contenteditable element " +
        `(startEditing=${out.probe.hasStartEditing}, nodeEl=${out.probe.hasNodeEl}, ` +
        `child=${out.probe.hasChild})`;
      out.textAfter = readSurfaceText(node);
      return out;
    }
    // One poll cycle so CodeMirror's own transaction settles before the read-back.
    await deps.wait(EDITOR_MOUNT_POLL_MS);
  } else {
    out.surface = editor ? "node-editor" : editable ? "contenteditable" : "none";
  }

  // --- measure -------------------------------------------------------------
  out.focusTaken = activeElementIsInside(doc, node);
  out.editingReported = typeof node.isEditing === "boolean" ? node.isEditing : null;
  const after = readSurface(node);
  out.textAfter = after.text;
  out.textSource = after.source;
  out.applied = out.textAfter !== out.textBefore;
  out.inserted = insertedSuffix(out.textBefore, out.textAfter);

  // --- blur ----------------------------------------------------------------
  if (req.blur === true) {
    let blurred = false;
    for (const attempt of [
      () => (isFn(node.stopEditing) ? node.stopEditing.call(node) : undefined),
      () => (isFn(node.blur) ? node.blur.call(node) : undefined),
      () => editor?.blur?.(),
      () => editable?.blur?.(),
      () => {
        const active = doc?.activeElement as { blur?: () => void } | undefined;
        if (active && isFn(active.blur)) active.blur();
      },
    ]) {
      try {
        attempt();
        blurred = true;
      } catch {
        /* try the next affordance */
      }
    }
    out.blurred = blurred;
    await deps.wait(EDITOR_MOUNT_POLL_MS);
    // Re-measure: after a blur the caller cares whether focus is really gone.
    out.focusTaken = activeElementIsInside(doc, node);
    out.editingReported = typeof node.isEditing === "boolean" ? node.isEditing : null;
    const settled = readSurface(node);
    out.textAfter = settled.text;
    out.textSource = settled.source;
  }

  out.ok = true;
  return out;
}

/** True when `document.activeElement` lies inside this node's element. */
function activeElementIsInside(doc: DocumentLike | null, node: CanvasNodeLike): boolean {
  const active = doc?.activeElement;
  if (!active) return false;
  const el = node.nodeEl as { contains?: (n: unknown) => boolean } | undefined;
  if (!el || !isFn(el.contains)) return false;
  try {
    return el.contains(active) === true;
  } catch {
    return false;
  }
}

/** Collapse the selection to the end of `el`, so the insert appends. */
function placeCaretAtEnd(doc: DocumentLike, el: unknown): void {
  try {
    const selection = doc.defaultView?.getSelection?.() as
      | { removeAllRanges?: () => void; addRange?: (r: unknown) => void }
      | undefined;
    const range = doc.createRange?.() as
      | { selectNodeContents?: (n: unknown) => void; collapse?: (toStart: boolean) => void }
      | undefined;
    if (!selection || !range) return;
    range.selectNodeContents?.(el);
    range.collapse?.(false);
    selection.removeAllRanges?.();
    selection.addRange?.(range);
  } catch {
    /* an unplaceable caret still inserts, just not necessarily at the end */
  }
}
