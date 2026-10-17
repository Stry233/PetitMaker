/*
 * The command `RUN` bodies — what each keyboard operation does. The identity half (id, category,
 * label, default combo, continuous) lives in `state/keymap/registry.ts`, which
 * `view`'s held-key pan loop reads directly; `COMMANDS` here zips that data with `RUN` so both
 * the shortcut engine (ui/shell/use-editor-shortcuts) and the keyboard page (ui/chrome/modals/keyboard) keep
 * reading one list. Adding an operation is one entry in each of the two files.
 *
 * `run(ctx)` receives the menu toggle the mounted shell answers; everything else is read from the
 * global store / active view.
 */
import { useEditorStore } from '../../state/store';
import { singleSelection, selectedObjectIds } from '../../state/selection';
import { getActiveToolManager } from '../../view/active-view';
import { cancelCarry } from '../../view/interaction/pointer/carry';
import { getCatalogItem } from '../../state/catalog';
import { activeToolOf, armedItemOf, armedMacroOf, brushSizeOf, buildShapeOf, buildToolOf, designModeOf, isAnnotating, BUILD_SHAPES, toggleBuildTool, type ContentType, type BuildShape, clampBrushSize, holdsSelection } from '../../state/editing/edit-mode';
import { pressSmartBuild } from './smart-build';
import { editorCurves } from '../session/tool-wiring';
import { cancelPendingRegion, undoPendingRegionStep } from '../../tools/pointer/region';
import { host } from '../host/host';
import { ALIASES, COMMAND_META, PLANET_SESSION_COMMANDS, REPAIR_SESSION_COMMANDS, type CommandMeta, type RunCommandId } from '../../state/keymap/registry';
import { effectiveCombo, type Overrides } from '../../state/keymap/resolve';
import { deleteSelection, rotateSelection } from '../editing/group-edit';
import { translate } from '../../i18n/context';
import { showToast } from '../../platform/channels/toast-bus';
import { ACTION_BY_ID, openBuildSurface, runTileAction } from './actions';
import { turnRotation } from '../../core/model/types';
import { NEXT_AUTO_EDGE_CUT, type DesignMode } from '../../state/editing/vocabulary';
import { CONTEXT_KEYS, isNotesContext, keyContext, type ContextualCommandId, type KeyAction, type KeyContext, type ToolbarContext } from '../../state/keymap/toolbar';
import { chipTextSize, type ZoneTextSize } from '../../core/model/annotations';
import { CHIP_TEXT_SIZES, ZONE_TEXT_SIZES } from '../../tools/pointer/annotate/index';
import { ELEVATION_MAX } from '../../core/game/profile';
import { hasWebGL2 } from '../../platform/device/device-quality';

/** What the handlers can't get from the global store, supplied by the mounted shell. */
export interface CommandContext {
  /** Open the shell's menu, or put it away. Answered by the shell rather than by a store flag,
   *  because the menu's open state lives in the shell's own React state alongside what opening it
   *  implies (the restore offer is retired, since opening the menu means "start fresh"). */
  toggleMenu: () => void;
}

export interface EditorCommand extends CommandMeta {
  run: (ctx: CommandContext) => void;
}

/* ── shared run-helpers (global store / active view) ─────────────────────── */

const store = () => useEditorStore.getState();
const doTile = (id: string): void => { const a = ACTION_BY_ID.get(id); if (a) runTileAction(a); };

/** A build-surface key. Its tile action names the surface's mode; pressing it while that mode is
 *  already in force runs the `move` tile instead, which is the rest every shell already answers. */
function surfaceKey(id: string): void {
  const action = ACTION_BY_ID.get(id);
  if (!action) return;
  doTile(store().editMode.mode === (action.payload as ContentType) ? 'move' : id);
}

/** Where a key acts now (`state/keymap/toolbar.ts:keyContext`). */
const contextNow = (): KeyContext => keyContext(store());

/** A design mode's bar, or the tool put down when that mode is already up. */
function openBuild(mode: DesignMode): void {
  const s = store();
  if (designModeOf(s) === mode) s.setEditMode({ arm: { kind: 'none' } });
  else openBuildSurface(mode);
}

/** The text size an armed zone or chip steps to next. */
function stepNoteSize(): void {
  const s = store();
  const zone = s.annotationTool === 'zone';
  const sizes: readonly ZoneTextSize[] = zone ? ZONE_TEXT_SIZES : CHIP_TEXT_SIZES;
  const at = zone ? s.annotationSize : chipTextSize(s.annotationSize);
  s.setAnnotationSize(sizes[(sizes.indexOf(at) + 1) % sizes.length]!);
}

/** Runs one `KeyAction`. */
function runAction(action: KeyAction): void {
  const s = store();
  switch (action.do) {
    case 'build-tool': s.setEditMode({ arm: toggleBuildTool({ tool: buildToolOf(s), shape: buildShapeOf(s) }, action.tool) }); return;
    case 'open-build': openBuild(action.mode); return;
    case 'region-tool': {
      const tool = action.tool === 'brush' ? s.regionBrushShape : 'erase';
      if (s.regionRequest.tools.includes(tool)) s.setRegionTool(tool);
      return;
    }
    case 'note-tool': s.toggleAnnotationTool(action.tool); return;
    case 'smart-build': pressSmartBuild(); return;
    case 'auto-edge-cut':
      if (buildToolOf(s) === 'brush' || buildToolOf(s) === 'shape' || buildToolOf(s) === 'erase') s.setAutoEdgeCut(NEXT_AUTO_EDGE_CUT[s.autoEdgeCut]);
      return;
    case 'region-dimensions': s.setRegionDimensions(!s.regionDimensions); return;
    case 'note-size': stepNoteSize(); return;
    case 'route-dashes': s.setAnnotationRouteDashed(!s.annotationRouteDashed); return;
  }
}

/** A contextual key: the action its context's `CONTEXT_KEYS` row names, if any. */
const contextual = (id: ContextualCommandId) => (): void => {
  const action = CONTEXT_KEYS[contextNow()][id]?.action;
  if (action) runAction(action);
};

function shapeKey(shape: BuildShape): void {
  const s = store();
  const context = keyContext(s);
  if (context === 'region') {
    if (s.regionTool !== 'erase' && s.regionRequest.tools.includes(shape)) s.setRegionTool(shape);
  } else if (isNotesContext(context)) {
    if (s.annotationTool === 'zone') s.setAnnotationZoneShape(shape);
    else if (s.annotationTool === 'erase') s.setEraserShape(shape);
  } else if (context === 'map') {
    openBuild(shape);
  } else if (buildToolOf(s) === 'erase') {
    s.setEraserShape(shape);
  } else if (buildToolOf(s) === 'brush' || buildToolOf(s) === 'shape') {
    s.setEditMode({ arm: shape === 'free' ? { kind: 'brush' } : { kind: 'shape', shape } });
  }
}

function resizeBrush(delta: number): void {
  const s = store();
  const context = keyContext(s);
  if (context === 'region') s.setRegionBrushSize(clampBrushSize(s.regionBrushSize + delta));
  else if (context === 'notes-route') s.setAnnotationRouteWidth(clampBrushSize(s.annotationRouteWidth + delta));
  else s.setBrushSize(clampBrushSize(brushSizeOf(s) + delta));
}

/** Turn the armed item's pending placement (its ghost, not yet on the map) — the shortcut fires
 *  only with nothing selected (see `rotateArmedOrSelected`). Silently a no-op for a non-rotatable
 *  item: pressing a rotate key on a thing that doesn't rotate isn't a mistake worth a toast for,
 *  and it must never write a rotation a later placement could pick up. */
function rotatePendingPlacement(delta: 90 | -90): void {
  const s = store();
  const itemId = s.editMode.mode === 'road' ? s.tileMaterial : armedItemOf(s);
  if (!itemId || !getCatalogItem(itemId)?.rotatable) return;
  const to = turnRotation(s.placementRotation, delta / 90);
  s.setPlacementRotation(to);
}

/**
 * Rotate shortcut dispatch. A non-empty selection always wins over the armed item's ghost: it is a
 * deliberate act with a visible result (the selection marks), and clicking an object while an item is
 * armed exists precisely so it can be rotated or deleted without losing that armed item — the
 * shortcut has to reach the selection, or that whole affordance is a trap. The ghost only turns
 * when there is truly nothing selected to apply it to instead.
 */
function rotateArmedOrSelected(delta: 90 | -90): void {
  const s = store();
  if (s.selection.length > 0) rotateSelection(delta);
  else rotatePendingPlacement(delta);
}

/** A multi-click gesture in progress (the curve's anchors, the map tool's or the region brush's)
 *  answers these keys first: while one is being drawn, Escape and Delete plainly mean "that thing I
 *  am drawing", not the selection. */
function pendingGesture(): { cancel: () => boolean; undoStep: () => boolean } {
  const mgr = getActiveToolManager();
  const tool = mgr?.getActiveTool();
  const ctx = mgr?.getContext();
  return {
    cancel: () => cancelPendingRegion() || (tool && ctx ? tool.cancelPending?.(ctx) === true : false),
    undoStep: () => undoPendingRegionStep() || (tool && ctx ? tool.undoPendingStep?.(ctx) === true : false),
  };
}

function deleteSelected(): void {
  const s = store();
  if (pendingGesture().undoStep()) return;
  // In annotate mode the key means the selected note; the layer's lock answers here as it does at
  // the tool, and there is no confirm step — a note is planning ink, one ⌘Z from back.
  if (isAnnotating(s)) {
    if (s.annotationSelection.length === 0) return;
    if (s.gridState?.annotations?.locked) { showToast(translate('annot.locked'), 'warning'); return; }
    editorCurves.end();
    s.removeAnnotations(s.annotationSelection);
    return;
  }
  if (s.deletePopover) return;
  // The delete popover confirms one block, so a single selection still routes through it.
  const sel = singleSelection(s.selection);
  if (sel) {
    if (sel.kind === 'terrain' && !s.gridState?.cells[sel.y]?.[sel.x]?.terrain) return;
    s.setDeletePopover(sel);
    return;
  }
  // A plural selection has no confirm step: `deleteSelection` applies to what it can and keeps the rest.
  const ids = selectedObjectIds(s.selection);
  if (ids.length > 0) deleteSelection(translate, ids);
}

/** Notes and terrain disarm with their draft; catalog placement disarms before clearing selection. */
function deselect(): void {
  const s = store();
  if (s.contextMenu || s.deletePopover) return; // those own their own dismiss
  // A card carried to the map goes back to the shelf, with the arming it borrowed.
  if (cancelCarry()) return;
  if (isAnnotating(s)) {
    s.requestAnnotationDiscard(() => {
      pendingGesture().cancel();
      s.setAnnotationTool('none');
      s.setAnnotationSelection([]);
    });
    return;
  }
  const cancelled = pendingGesture().cancel();
  if (keyContext(s) === 'terrain' && buildToolOf(s) !== 'none') { s.setEditMode({ arm: { kind: 'none' } }); return; }
  if (cancelled) return;
  if (armedItemOf(s)) { s.setEditMode({ arm: { kind: 'none' } }); return; }
  // A surface's macro goes back to that surface's brush; the shelf's planting card leaves nothing armed.
  if (armedMacroOf(s)) { s.setEditMode({ arm: buildToolOf(s) === 'smart' ? { kind: 'brush' } : { kind: 'none' } }); return; }
  s.clearSelection();
}

function selectAllObjects(): void {
  const s = store();
  if (!s.gridState) return;
  // In annotate mode the key means the notes. The drawing tool goes away first — grabbing lives
  // in the bare state, and putting a tool down clears the selection, so the set is made after.
  // A hidden layer offers nothing to select, the same answer it gives the pointer.
  if (isAnnotating(s)) {
    const notes = s.gridState.annotations;
    if (!notes?.visible || notes.items.length === 0) return;
    s.requestAnnotationDiscard(() => {
      s.setAnnotationTool('none');
      s.setAnnotationSelection(notes.items.map((a) => a.id));
    });
    return;
  }
  // Select-all means entering selection: the store keeps no selection under a macro (and puts a
  // brush away itself), so the command puts the tool away first. The mode itself stays: this is
  // the same "leave the brush, keep the surface" move a selection gesture makes.
  if (!holdsSelection(activeToolOf(s))) s.setEditMode({ arm: { kind: 'none' } });
  // Every object, including locked ones (refusing to modify one is the rule's job, not
  // selection's). Terrain is never part of a select-all.
  s.setSelection([...s.gridState.objects.keys()].map((id) => ({ kind: 'object', id }) as const));
}

/* ── run bodies, keyed by command id ─────────────────────────────────────── */

export const RUN: Record<RunCommandId, (ctx: CommandContext) => void> = {
  'surface.mountain': () => surfaceKey('mountain'),
  'surface.river':    () => surfaceKey('river'),
  'surface.road':     () => surfaceKey('road'),

  // Move is the rest state, so it has nothing of its own to put away and pressing it twice is
  // pressing it once.
  'tool.move':   () => doTile('move'),
  'tool.brush':   contextual('tool.brush'),
  'tool.erase':   contextual('tool.erase'),
  'tool.trim':    contextual('tool.trim'),
  'tool.smart':   contextual('tool.smart'),
  'tool.measure': contextual('tool.measure'),
  'tool.option_cycle': contextual('tool.option_cycle'),
  'tool.shape_cycle': () => {
    const s = store();
    const context = keyContext(s);
    if (context === 'region') {
      const shapes = s.regionRequest.tools.filter(tool => tool !== 'erase');
      if (s.regionTool !== 'erase' && shapes.length) s.setRegionTool(shapes[(shapes.indexOf(s.regionTool) + 1) % shapes.length]!);
      return;
    }
    const shape = isNotesContext(context)
      ? (s.annotationTool === 'zone' ? s.annotationZoneShape : s.annotationTool === 'erase' ? s.eraserShape : null)
      : context === 'terrain' ? (buildToolOf(s) === 'erase' ? s.eraserShape : buildShapeOf(s)) : null;
    if (shape) shapeKey(BUILD_SHAPES[(BUILD_SHAPES.indexOf(shape) + 1) % BUILD_SHAPES.length]!);
  },
  'tool.free':   () => shapeKey('free'),
  'tool.rect':   () => shapeKey('rect'),
  'tool.circle': () => shapeKey('circle'),
  'tool.line':   () => shapeKey('line'),
  'tool.curve':  () => shapeKey('curve'),

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

  'view.toggle': () => {
    const s = store();
    // Without WebGL2 the scene cannot build, so the press says so instead of making the round trip.
    if (s.viewMode === '2d' && !hasWebGL2()) { showToast(translate('view3d.unavailable'), 'error'); return; }
    s.setViewMode(s.viewMode === '2d' ? '3d' : '2d');
  },

  // Region selection and Notes keep undo and redo in their own lane for the whole mode, and an
  // empty lane is a no-op rather than a fall-through to the map's history.
  'history.undo': () => {
    const s = store();
    if (s.selectingRegion) { s.undoRegion(); return; }
    if (isAnnotating(s)) { editorCurves.end(); s.undoAnnotation(); return; }
    s.commandExecutor?.undo();
  },
  'history.redo': () => {
    const s = store();
    if (s.selectingRegion) { s.redoRegion(); return; }
    if (isAnnotating(s)) { editorCurves.end(); s.redoAnnotation(); return; }
    s.commandExecutor?.redo();
  },

  // Generate is one of the mode blocks, so its key toggles like the others.
  'app.generate':      () => doTile(store().editMode.mode === 'generate' ? 'move' : 'generate'),
  'app.new':            () => doTile('new'),
  'app.export_json':    () => doTile('export'),
  'app.export_image':   () => doTile('image'),
  'app.help': () => store().setModal('help', true),
  'app.menu': (c) => c.toggleMenu(),

  'overlay.grid':    () => { store().toggleGrid(); },
  'overlay.numbers': () => { const s = store(); s.setShowLayerNumbers(!s.showLayerNumbers); },
  'overlay.chunks':  () => { const s = store(); s.setShowChunkBounds(!s.showChunkBounds); },
};

/** Whether the discrete engine runs `id`; held and listener commands have no body. */
export function hasRunBody(id: string): id is RunCommandId {
  return Object.prototype.hasOwnProperty.call(RUN, id);
}

const answeredElsewhere = (): void => {};

export const COMMANDS: readonly EditorCommand[] = COMMAND_META.map((meta) => ({
  ...meta,
  run: hasRunBody(meta.id) ? RUN[meta.id] : answeredElsewhere,
}));

export const COMMAND_BY_ID: ReadonlyMap<string, EditorCommand> = new Map(COMMANDS.map((c) => [c.id, c]));

/** A combo the discrete engine registers, and what pressing it runs. */
export interface KeyBinding {
  combo: string;
  run: () => void;
}

/** Runs `id` unless a planet session or a hand repair is open and does not answer it
 *  (`PLANET_SESSION_COMMANDS`, `REPAIR_SESSION_COMMANDS`). */
const answers = (id: string): boolean => {
  const s = store();
  if (s.repairSession?.phase === 'hand') return REPAIR_SESSION_COMMANDS.has(id);
  return !s.planetSession || PLANET_SESSION_COMMANDS.has(id);
};

/**
 * The discrete engine's bindings under `overrides` in `toolbar`: every command with a run body on
 * its effective combo, then the fixed aliases. Held commands are the held-key loop's, and a listener
 * command's combo is left to its listener, whose press a match here would swallow. A command a planet
 * session does not answer keeps its key there and does nothing.
 */
export function keyBindings(overrides: Overrides, toolbar: ToolbarContext, ctx: CommandContext): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  const bind = (combo: string, cmd: EditorCommand): void => {
    bindings.push({ combo, run: () => { if (answers(cmd.id)) cmd.run(ctx); } });
  };
  for (const cmd of COMMANDS) {
    if (cmd.continuous || !hasRunBody(cmd.id)) continue;
    const combo = effectiveCombo(overrides, cmd.id, toolbar);
    if (combo) bind(combo, cmd);
  }
  for (const alias of ALIASES) {
    const cmd = COMMAND_BY_ID.get(alias.commandId);
    if (cmd && !cmd.continuous) bind(alias.combo, cmd);
  }
  return bindings;
}
