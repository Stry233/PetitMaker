/**
 * The editor's states a back-out ends (`platform/input/back-stack.ts`), one registry read off the live
 * store and the hand: each names what stands as a key, null where nothing does, and a key that
 * changes while it stands enters it again at the top, so the stack holds them in the order they were
 * entered. Entries entering in one update take `BACKABLES` order, the outer state first.
 */
import { batchStore, useEditorStore, type EditorStore } from '../../state/store';
import { cancelEditsInFlight, editsInFlight, onEditsInFlightChange } from '../../state/edits-in-flight';
import { isAnnotating, isContentMode } from '../../state/editing/edit-mode';
import { selectionKey } from '../../state/editing/intent';
import { stepBack, stepDelete } from '../../state/slices/blueprint';
import { interfaceHidden } from '../../state/slices/shell';
import { getActiveToolManager } from '../../view/active-view';
import { cancelPendingRegion, pendingRegion, undoPendingRegionStep } from '../../view/interaction/pointer/region-channel';
import {
  addBackSource, backOut as backOutOfStack, deleteMeaning, enterBack, entryOfId, holdBackKey, leaveBack, plainEscape, setBackKey,
  type BackEntry, type BackRank, type DeleteMeaning,
} from '../../platform/input/back-stack';
import { comboFromEvent, normalizeCombo } from '../../platform/input/combo';
import { BACK_COMMAND } from '../../state/keymap/registry';
import { brushBarOpen } from '../../state/keymap/toolbar';
import { effectiveCombo } from '../../state/keymap/resolve';
import { useKeybinds } from '../../state/keymap/store';
import { translate } from '../../i18n/context';
import { showToast } from '../../platform/channels/toast-bus';
import { editorCurves } from '../session/tool-wiring';
import { selectionDeleteMeaning } from '../editing/object-menu';
import { armBlueprint, deleteSelectedBlueprints, escapeBlueprintLibrary, leaveBlueprintFrame, leaveBlueprintSave } from '../editing/blueprint';

const store = (): EditorStore => useEditorStore.getState();

/** A gesture still being drawn (curve anchors, the region brush's figure, a drag), the active tool's. */
function pendingGesture(): { stands: () => boolean; cancel: () => boolean; undoStep: () => boolean } {
  const mgr = getActiveToolManager();
  const tool = mgr?.getActiveTool();
  const ctx = mgr?.getContext();
  return {
    stands: () => pendingRegion() || (tool && ctx ? tool.hasPending?.(ctx) === true : false),
    cancel: () => cancelPendingRegion() || (tool && ctx ? tool.cancelPending?.(ctx) === true : false),
    undoStep: () => undoPendingRegionStep() || (tool && ctx ? tool.undoPendingStep?.(ctx) === true : false),
  };
}

/** One state a back-out ends. */
interface Backable {
  readonly id: string;
  /** False for a state of the page rather than the map, which a window does not stand over. */
  readonly map?: false;
  /** Where it ranks besides its entry order (`BackRank`). */
  readonly rank?: BackRank;
  /** What stands, or null; a change of key while it stands is the state entered again. */
  key(s: EditorStore): string | null;
  back(s: EditorStore): void;
  holds?(s: EditorStore): boolean;
  /** What Delete means while it is in front; absent, Delete asks the state under it. */
  deletes?(s: EditorStore): DeleteMeaning;
}

/** Delete on the selected notes, as the layer's lock answers at the tool; a note is one Undo from back. */
function deleteNotes(s: EditorStore): DeleteMeaning {
  return () => {
    if (s.gridState?.annotations?.locked) { showToast(translate('annot.locked'), 'warning'); return; }
    editorCurves.end();
    store().removeAnnotations(store().annotationSelection);
  };
}

/** What a content surface or the shelf has armed (a tool, a figure, Smart Build's action, an item
 *  card or several, a planting card, the eraser), which one back-out puts down. */
function armedKey(s: EditorStore): string | null {
  const { mode, arming } = s.editMode;
  if (arming.kind === 'none' || !(isContentMode(mode) || mode === 'object') || brushBarOpen(s)) return null;
  return `${mode}:${JSON.stringify(arming)}`;
}

/** Ends the painting of Generate's or the assistant's region and keeps the region: the region
 *  screen's Done and a back-out of it alike. */
export function finishRegionPainting(): void {
  store().setSelectingRegion(false);
}

/** Puts the object brush bar away. Its Done keeps what is armed (EDIT-64); a back-out puts the card
 *  armed in it down with the bar. */
export function closeBrushBar(armed: 'keep' | 'put-down'): void {
  batchStore(() => {
    const s = store();
    if (armed === 'put-down' && s.editMode.arming.kind !== 'none') s.setEditMode({ arm: { kind: 'none' } });
    store().setObjectBrushBar(false);
  });
}

/** The ids of the map's menu and the delete question, whose surfaces take their rows' place while they show. */
export const MAP_MENU_ENTRY = 'map-menu';
export const DELETE_QUESTION_ENTRY = 'delete-question';

const BACKABLES: readonly Backable[] = [
  // Hidden, the interface is the newest state: the back key and Android's back show it again first.
  {
    id: 'interface-hidden', map: false, rank: 1,
    key: (s) => (interfaceHidden(s) ? 'hidden' : null), back: (s) => s.setInterfaceHidden(false),
  },
  { id: 'assistant', map: false, key: (s) => (s.assistantOpen ? 'open' : null), back: (s) => s.setAssistantOpen(false) },
  // Context help stands over windows too, and takes every press while it stands.
  { id: 'whats-this', map: false, key: (s) => (s.whatsThis ? 'on' : null), back: (s) => s.setWhatsThis(false), deletes: () => null },
  {
    // Generate's and the assistant's painting; Blueprint's is its frame step.
    id: 'region',
    key: (s) => (s.selectingRegion && s.regionSelectionOwner && s.regionSelectionOwner !== 'blueprint' ? s.regionSelectionOwner : null),
    back: finishRegionPainting,
  },
  {
    // The bar and the card armed in it go down together.
    id: 'brush-bar',
    key: (s) => (brushBarOpen(s) ? JSON.stringify(s.editMode.arming) : null),
    back: () => closeBrushBar('put-down'),
  },
  {
    // The draft drawn with the tool, selected or not, is part of the tool's state.
    id: 'note-tool',
    key: (s) => (isAnnotating(s) && s.annotationTool !== 'none' ? s.annotationTool : null),
    back: (s) => s.requestAnnotationDiscard(() => {
      pendingGesture().cancel();
      store().setAnnotationTool('none');
      store().setAnnotationSelection([]);
    }),
    deletes: (s) => (s.annotationSelection.length > 0 ? deleteNotes(s) : 'pass'),
  },
  {
    id: 'blueprint-step',
    key: (s) => {
      const step = s.blueprintStep;
      return stepBack(step) === 'none' ? null : `${step.at}:${step.id}:${step.at === 'explorer' && step.picking}`;
    },
    back: (s) => {
      const back = stepBack(s.blueprintStep);
      if (back === 'unpick' || back === 'fold') escapeBlueprintLibrary();
      else if (back === 'leave-frame') leaveBlueprintFrame();
      else if (back === 'leave-save') leaveBlueprintSave();
    },
    holds: (s) => stepBack(s.blueprintStep) === 'hold',
    deletes: (s) => {
      const meaning = stepDelete(s.blueprintStep);
      return meaning.means === 'blueprints' ? () => { deleteSelectedBlueprints(); } : meaning.means === 'nothing' ? null : 'pass';
    },
  },
  {
    // A blueprint armed in Blueprint mode; one kept while another mode is up waits there untouched.
    id: 'blueprint-armed',
    key: (s) => (s.editMode.mode === 'blueprint' ? s.blueprint.armed : null),
    back: () => armBlueprint(null),
  },
  { id: 'armed', key: armedKey, back: (s) => s.setEditMode({ arm: { kind: 'none' } }) },
  {
    // The selection with its picked block and the touch latches, which one clear ends together.
    id: 'selection',
    key: selectionKey,
    back: (s) => s.clearSelection(),
    deletes: selectionDeleteMeaning,
  },
  {
    id: 'note-selection',
    key: (s) => {
      const notes = s.annotationSelection.filter((id) => id !== s.annotationDraft?.id);
      return isAnnotating(s) && notes.length > 0 ? notes.join(',') : null;
    },
    back: (s) => s.setAnnotationSelection([]),
    deletes: deleteNotes,
  },
  // A menu or question keeps Delete to itself.
  { id: MAP_MENU_ENTRY, key: (s) => (s.contextMenu ? JSON.stringify(s.contextMenu.target) : null), back: (s) => s.setContextMenu(null), deletes: () => null },
  {
    id: DELETE_QUESTION_ENTRY, key: (s) => (s.deletePopover ? JSON.stringify(s.deletePopover) : null),
    back: (s) => s.setDeletePopover(null), deletes: () => null,
  },
  { id: 'note-discard', key: (s) => (s.annotationDiscardAction ? 'asked' : null), back: (s) => s.cancelAnnotationDiscard(), deletes: () => null },
  {
    id: 'gesture',
    key: () => (pendingGesture().stands() ? 'drawing' : null),
    back: () => { pendingGesture().cancel(); },
    deletes: () => () => { pendingGesture().undoStep(); },
  },
  {
    // A press still down, or a card carried to the map, which goes back with the arming it borrowed;
    // a build landing by itself is no state of the hand's.
    id: 'hand',
    key: () => (editsInFlight('hand') ? 'landing' : null),
    back: () => { cancelEditsInFlight('hand'); },
  },
];

/** The stack's entry for `b` over the live store. */
function entryOf(b: Backable): BackEntry {
  return {
    id: b.id,
    map: b.map ?? true,
    ...(b.rank ? { rank: () => b.rank! } : null),
    stands: () => b.key(store()) !== null,
    back: () => b.back(store()),
    holds: () => b.holds?.(store()) ?? false,
    deletes: () => (b.deletes ? b.deletes(store()) : 'pass'),
  };
}

/** The key each standing backable stood at when last read, and its entry. */
const standing = new Map<string, { key: string; entry: BackEntry }>();
let syncing = false;

/** Enters every backable that stands anew or under a new key, and takes off those that no longer
 *  stand. A surface showing a state enters under the state's id and takes its row's place
 *  (`useSurfaceScope`'s `backId`), so the state stands on the stack once: entered anew, that surface
 *  moves to the top, and once it closes with the state still standing, the row enters again. */
function sync(): void {
  if (syncing) return;
  syncing = true;
  try {
    const s = store();
    for (const b of BACKABLES) {
      const key = b.key(s);
      const was = standing.get(b.id);
      if (key === null) {
        if (was) { standing.delete(b.id); leaveBack(was.entry); }
        continue;
      }
      const held = entryOfId(b.id);
      if (was?.key === key && held) continue;
      const entry = was?.key === key ? was.entry : entryOf(b);
      standing.set(b.id, { key, entry });
      enterBack(held && held !== was?.entry ? held : entry);
    }
  } finally {
    syncing = false;
  }
}

let watchers = 0;
let unwatch: (() => void) | null = null;

/** Keeps the back stack on the editor's states: read on every store update, every edit starting or
 *  ending in flight, and before every read of the stack, since a gesture begins without a store
 *  write. One watch serves the page however many hold it; returns the release. */
export function watchBackStack(): () => void {
  if (watchers++ === 0) {
    sync();
    const stops = [useEditorStore.subscribe(sync), onEditsInFlightChange(sync), addBackSource(sync)];
    unwatch = () => {
      for (const stop of stops) stop();
      for (const { entry } of standing.values()) leaveBack(entry);
      standing.clear();
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--watchers === 0) { unwatch?.(); unwatch = null; }
  };
}

/** Runs `body` over the editor's states: under the session's watch, or, before one stands (a
 *  headless world), under a watch of its own released as it returns. */
function watched<T>(body: () => T): T {
  const release = watchBackStack();
  try { return body(); } finally { release(); }
}

/** Backs out of the newest state that still stands, as Escape, a step's Cancel and Android's back do;
 *  whether anything took the press. */
export function backOut(): boolean {
  return watched(() => backOutOfStack());
}

/** Runs what Delete means now (`platform/input/back-stack.ts:deleteMeaning`). */
export function deleteInFront(): void {
  watched(() => deleteMeaning()?.());
}

/** Hears the back key as the keymap binds `BACK_COMMAND`, in fields and under windows too, over the
 *  editor's states (`watchBackStack`), for as long as held: rebinding it moves every back-out, and
 *  with it unbound plain Escape still closes a floating surface in front. Returns the release. */
export function watchBackKey(): () => void {
  const unwatch = watchBackStack();
  const unset = setBackKey((e) => {
    const combo = effectiveCombo(useKeybinds.getState().overrides, BACK_COMMAND);
    if (combo === null) return plainEscape(e) ? 'surfaces' : null;
    return comboFromEvent(e) === normalizeCombo(combo) ? 'all' : null;
  });
  const release = holdBackKey();
  return () => { release(); unset(); unwatch(); };
}
