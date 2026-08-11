/*
 * The command RUN bodies — what each keyboard operation does. The identity half (id, category,
 * label, default combo, reserved, continuous) lives in `core/runtime/keybindings.ts`, which
 * `canvas`'s held-key pan loop reads directly; `COMMANDS` here zips that data with `RUN` so both
 * the shortcut engine (ui/shell/use-editor-shortcuts) and the keyboard page (ui/chrome/modals/keyboard) keep
 * reading one list. Adding an operation is one entry in each of the two files.
 *
 * `run(ctx)` receives the few React-provided deps; everything else is read from the global store /
 * active view.
 */
import { useEditorStore } from '../state/store';
import { singleSelection, selectedObjectIds } from '../state/selection';
import { getActiveToolManager } from '../canvas/active-view';
import { getCatalogItem } from '../state/catalog';
import { ELEVATION_MAX } from '../core/model/constants';
import { MODE_FOR_CONTENT, type ContentType } from '../core/model/edit-mode';
import { canHoldSelection } from '../core/interaction/tool-modes';
import { pressSmartBuild } from '../core/runtime/smart-build';
import { host } from './host';
import { COMMAND_META, type CommandMeta } from '../core/runtime/keybindings';
import { rotateGroupAction, rotateObjectAction, deleteSelection } from './group-edit';
import { translate } from '../i18n/context';
import { ACTION_BY_ID, type EditorAction } from './actions';
import type { DesignMode } from '../core/model/types';

/** Deps the handlers can't get from the global store — supplied by the mounted shell. */
export interface CommandContext {
  openBuild: (mode: DesignMode) => void;
  handleTileAction: (action: EditorAction) => void;
  /** Open the shell's menu, or put it away. Answered by the shell rather than by a store flag,
   *  because the menu's open state lives in the shell's own React state alongside what opening it
   *  implies (the restore offer is retired, since opening the menu means "start fresh"). */
  toggleMenu: () => void;
  /** Pop the Generate region's OWN undo/redo stack (ui/shell/use-region-brush) — a painted
   *  region is a scope for a future generate, not a map edit, so it keeps a history
   *  separate from the command executor's. Return false when there was nothing to pop
   *  (see history.undo/redo below for what that means). Undefined only where no region
   *  brush is mounted (e.g. a bare test context) — those callers never set
   *  `selectingRegion`, so it's never reached. */
  regionUndo?: () => boolean;
  regionRedo?: () => boolean;
}

export interface EditorCommand extends CommandMeta {
  run: (ctx: CommandContext) => void;
}

/* ── shared run-helpers (global store / active view) ─────────────────────── */

const store = () => useEditorStore.getState();
const doTile = (c: CommandContext, id: string): void => { const a = ACTION_BY_ID.get(id); if (a) c.handleTileAction(a); };

/*
 * A KEY THAT CHOOSES SOMETHING PUTS IT AWAY AGAIN, because the control it stands for does. Pressing
 * a chosen mode leaves the mode; pressing an armed tool leaves the tool. A key that only ever set
 * was the odd one out, and a visitor who reached for it to undo a choice found it did nothing.
 *
 * THE TWO RETREATS ARE NOT THE SAME, and `core/model/edit-mode.ts:resolveEditMode` is where both
 * live. Leaving a MODE is `mode: null` — rest, with the mode's bar gone. Leaving a TOOL is
 * `tool: 'none'` — the surface still chosen and its bar still up, with nothing armed on the map, so
 * the next press on the same content resumes where it left off.
 *
 * Which of the two applies is read from the store each time. It is the same fact the bar lights its
 * active cell from and the same fact the map arms its tool from, so there is nothing here to keep
 * in step with anything.
 */

/** A build-surface key. Its tile action names a CONTENT type, so the mode it lands on is whatever
 *  `MODE_FOR_CONTENT` derives from that; pressing it while that mode is already in force runs the
 *  `move` tile instead, which is the rest every shell already answers. */
function surfaceKey(c: CommandContext, id: string): void {
  const action = ACTION_BY_ID.get(id);
  if (!action) return;
  doTile(c, store().editMode.mode === MODE_FOR_CONTENT[action.payload as ContentType] ? 'move' : id);
}

/** A tool key. `designMode` is the tool the map is on, so a key naming the one already there puts it
 *  away instead — written to the store rather than sent through `openBuild`, because that verb also
 *  decides a SURFACE and putting a tool down is not a reason to move to another one. */
function toolKey(c: CommandContext, design: DesignMode): void {
  if (store().designMode === design) { store().setEditMode({ tool: 'none' }); return; }
  c.openBuild(design);
}

function rotateSelected(delta: 90 | -90): void {
  const s = store();
  if (!s.gridState || !s.commandExecutor) return;
  // A PLURAL selection is a rigid-body transform, not N spins in place: route it through the exact
  // call path the SelectionHandles rotate button uses (`kit/group-edit.ts`), so the arc
  // animation and any refusal (a locked member, a non-square span, an illegal destination) are
  // identical whether the turn came from a click or this shortcut.
  if (s.selection.length > 1) {
    rotateGroupAction(s.commandExecutor, s.gridState, s.eventBus, selectedObjectIds(s.selection), delta === 90 ? 1 : -1);
    return;
  }
  const sel = singleSelection(s.selection);
  if (sel?.kind !== 'object') return;
  const cur = s.gridState.objects.get(sel.id);
  if (!cur || !getCatalogItem(cur.catalogId)?.rotatable) return;
  const to = ((((cur.rotation + delta) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  rotateObjectAction(s.commandExecutor, s.gridState, s.eventBus, cur, to, { from: cur.rotation, to: cur.rotation + delta });
}

/** Turn the ARMED item's pending placement (its ghost, not yet on the map) — the shortcut fires
 *  only with nothing selected (see `rotateArmedOrSelected`). Silently a no-op for a non-rotatable
 *  item: pressing a rotate key on a thing that doesn't rotate isn't a mistake worth a toast for,
 *  and it must never write a rotation a later placement could pick up. */
function rotatePendingPlacement(delta: 90 | -90): void {
  const s = store();
  if (!s.selectedItemId || !getCatalogItem(s.selectedItemId)?.rotatable) return;
  const to = ((((s.placementRotation + delta) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  s.setPlacementRotation(to);
}

/**
 * Rotate shortcut dispatch. A non-empty SELECTION always wins over the armed item's ghost: it is a
 * deliberate act with a visible result (the orange ring), and clicking an object while an item is
 * armed exists precisely so it can be rotated or deleted without losing that armed item — the
 * shortcut has to reach the selection, or that whole affordance is a trap. The ghost only turns
 * when there is truly nothing selected to apply it to instead.
 */
function rotateArmedOrSelected(delta: 90 | -90): void {
  const s = store();
  if (s.selection.length > 0) rotateSelected(delta);
  else rotatePendingPlacement(delta);
}

/** A multi-click gesture in progress (the curve's anchors) answers these keys first: while one is
 *  being drawn, Escape and Delete plainly mean "that thing I am drawing", not the selection. */
function pendingGesture(): { cancel: () => boolean; undoStep: () => boolean } {
  const mgr = getActiveToolManager();
  const tool = mgr?.getActiveTool();
  const ctx = mgr?.getContext();
  return {
    cancel: () => (tool && ctx ? tool.cancelPending?.(ctx) === true : false),
    undoStep: () => (tool && ctx ? tool.undoPendingStep?.(ctx) === true : false),
  };
}

function deleteSelected(): void {
  const s = store();
  if (pendingGesture().undoStep()) return;
  if (s.deletePopover) return;
  // The delete popover confirms ONE block, so a single selection still routes through it.
  const sel = singleSelection(s.selection);
  if (sel) {
    if (sel.kind === 'terrain' && !s.gridState?.cells[sel.y]?.[sel.x]?.terrain) return;
    s.setDeletePopover(sel);
    return;
  }
  // A plural selection has no confirm step: `deleteSelection` applies to what it can and keeps the rest.
  const gridState = s.gridState;
  if (!gridState || !s.commandExecutor) return;
  const ids = selectedObjectIds(s.selection);
  if (ids.length === 0) return;
  deleteSelection(s.commandExecutor, gridState, s.eventBus, translate, ids);
}

/**
 * Escape puts down whatever is currently "held": a curve being drawn, then an ARMED catalog item
 * or macro, then the selection.
 *
 * One at a time, the armed thing first, because they are two different things to be rid of and the
 * armed one is what the pointer is about to act on — clearing both at once would take a selection
 * the user still wanted while they were only trying to stop placing. Without this command,
 * disarming means a trip back to the panel to click the item off.
 */
function deselect(): void {
  const s = store();
  if (s.contextMenu || s.deletePopover) return; // those own their own dismiss
  if (pendingGesture().cancel()) return;
  if (s.selectedItemId) { s.setEditMode({ itemId: null }); return; }
  if (s.armedMacro) { s.setEditMode({ macro: null, ...(s.editMode.tool === 'smart' ? { tool: 'brush' as const } : {}) }); return; }
  s.clearSelection();
}

function selectAllObjects(): void {
  const s = store();
  if (!s.gridState) return;
  // Select-all MEANS entering selection: with a brush or a macro armed the mode rule would drop
  // the set the moment it was made (`selection-view-sync`), so the command puts the tool away
  // first. The mode itself stays — this is the same "leave the brush, keep the surface" move a
  // selection gesture makes.
  if (!canHoldSelection(s.activeTool)) s.setEditMode({ tool: 'none', itemId: null, macro: null });
  // Every object, INCLUDING locked ones (refusing to modify one is the rule's job, not
  // selection's). Terrain is never part of a select-all.
  s.setSelection([...s.gridState.objects.keys()].map((id) => ({ kind: 'object', id }) as const));
}

/* ── run bodies, keyed by command id ─────────────────────────────────────── */

export const RUN: Record<string, (ctx: CommandContext) => void> = {
  'surface.mountain': (c) => surfaceKey(c, 'mountain'),
  'surface.river':    (c) => surfaceKey(c, 'river'),
  'surface.road':     (c) => surfaceKey(c, 'road'),

  // Move IS the rest state, so it has nothing of its own to put away and pressing it twice is
  // pressing it once.
  'tool.move':   (c) => doTile(c, 'move'),
  'tool.brush':  (c) => toolKey(c, 'brush'),
  'tool.eraser': (c) => toolKey(c, 'eraser'),
  'tool.rect':   (c) => toolKey(c, 'rect'),
  'tool.circle': (c) => toolKey(c, 'circle'),
  'tool.line':   (c) => toolKey(c, 'line'),
  'tool.curve':  (c) => toolKey(c, 'curve'),
  'tool.edgecut': (c) => toolKey(c, 'edge-cut'),
  // Smart build is not a tool the map arms, so there is no armed state to read: it is a proposal
  // the cell opens, and the cell answers a second press by putting it away itself.
  'tool.smart':  () => pressSmartBuild(),

  'brush.bigger':  () => { const s = store(); s.setBrushSize(Math.min(5, s.brushSize + 1)); },
  'brush.smaller': () => { const s = store(); s.setBrushSize(Math.max(1, s.brushSize - 1)); },
  'layer.up':      () => { const s = store(); s.setActiveLayer(Math.min(ELEVATION_MAX, s.activeLayer + 1)); },
  'layer.down':    () => { const s = store(); s.setActiveLayer(Math.max(0, s.activeLayer - 1)); },

  'selection.rotate_cw':  () => rotateArmedOrSelected(90),
  'selection.rotate_ccw': () => rotateArmedOrSelected(-90),
  'selection.delete':     () => deleteSelected(),
  'selection.deselect':   () => deselect(),
  'selection.all':        () => selectAllObjects(),

  'camera.zoom_in':  () => host.camera.zoomIn(),
  'camera.zoom_out': () => host.camera.zoomOut(),
  'camera.fit':      () => host.camera.fit(),

  'view.toggle': () => { const s = store(); s.setViewMode(s.viewMode === '2d' ? '3d' : '2d'); },

  // While painting a Generate region, Ctrl+Z/Y undo the region stroke instead of a map edit (see
  // CommandContext.regionUndo): the region is a scope for a future generate, not a change to the
  // map, so undoing twice after painting one must never reach back and revert a real edit the user
  // never meant to touch. Scoped to the region for the FULL duration of region-select mode, even
  // once its own stack empties (regionUndo/Redo return false then) — falling through to the map
  // history at that point would be the same surprise one step later, so it stays a no-op instead,
  // exactly like pressing undo on an empty map history already does.
  'history.undo': (c) => { if (store().selectingRegion) c.regionUndo?.(); else store().commandExecutor?.undo(); },
  'history.redo': (c) => { if (store().selectingRegion) c.regionRedo?.(); else store().commandExecutor?.redo(); },

  // Generate is one of the mode blocks, so its key toggles like the other four.
  'app.generate':      (c) => doTile(c, store().editMode.mode === 'generate' ? 'move' : 'generate'),
  'app.new':            (c) => doTile(c, 'new'),
  'app.export_json':    (c) => doTile(c, 'export'),
  'app.export_image':   (c) => doTile(c, 'image'),
  'app.help': () => store().setModal('help', true),
  'app.menu': (c) => c.toggleMenu(),

  'overlay.grid':    () => { const s = store(); s.setShowGrid(!s.showGrid); },
  'overlay.numbers': () => { const s = store(); s.setShowLayerNumbers(!s.showLayerNumbers); },
  'overlay.chunks':  () => { const s = store(); s.setShowChunkBounds(!s.showChunkBounds); },
};

export const COMMANDS: readonly EditorCommand[] = COMMAND_META.map((meta) => ({
  ...meta,
  run: RUN[meta.id] ?? (() => {}), // `continuous` commands are driven by the rAF loop, not here
}));

export const COMMAND_BY_ID: ReadonlyMap<string, EditorCommand> = new Map(COMMANDS.map((c) => [c.id, c]));
