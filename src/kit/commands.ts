/*
 * The command RUN bodies — what each keyboard operation does. The identity half (id, category,
 * label, default combo, continuous) lives in `core/runtime/keybindings.ts`, which
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
import { turnsInSession } from './operations/planet-session';
import { BUILD_SHAPES, MODE_FOR_CONTENT, toggleBuildTool, type ContentType, type BuildShape, clampBrushSize } from '../core/model/edit-mode';
import { canHoldSelection } from '../core/interaction/tool-modes';
import { regionTools } from '../core/runtime/region-brush';
import { pressSmartBuild } from '../core/runtime/smart-build';
import { endCurveSession } from '../tools/paint';
import { host } from './host';
import { COMMAND_META, type CommandMeta } from '../core/runtime/keybindings';
import { rotateGroupAction, rotateObjectAction, rotateSessionPlazaAction, deleteSelection } from './group-edit';
import { translate } from '../i18n/context';
import { showToast } from '../core/runtime/toast-bus';
import { ACTION_BY_ID, type EditorAction } from './actions';
import { NEXT_AUTO_EDGE_CUT, type DesignMode, turnRotation } from '../core/model/types';
import type { AnnotationTool } from '../core/model/annotations';
import { ELEVATION_MAX } from '../core/model/game-profile';

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

/** A build-surface key. Its tile action names a CONTENT type, so the mode it lands on is whatever
 *  `MODE_FOR_CONTENT` derives from that; pressing it while that mode is already in force runs the
 *  `move` tile instead, which is the rest every shell already answers. */
function surfaceKey(c: CommandContext, id: string): void {
  const action = ACTION_BY_ID.get(id);
  if (!action) return;
  doTile(c, store().editMode.mode === MODE_FOR_CONTENT[action.payload as ContentType] ? 'move' : id);
}

/** Shared tool commands act on notes while the annotation surface is active. */
const ANNOTATE_ARM: Partial<Record<DesignMode, Exclude<AnnotationTool, 'none'>>> = {
  brush: 'zone',
  eraser: 'erase',
  'edge-cut': 'chip',
};

function toolKey(c: CommandContext, design: DesignMode): void {
  const s = store();
  if (s.selectingRegion) {
    const tool = design === 'brush' ? s.regionBrushShape : design;
    if (regionTools().some(value => value === tool)) s.setRegionTool(tool as typeof s.regionTool);
    return;
  }
  if (s.editMode.mode === 'annotate') {
    const arm = ANNOTATE_ARM[design];
    if (arm) s.toggleAnnotationTool(arm);
    return;
  }
  if (terrainToolActive() && (design === 'eraser' || design === 'edge-cut')) {
    s.setEditMode(toggleBuildTool(s.editMode, design === 'eraser' ? 'erase' : 'trim')); return;
  }
  if (s.designMode === design) { s.setEditMode({ tool: 'none' }); return; }
  c.openBuild(design);
}

function terrainToolActive(): boolean {
  const s = store();
  return !s.selectingRegion && (s.editMode.mode === 'mountain' || s.editMode.mode === 'water' || s.editMode.mode === 'road');
}

function brushKey(c: CommandContext): void {
  const s = store();
  if (!terrainToolActive()) { toolKey(c, 'brush'); return; }
  s.setEditMode(toggleBuildTool(s.editMode, 'brush'));
}

function shapeKey(c: CommandContext, shape: BuildShape): void {
  const s = store();
  if (s.selectingRegion) {
    const tool = shape === 'free' ? 'brush' : shape;
    if (s.regionTool !== 'eraser' && regionTools().includes(tool)) s.setRegionTool(tool);
    return;
  }
  if (s.editMode.mode === 'annotate') {
    if (s.annotationTool === 'zone') s.setAnnotationZoneShape(shape);
    return;
  }
  if (!terrainToolActive()) { toolKey(c, shape === 'free' ? 'brush' : shape); return; }
  if (s.editMode.tool === 'erase') s.setEraserShape(shape === 'free' ? 'dot' : shape);
  else if (s.editMode.tool === 'brush' || s.editMode.tool === 'shape') {
    s.setEditMode(shape === 'free' ? { tool: 'brush' } : { tool: 'shape', shape });
  }
}

function resizeBrush(delta: number): void {
  const s = store();
  if (s.selectingRegion) s.setRegionBrushSize(clampBrushSize(s.regionBrushSize + delta));
  else s.setBrushSize(clampBrushSize(s.brushSize + delta));
}

function rotateSelected(delta: 90 | -90): void {
  const s = store();
  if (!s.gridState || !s.commandExecutor) return;
  // A PLURAL selection is a rigid-body transform, not N spins in place: it goes through
  // `kit/group-edit.ts:rotateGroupAction`, so the arc animation and any refusal are identical
  // whether the turn came from a click or this shortcut.
  if (s.selection.length > 1) {
    rotateGroupAction(s.commandExecutor, s.gridState, s.eventBus, selectedObjectIds(s.selection), delta === 90 ? 1 : -1);
    return;
  }
  const sel = singleSelection(s.selection);
  if (sel?.kind !== 'object') return;
  const cur = s.gridState.objects.get(sel.id);
  if (turnsInSession(cur, s.planetSession !== null)) {
    rotateSessionPlazaAction(s.eventBus, delta === 90 ? 1 : 3);
    return;
  }
  if (!cur || !getCatalogItem(cur.catalogId)?.rotatable) return;
  const to = turnRotation(cur.rotation, delta / 90);
  rotateObjectAction(s.commandExecutor, s.gridState, s.eventBus, cur, to, { from: cur.rotation, to: cur.rotation + delta });
}

/** Turn the ARMED item's pending placement (its ghost, not yet on the map) — the shortcut fires
 *  only with nothing selected (see `rotateArmedOrSelected`). Silently a no-op for a non-rotatable
 *  item: pressing a rotate key on a thing that doesn't rotate isn't a mistake worth a toast for,
 *  and it must never write a rotation a later placement could pick up. */
function rotatePendingPlacement(delta: 90 | -90): void {
  const s = store();
  if (!s.selectedItemId || !getCatalogItem(s.selectedItemId)?.rotatable) return;
  const to = turnRotation(s.placementRotation, delta / 90);
  s.setPlacementRotation(to);
}

/**
 * Rotate shortcut dispatch. A non-empty SELECTION always wins over the armed item's ghost: it is a
 * deliberate act with a visible result (the selection marks), and clicking an object while an item is
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
  // In annotate mode the key means the selected NOTE; the layer's lock answers here as it does at
  // the tool, and there is no confirm step — a note is planning ink, one ⌘Z from back.
  if (s.editMode.mode === 'annotate') {
    if (s.annotationSelection.length === 0) return;
    if (s.gridState?.annotations?.locked) { showToast(translate('annot.locked'), 'warning'); return; }
    endCurveSession();
    s.removeAnnotations(s.annotationSelection);
    return;
  }
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

/** Notes and terrain disarm with their draft; catalog placement disarms before clearing selection. */
function deselect(): void {
  const s = store();
  if (s.contextMenu || s.deletePopover) return; // those own their own dismiss
  if (s.editMode.mode === 'annotate') {
    s.requestAnnotationDiscard(() => {
      pendingGesture().cancel();
      s.setAnnotationTool('none');
      s.setAnnotationSelection([]);
    });
    return;
  }
  const cancelled = pendingGesture().cancel();
  if (terrainToolActive() && s.editMode.tool !== 'none') { s.setEditMode({ tool: 'none' }); return; }
  if (cancelled) return;
  if (s.selectedItemId) { s.setEditMode({ itemId: null }); return; }
  if (s.armedMacro) { s.setEditMode({ macro: null, ...(s.editMode.tool === 'smart' ? { tool: 'brush' as const } : {}) }); return; }
  s.clearSelection();
}

function selectAllObjects(): void {
  const s = store();
  if (!s.gridState) return;
  // In annotate mode the key means the NOTES. The drawing tool goes away first — grabbing lives
  // in the bare state, and putting a tool down clears the selection, so the set is made after.
  // A hidden layer offers nothing to select, the same answer it gives the pointer.
  if (s.editMode.mode === 'annotate') {
    const notes = s.gridState.annotations;
    if (!notes?.visible || notes.items.length === 0) return;
    s.requestAnnotationDiscard(() => {
      s.setAnnotationTool('none');
      s.setAnnotationSelection(notes.items.map((a) => a.id));
    });
    return;
  }
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
  'tool.brush':  brushKey,
  'tool.measure': () => {
    const s = store();
    if (s.selectingRegion) return;
    if (s.editMode.mode === 'annotate') s.toggleAnnotationTool('measure');
  },
  'tool.shape_cycle': c => {
    const s = store();
    if (s.selectingRegion) {
      const shapes = regionTools().filter(tool => tool !== 'eraser');
      if (s.regionTool !== 'eraser' && shapes.length) s.setRegionTool(shapes[(shapes.indexOf(s.regionTool) + 1) % shapes.length]!);
      return;
    }
    if (s.editMode.mode === 'annotate') {
      if (s.annotationTool === 'zone') {
        shapeKey(c, BUILD_SHAPES[(BUILD_SHAPES.indexOf(s.annotationZoneShape) + 1) % BUILD_SHAPES.length]!);
      }
      return;
    }
    if (!terrainToolActive()) return;
    const shape = s.editMode.tool === 'erase' ? s.eraserShape === 'dot' ? 'free' : s.eraserShape : s.editMode.shape;
    shapeKey(c, BUILD_SHAPES[(BUILD_SHAPES.indexOf(shape) + 1) % BUILD_SHAPES.length]!);
  },
  'tool.free':   (c) => shapeKey(c, 'free'),
  'tool.eraser': (c) => toolKey(c, 'eraser'),
  'tool.rect':   (c) => shapeKey(c, 'rect'),
  'tool.circle': (c) => shapeKey(c, 'circle'),
  'tool.line':   (c) => shapeKey(c, 'line'),
  'tool.curve':  (c) => shapeKey(c, 'curve'),
  'tool.edgecut': (c) => toolKey(c, 'edge-cut'),
  'tool.smart':  () => {
    const s = store();
    if (s.selectingRegion) return;
    if (s.editMode.mode === 'annotate') {
      s.toggleAnnotationTool('route');
      return;
    }
    pressSmartBuild();
  },

  'tool.auto_trim': () => {
    const s = store();
    if (s.selectingRegion) { s.setRegionDimensions(!s.regionDimensions); return; }
    if (s.editMode.mode === 'annotate') {
      if (s.annotationTool === 'zone' || s.annotationTool === 'chip') {
        s.setAnnotationSize(s.annotationSize === 's' ? 'm' : s.annotationSize === 'm' ? 'l' : 's');
      } else if (s.annotationTool === 'route') s.setAnnotationRouteDashed(!s.annotationRouteDashed);
      return;
    }
    if (!terrainToolActive() || (s.editMode.tool !== 'brush' && s.editMode.tool !== 'shape' && s.editMode.tool !== 'erase')) return;
    s.setAutoEdgeCut(NEXT_AUTO_EDGE_CUT[s.autoEdgeCut]);
  },

  'brush.bigger':  () => resizeBrush(1),
  'brush.smaller': () => resizeBrush(-1),
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

  // Region-select and annotate mode each keep undo/redo in their own lane for the FULL duration of
  // the mode, even once that lane empties (see CommandContext.regionUndo): falling through to the
  // map history would revert an edit the user never meant to touch, so an empty lane is a no-op.
  'history.undo': (c) => {
    const s = store();
    if (s.selectingRegion) { c.regionUndo?.(); return; }
    if (s.editMode.mode === 'annotate') { endCurveSession(); s.undoAnnotation(); return; }
    s.commandExecutor?.undo();
  },
  'history.redo': (c) => {
    const s = store();
    if (s.selectingRegion) { c.regionRedo?.(); return; }
    if (s.editMode.mode === 'annotate') { endCurveSession(); s.redoAnnotation(); return; }
    s.commandExecutor?.redo();
  },

  // Generate is one of the mode blocks, so its key toggles like the others.
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
