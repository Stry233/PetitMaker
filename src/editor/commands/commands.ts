/*
 * The command `RUN` bodies and `FACTS` — what each keyboard operation does and what that is for
 * any caller; `run.ts` is the door that runs them by id beside the commands no key runs. The identity half (id, category,
 * label, default combo, continuous) lives in `state/keymap/registry.ts`, which
 * `view`'s held-key pan loop reads directly; `COMMANDS` here zips that data with `RUN` so both
 * the shortcut engine (ui/shell/use-editor-shortcuts) and the keyboard page (ui/chrome/modals/keyboard) keep
 * reading one list. Adding an operation is one entry in each of the two files.
 *
 * `run(ctx)` receives the menu toggle the mounted shell answers; everything else is read from the
 * global store / active view.
 */
import { useEditorStore, type EditorStore } from '../../state/store';
import { shownOn } from '../../state/selection';
import { cancelEditsInFlight, editsInFlight } from '../../state/edits-in-flight';
import { getCatalogItem } from '../../state/catalog';
import { activeToolOf, armedItemOf, brushSizeOf, buildShapeOf, buildToolOf, contentTypeOf, designModeOf, isAnnotating, BRUSH_SIZE, BUILD_SHAPES, toggleBuildTool, type BuildMode, type BuildShape, holdsSelection, takesThickness, TERRAIN_THICKNESSES } from '../../state/editing/edit-mode';
import { toggleSmartBuild } from './smart-build';
import { putArmedDown } from '../../state/editing/intent';
import { editorCurves } from '../session/tool-wiring';
import { host } from '../host/host';
import { ALIASES, BACK_COMMAND, COMMAND_META, MAP_EDIT_COMMANDS, type CommandMeta, type RunCommandId } from '../../state/keymap/registry';
import { framePose } from '../../state/frame-pose';
import { sessionKeyAnswers, sessionOffers } from '../../state/session-offer';
import { standInShown } from '../../state/map-stand-in';
import { effectiveCombo, reverseCombos, type Overrides } from '../../state/keymap/resolve';
import { stepIn, type CycleStep } from '../../core/base/cycle';
import { flipSelection, rotateSelection } from '../editing/group-edit';
import { copyKey, cutKey, pasteKey } from '../editing/clipboard';
import { flipArmedBlueprint, turnArmedBlueprint } from '../editing/blueprint';
import { backOut, deleteInFront } from '../back/back-out';
import { regionRequestOf } from '../../state/editing/region';
import { translate } from '../../i18n/context';
import { showToast } from '../../platform/channels/toast-bus';
import { ACTION_BY_ID, openBuildSurface, runTileAction, setMode } from './actions';
import { turnRotation } from '../../core/model/types';
import { AUTO_EDGE_CUTS, OBJECT_SPACING, type DesignMode } from '../../state/editing/vocabulary';
import { CONTEXT_KEYS, isNotesContext, keyContext, type ContextualCommandId, type KeyAction, type KeyContext, type ToolbarContext } from '../../state/keymap/toolbar';
import { chipTextSize, type ZoneTextSize } from '../../core/model/annotations';
import { CHIP_TEXT_SIZES, ZONE_TEXT_SIZES } from '../../tools/pointer/annotate/index';
import { hasWebGL2 } from '../../platform/device/device-quality';
import { uiZoomStep } from '../../platform/storage/prefs';
import { uiZoomReach } from '../../state/ui-zoom-reach';
import type { CommandContext, CommandEffect, CommandTarget, CommandValue } from './types';

export type { CommandContext } from './types';

export interface EditorCommand extends CommandMeta {
  /** `step` -1 steps a `reversible` cycle back (Shift with its key); every other command ignores it. */
  run: (ctx: CommandContext, step?: CycleStep) => void;
}

/* ── shared run-helpers (global store / active view) ─────────────────────── */

const store = () => useEditorStore.getState();
const doTile = (id: string): void => { const a = ACTION_BY_ID.get(id); if (a) runTileAction(a); };

/** A mode's key: opens the mode afresh (`actions.ts:setMode`), or rests when it is already open. */
function modeKey(mode: BuildMode): void {
  setMode(store().editMode.mode === mode ? null : mode, true);
}

/** Where a key acts now (`state/keymap/toolbar.ts:keyContext`). */
const contextNow = (): KeyContext => keyContext(store());

/** A design mode's bar, or the tool put down when that mode is already up. */
function openBuild(mode: DesignMode): void {
  const s = store();
  if (designModeOf(s) === mode) s.setEditMode({ arm: { kind: 'none' } });
  else openBuildSurface(mode);
}

/** The text size of the notes tool in hand, with the sizes it takes: a zone may carry no text, a chip
 *  is its lettering; null where the tool in hand takes none. */
export function noteSizeInHand(): { value: ZoneTextSize; sizes: readonly ZoneTextSize[] } | null {
  const s = store();
  const context = contextNow();
  if (context === 'notes-zone') return { value: s.annotationSize, sizes: ZONE_TEXT_SIZES };
  return context === 'notes-chip' ? { value: chipTextSize(s.annotationSize), sizes: CHIP_TEXT_SIZES } : null;
}

/** Steps an armed zone's or chip's text size. */
function stepNoteSize(step: CycleStep): void {
  const size = noteSizeInHand();
  if (size) store().setAnnotationSize(stepIn(size.sizes, size.value, step));
}

/** Runs one `KeyAction`, a cycle stepping `step`. */
function runAction(action: KeyAction, step: CycleStep): void {
  const s = store();
  switch (action.do) {
    case 'build-tool': s.setEditMode({ arm: toggleBuildTool({ tool: buildToolOf(s), shape: buildShapeOf(s) }, action.tool) }); return;
    case 'open-build': openBuild(action.mode); return;
    case 'region-tool': {
      // The brush resumes its remembered figure, or the request's first tool where it offers no such figure.
      const { tools } = regionRequestOf(s);
      const tool = action.tool === 'erase' ? 'erase' : tools.includes(s.regionBrushShape) ? s.regionBrushShape : tools[0];
      if (tool !== undefined && tools.includes(tool)) s.setRegionTool(tool);
      return;
    }
    case 'object-brush': s.setObjectBrush(action.brush); return;
    case 'note-tool': s.toggleAnnotationTool(action.tool); return;
    case 'smart-build': toggleSmartBuild(); return;
    case 'auto-edge-cut':
      if (takesAutoEdgeCut()) s.setAutoEdgeCut(stepIn(AUTO_EDGE_CUTS, s.autoEdgeCut, step));
      return;
    case 'region-dimensions': s.setRegionDimensions(!s.regionDimensions); return;
    case 'note-size': stepNoteSize(step); return;
    case 'route-dashes': s.setAnnotationRouteDashed(!s.annotationRouteDashed); return;
  }
}

/** A contextual key: the action its context's `CONTEXT_KEYS` row names, if any. */
const contextual = (id: ContextualCommandId) => (_ctx: CommandContext, step: CycleStep): void => {
  const action = CONTEXT_KEYS[contextNow()][id]?.action;
  if (action) runAction(action, step);
};

/** Whether the tool in hand takes an auto edge cut: a terrain surface's brush, figure or eraser. */
export function takesAutoEdgeCut(): boolean {
  const s = store();
  const tool = buildToolOf(s);
  return keyContext(s) === 'terrain' && (tool === 'brush' || tool === 'shape' || tool === 'erase');
}

/** The shape of the tool in hand, or null where the toolbar in front has no shape to set. */
export function shapeInHand(): BuildShape | null {
  const s = store();
  const context = keyContext(s);
  if (context === 'region') return s.regionTool === 'erase' ? null : s.regionTool;
  if (isNotesContext(context)) return s.annotationTool === 'zone' ? s.annotationZoneShape : s.annotationTool === 'erase' ? s.eraserShape : null;
  if (context === 'objects') return s.objectPaintShape;
  if (context !== 'terrain') return null;
  const tool = buildToolOf(s);
  return tool === 'erase' ? s.eraserShape : tool === 'brush' || tool === 'shape' ? buildShapeOf(s) : null;
}

/** Sets the shape of the tool in hand where it takes `shape`; on the map, with no toolbar in front,
 *  it opens the build bar on that shape. */
export function setToolShape(shape: BuildShape): void {
  const s = store();
  const context = keyContext(s);
  if (context === 'region') {
    if (s.regionTool !== 'erase' && regionRequestOf(s).tools.includes(shape)) s.setRegionTool(shape);
  } else if (context === 'objects') {
    s.setObjectPaintShape(shape);
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

/** The size the toolbar in front sets, with its range and its setter: the region brush's, the object
 *  brush's spacing, a route's line width, else the build brush's or eraser's. */
export function sizeInHand(): { value: number; min: number; max: number; set(size: number): void } {
  const s = store();
  const context = keyContext(s);
  if (context === 'region') return { value: s.regionBrushSize, ...BRUSH_SIZE, set: s.setRegionBrushSize };
  if (context === 'objects') return { value: s.objectPaintSpacing, ...OBJECT_SPACING, set: s.setObjectPaintSpacing };
  if (context === 'notes-route') return { value: s.annotationRouteWidth, ...BRUSH_SIZE, set: s.setAnnotationRouteWidth };
  return { value: brushSizeOf(s), ...BRUSH_SIZE, set: s.setBrushSize };
}

function resizeBrush(delta: number): void {
  const size = sizeInHand();
  size.set(Math.max(size.min, Math.min(size.max, size.value + delta)));
}

/** Whether the thickness group shows: a setting, as the shape is, which records no undo step. */
export function thicknessInHand(): boolean {
  const s = store();
  return keyContext(s) === 'terrain' && takesThickness(contentTypeOf(s), buildToolOf(s), s.planetSession !== null);
}

function stepThickness(step: CycleStep): void {
  const s = store();
  if (thicknessInHand()) s.setTerrainThickness(stepIn(TERRAIN_THICKNESSES, s.terrainThickness, step));
}

/** One stop of the interface's scale, on the stops of the scale in force and within the window's reach. */
function stepUiZoom(steps: number): void {
  const s = store();
  const next = uiZoomStep(s, uiZoomReach(), steps);
  if (next !== null) s.setUiZoom(next);
}

/** Turn the armed item's pending placement (its ghost, not yet on the map) — the shortcut fires
 *  only with nothing selected (see `rotateArmedOrSelected`). In Blueprint mode it turns the armed
 *  blueprint. Silently a no-op for a non-rotatable item: pressing a rotate key on a thing that
 *  doesn't rotate isn't a mistake worth a toast for, and it must never write a rotation a later
 *  placement could pick up. */
function rotatePendingPlacement(delta: 90 | -90): void {
  const s = store();
  if (s.editMode.mode === 'blueprint') { turnArmedBlueprint(delta); return; }
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

/** Flip shortcut dispatch, as `rotateArmedOrSelected` dispatches a turn: a selection first, else the
 *  blueprint armed in Blueprint mode. An armed object has no flip, as a single object has none. */
function flipArmedOrSelected(): void {
  const s = store();
  if (s.selection.length > 0) flipSelection();
  else if (s.editMode.mode === 'blueprint') flipArmedBlueprint();
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
  // Every object on a shown floor, including locked ones (refusing to modify one is the rule's job,
  // not selection's). Terrain is never part of a select-all.
  const shown = shownOn(s);
  const all = [...s.gridState.objects.keys()].map((id) => ({ kind: 'object', id }) as const).filter(shown);
  // Select-all means entering selection: the store keeps no selection under a macro (and puts a
  // brush away itself), so the command puts the tool away first, and an armed card or blueprint goes
  // down as it does for a Ctrl selection that catches something. The mode itself stays: this is the
  // same "leave the brush, keep the surface" move a selection gesture makes.
  if (!holdsSelection(activeToolOf(s))) s.setEditMode({ arm: { kind: 'none' } });
  else if (all.length > 0) putArmedDown(s);
  s.setSelection(all);
}

/** The history undo and redo step. Region selection and Notes keep their own lane for the whole
 *  mode, and an empty lane is a no-op rather than a fall-through to the map's history. */
type HistoryLane = 'region' | 'notes' | 'map';
const historyLane = (s: EditorStore): HistoryLane => (s.selectingRegion ? 'region' : isAnnotating(s) ? 'notes' : 'map');

/** The lane the history commands step now and whether each has something to step in it. On the
 *  map's history a build still landing is what either press takes back, so both have a step. */
export function historySteps(s: EditorStore = store()): { lane: HistoryLane; undo: boolean; redo: boolean } {
  const lane = historyLane(s);
  if (lane === 'region') return { lane, undo: s.regionUndoLane.length > 0, redo: s.regionRedoLane.length > 0 };
  if (lane === 'notes') return { lane, undo: s.annotationUndoLane.length > 0, redo: s.annotationRedoLane.length > 0 };
  const landing = editsInFlight('build');
  return { lane, undo: landing || (s.commandExecutor?.canUndo() ?? false), redo: landing || (s.commandExecutor?.canRedo() ?? false) };
}

/** One step of the lane `historySteps` names. A build still landing is cancelled and nothing else steps. */
function stepHistory(way: 'undo' | 'redo'): void {
  const s = store();
  const lane = historyLane(s);
  if (lane === 'region') { if (way === 'undo') s.undoRegion(); else s.redoRegion(); return; }
  if (lane === 'notes') {
    editorCurves.end();
    if (way === 'undo') s.undoAnnotation(); else s.redoAnnotation();
    return;
  }
  if (cancelEditsInFlight('build')) return;
  if (way === 'undo') s.commandExecutor?.undo(); else s.commandExecutor?.redo();
}

/* ── run bodies, keyed by command id ─────────────────────────────────────── */

const BODIES: Record<RunCommandId, (ctx: CommandContext, step: CycleStep) => void> = {
  'surface.mountain': () => modeKey('mountain'),
  'surface.river':    () => modeKey('water'),
  'surface.road':     () => modeKey('road'),

  // Move is the rest state, so it has nothing of its own to put away and pressing it twice is
  // pressing it once.
  'tool.move':   () => setMode(null, true),
  'tool.brush':   contextual('tool.brush'),
  'tool.erase':   contextual('tool.erase'),
  'tool.trim':    contextual('tool.trim'),
  'tool.smart':   contextual('tool.smart'),
  'tool.measure': contextual('tool.measure'),
  'tool.option_cycle': contextual('tool.option_cycle'),
  'tool.thickness_cycle': (_ctx, step) => stepThickness(step),
  'tool.shape_cycle': (_ctx, step) => {
    const s = store();
    const context = keyContext(s);
    if (context === 'region') {
      const shapes = regionRequestOf(s).tools.filter(tool => tool !== 'erase');
      if (s.regionTool !== 'erase' && shapes.length) s.setRegionTool(stepIn(shapes, s.regionTool, step));
      return;
    }
    const shape = shapeInHand();
    if (shape) setToolShape(stepIn(BUILD_SHAPES, shape, step));
  },
  'tool.free':   () => setToolShape('free'),
  'tool.rect':   () => setToolShape('rect'),
  'tool.circle': () => setToolShape('circle'),
  'tool.line':   () => setToolShape('line'),
  'tool.curve':  () => setToolShape('curve'),

  'brush.bigger':  () => resizeBrush(1),
  'brush.smaller': () => resizeBrush(-1),

  'selection.rotate_cw':  () => rotateArmedOrSelected(90),
  'selection.rotate_ccw': () => rotateArmedOrSelected(-90),
  'selection.flip':       () => flipArmedOrSelected(),
  'selection.delete':     () => deleteInFront(),
  'selection.deselect':   () => { backOut(); },
  'selection.all':        () => selectAllObjects(),
  'selection.copy':       () => copyKey(),
  'selection.cut':        () => cutKey(),
  'selection.paste':      () => pasteKey(),

  'camera.zoom_in':  () => host.camera.zoomIn(),
  'camera.zoom_out': () => host.camera.zoomOut(),
  'camera.fit':      () => host.camera.fit(),

  'view.toggle': () => {
    const s = store();
    // Without WebGL2 the scene cannot build, so the press says so instead of making the round trip.
    if (s.viewMode === '2d' && !hasWebGL2()) { showToast(translate('view3d.unavailable'), 'error'); return; }
    s.setViewMode(s.viewMode === '2d' ? '3d' : '2d');
  },

  'history.undo': () => stepHistory('undo'),
  'history.redo': () => stepHistory('redo'),

  // Generate is one of the mode blocks, so its key toggles like the others.
  'app.generate':      () => modeKey('generate'),
  'app.new':            () => doTile('new'),
  'app.export_json':    () => doTile('export'),
  'app.export_image':   () => doTile('image'),
  // The tour's dim takes no pick, so the mode never starts over a running tour.
  'app.whats_this': () => { const s = store(); if (!s.tourRunning) s.toggleWhatsThis(); },
  'app.help': () => store().setModal('help', true),
  'app.menu': (c) => c.toggleMenu(),

  'app.ui_zoom_in':  () => stepUiZoom(1),
  'app.ui_zoom_out': () => stepUiZoom(-1),

  'overlay.grid':    () => { store().toggleGrid(); },
  'overlay.numbers': () => { const s = store(); s.setShowLayerNumbers(!s.showLayerNumbers); },
  'overlay.chunks':  () => { const s = store(); s.setShowChunkBounds(!s.showChunkBounds); },
};

/* ── what each body does, for any caller ─────────────────────────────────── */

/** What a command says of itself beyond its registry row. */
interface CommandFacts {
  /** One line in English, for a caller that reads the command instead of seeing its control. */
  description: string;
  effect: CommandEffect;
  target: CommandTarget;
  /** The present value of what the command changes, where it has one (`Command.current`). */
  current?(): CommandValue;
}

const onMap = (description: string, effect: CommandEffect = 'change'): CommandFacts => ({ description, effect, target: 'map' });
const onApp = (description: string, effect: CommandEffect = 'change'): CommandFacts => ({ description, effect, target: 'app' });

/** Every body's facts. A command that arms a tool, sizes a brush or writes the selection, the
 *  clipboard or the history acts on the map; the system clipboard lies outside the page. */
export const FACTS: Record<RunCommandId, CommandFacts> = {
  'surface.mountain': onMap('Opens the mountain build surface, or puts it away when it is open.'),
  'surface.river':    onMap('Opens the water build surface, or puts it away when it is open.'),
  'surface.road':     onMap('Opens the road build surface, or puts it away when it is open.'),

  'tool.move':    onMap('Puts every tool down, so the pointer moves and selects.'),
  'tool.brush':   onMap('Takes up the brush of the toolbar in front, or puts it down.'),
  'tool.erase':   onMap('Takes up the eraser of the toolbar in front, or puts it down.'),
  'tool.trim':    onMap('Takes up the edge cut tool, or what stands in its place on the toolbar in front.'),
  'tool.smart':   onMap('Runs Smart Build, or what stands in its place on the toolbar in front.'),
  'tool.measure': onMap('Takes up the measuring tool, or what stands in its place on the toolbar in front.'),
  'tool.option_cycle':    onMap('Steps the last option group of the toolbar in front.'),
  'tool.thickness_cycle': onMap('Steps the thickness of the mountain brush and eraser.'),
  'tool.shape_cycle':     onMap('Steps the shape of the tool in hand.'),
  'tool.free':   onMap('Sets the shape of the tool in hand to freehand.'),
  'tool.rect':   onMap('Sets the shape of the tool in hand to a rectangle.'),
  'tool.circle': onMap('Sets the shape of the tool in hand to a circle.'),
  'tool.line':   onMap('Sets the shape of the tool in hand to a line.'),
  'tool.curve':  onMap('Sets the shape of the tool in hand to a curve.'),

  'brush.bigger':  onMap('Makes the brush in hand one step bigger.'),
  'brush.smaller': onMap('Makes the brush in hand one step smaller.'),

  'selection.rotate_cw':  onMap('Turns the selection, or the item about to be placed, a quarter clockwise.'),
  'selection.rotate_ccw': onMap('Turns the selection, or the item about to be placed, a quarter counterclockwise.'),
  'selection.flip':       onMap('Flips the selection, or the armed blueprint.'),
  'selection.delete':     onMap('Deletes the selection, or what stands in front.'),
  'selection.deselect':   onMap('Backs out of the newest state that stands: a selection, a tool, a step.'),
  'selection.all':        onMap('Selects every object on the shown layers.'),
  'selection.copy':       onMap('Copies the selection to the clipboard.', 'outward'),
  'selection.cut':        onMap('Cuts the selection to the clipboard.', 'outward'),
  'selection.paste':      onMap('Pastes the clipboard onto the map.', 'outward'),

  'camera.zoom_in':  onApp('Zooms the map view in one step.'),
  'camera.zoom_out': onApp('Zooms the map view out one step.'),
  'camera.fit':      onApp('Fits the whole map in the view.'),

  'view.toggle': onApp('Which view shows the map: 2D or 3D.'),

  'history.undo': { ...onMap('Takes back the last step; its value is whether there is one to take back.'), current: () => historySteps().undo },
  'history.redo': { ...onMap('Brings back the step last taken back; its value is whether there is one to bring back.'), current: () => historySteps().redo },

  'app.generate':     onMap('Opens Generate, or puts it away when it is open.'),
  'app.new':          onApp('Opens the Change planet window.'),
  'app.export_json':  onApp('Opens the save file in the Save and share window, with the given sections set and the others as the window chooses. It never downloads; a section the map has no data for stays off.'),
  'app.export_image': onApp('Opens the share picture in the Save and share window, with the given choices set and the others as they are. It never downloads.'),
  'app.whats_this': onApp('Turns What\'s this on, where the next press on a control opens its Help page instead of running it, or off.'),
  'app.help': onApp('Opens Help.'),
  'app.menu': onApp('Opens the menu, or puts it away.'),

  'app.ui_zoom_in':  onApp('Makes the interface one step bigger, up to the largest size the window fits; the map zoom is separate.'),
  'app.ui_zoom_out': onApp('Makes the interface one step smaller; the map zoom is separate.'),

  'overlay.grid':    onApp('The grid the map draws.'),
  'overlay.numbers': onApp('Whether the map shows each cell\'s layer number, for this session.'),
  'overlay.chunks':  onApp('Whether the map draws the chunk bounds.'),
};

/** Whether a session that holds the map withholds `id` now (`state/session-offer.ts`). */
export function sessionWithholds(id: string): boolean {
  return !sessionOffers(framePose(store()), id);
}

/** Whether `id` does anything now, however it is run (a key, a control, a gesture, a caller by id):
 *  a session that holds the map runs only what it offers, and while a stand-in shows in the open
 *  map's place (the blueprint save step), no command edits the map, its history or its selection
 *  (`MAP_EDIT_COMMANDS`). */
export function commandApplies(id: string): boolean {
  return !sessionWithholds(id) && (!MAP_EDIT_COMMANDS.has(id) || !standInShown(store()));
}

/** The keyboard command bodies, each run only where it applies (`commandApplies`). */
export const RUN = Object.fromEntries((Object.keys(BODIES) as RunCommandId[]).map((id) => [id, (ctx: CommandContext, step: CycleStep = 1): void => {
  if (commandApplies(id)) BODIES[id](ctx, step);
}])) as Record<RunCommandId, (ctx: CommandContext, step?: CycleStep) => void>;

/** Whether `id` has a body; held commands have none. */
export function hasRunBody(id: string): id is RunCommandId {
  return Object.prototype.hasOwnProperty.call(BODIES, id);
}

const answeredElsewhere = (): void => {};

export const COMMANDS: readonly EditorCommand[] = COMMAND_META.map((meta) => ({
  ...meta,
  run: hasRunBody(meta.id) ? RUN[meta.id] : answeredElsewhere,
}));

export const COMMAND_BY_ID: ReadonlyMap<string, EditorCommand> = new Map(COMMANDS.map((c) => [c.id, c]));

/** A combo the discrete engine registers, and what pressing it runs. */
interface KeyBinding {
  combo: string;
  run: () => void;
  /** The key's default stays the browser's (`CommandMeta.native`). */
  keepDefault: boolean;
}

/** Whether the key of `id` answers now: among what a session offers, its keys are a part
 *  (`state/session-offer.ts:sessionKeyAnswers`). */
const answers = (id: string): boolean => sessionKeyAnswers(framePose(store()), id);

/**
 * The discrete engine's bindings under `overrides` in `toolbar`: every command with a run body on
 * its effective combo, then the fixed aliases, then each reversible cycle's way back on its
 * `reverseCombos`. Held commands are the held-key loop's, and a listener command's combo is left to
 * its listener, which runs the body itself and whose press a match here would swallow. A command a
 * planet session does not answer keeps its key there and does nothing.
 */
export function keyBindings(overrides: Overrides, toolbar: ToolbarContext, ctx: CommandContext): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  const bind = (combo: string, cmd: EditorCommand, step: CycleStep = 1): void => {
    bindings.push({ combo, run: () => { if (answers(cmd.id)) cmd.run(ctx, step); }, keepDefault: cmd.native === true });
  };
  for (const cmd of COMMANDS) {
    // The back key is the back stack's own listener's (`back/back-out.ts:watchBackKey`), which also
    // hears it in fields and under windows.
    if (cmd.continuous || cmd.listener || !hasRunBody(cmd.id) || cmd.id === BACK_COMMAND) continue;
    const combo = effectiveCombo(overrides, cmd.id, toolbar);
    if (combo) bind(combo, cmd);
  }
  for (const alias of ALIASES) {
    const cmd = COMMAND_BY_ID.get(alias.commandId);
    if (cmd && !cmd.continuous && !cmd.listener) bind(alias.combo, cmd);
  }
  for (const [id, back] of reverseCombos(overrides, toolbar)) {
    const cmd = COMMAND_BY_ID.get(id);
    if (cmd && !cmd.listener && hasRunBody(id)) bind(back, cmd, -1);
  }
  return bindings;
}
