/**
 * Edit state: the `editMode` inputs (the facts they resolve into are selectors in
 * `editing/edit-mode.ts`), the tile material, auto edge-cut mode, layer selection and visibility,
 * the live map's layer locks, brush sizes, the armed item's pending rotation, and the region-select
 * tool with the cells it has painted. Everything the build brushes and the placer read while a
 * stroke is being planned, as opposed to `engine`'s grid/command handles or `shell`'s chrome.
 */
import { laneRecord, laneStep, type HistoryLane } from '../history-lane';
import type { StateCreator } from 'zustand';
import { type MacroCoord, type Rotation } from '../../core/model/types';
import { DEFAULT_REGION_REQUEST, type AutoEdgeCut, type BuildShape, type EraserShape, type RegionRequest, type RegionTool } from '../editing/vocabulary';
import {
  activeToolOf, armedItemOf, armedMacroOf, buildToolOf, holdsSelection, modeOpenIn, nextEditMode, withSurfaceTools, REST_INPUTS,
  type EditModeChange, type EditModeInputs,
} from '../editing/edit-mode';
import { getRoadMaterials, getCatalogItem } from '../catalog';
import { isSurfacePrint } from '../../core/model/traits';
import type { AnnotationsSlice } from './annotations';
import type { EngineSlice } from './engine';
import type { PlanetSessionSlice } from './planet-session';

export interface EditSlice {
  /** The mode and its one arming. The active tool, drawing mode, content, armed item and macro and
   *  the brush size are selectors over it (`editing/edit-mode.ts`); `setEditMode` and
   *  `restoreEditMode` are its writers. */
  editMode: EditModeInputs;
  /** A road catalog id, e.g. 'path-overgrown-dirt'. The tile brush can lay any item in the Road category. */
  tileMaterial: string;
  /**
   * Whether a hand put `tileMaterial` where it is, as opposed to it being the catalog's first road
   * because something had to be armed. The same distinction `layerPinned` draws, and it has the same
   * one reader: the road macros take their surface from the map when nobody has chosen (a new lane
   * comes out matching the street it grows from) and from the bar when somebody has.
   *
   * `setTileMaterial` is the only writer of either, so the two cannot come apart.
   */
  tileMaterialPicked: boolean;
  autoEdgeCut: AutoEdgeCut;     // auto corner-trim mode for the build brushes
  /** Erasing keeps its shape independently of the drawing tool. */
  eraserShape: EraserShape;
  activeLayer: number;          // build floor: the layer the user explicitly selected
  /**
   * Whether a hand put `activeLayer` where it is, as opposed to it being wherever the automatic
   * default sits. The water brush is the reader: Pinned it lays water at that layer everywhere the
   * rules allow, automatic it follows each cell's own surface as the stroke travels.
   *
   * Pressing the pinned layer's row again lets go of it (`selectLayer`). The control that pins is
   * the one that unpins, so the state needs no chrome of its own.
   */
  layerPinned: boolean;
  displayLayer: number | null;  // transient pill highlight while auto-stacking (null → activeLayer)
  /** Which build floors are shown; a tool skips a hidden layer rather than refusing it. */
  layerVisibility: Record<number, boolean>;
  /** The size every brush but the eraser draws at; `brushSizeOf` reads the armed tool's. */
  drawingBrushSize: number;
  eraserBrushSize: number;
  /**
   * How many times the armed macro has changed. Counting is what a comparison of the id itself
   * cannot do: `road-link` to `patch-tree` and back leaves the id where it started, so anything
   * holding state across that round trip (a `road-link` mark waiting for its second tap) reads the
   * arming as untouched and acts on a gesture the user abandoned two clicks ago.
   */
  armingEpoch: number;
  /** The armed item's pending rotation — turned by the rotate shortcuts while its ghost is showing,
   *  read by the ghost preview and the placement it lands. Lives here (not the placer tool instance)
   *  because the shortcut engine, the ghost preview, and the placement command are three separate
   *  call sites that all need it, and only two of those touch a tool at all. Reset by `setEditMode`
   *  whenever the armed item changes, so a fresh item starts at its natural orientation; nothing
   *  reads it while nothing is armed. */
  placementRotation: Rotation;
  setPlacementRotation: (r: Rotation) => void;
  selectingRegion: boolean;
  regionSelectionOwner: 'agent' | 'generator' | null;
  regionTool: RegionTool;
  regionBrushShape: BuildShape;
  regionDimensions: boolean;
  setRegionDimensions: (visible: boolean) => void;
  regionBrushSize: number;
  /** The painted region: the macro cells the region-select tool has collected, which scope a
   *  generate, a clear and an agent run. `[]` is the one representation of "no region painted"
   *  (whole map), matching `selection`'s empty-list contract; the cells are deduplicated as they
   *  are painted, so `region.length` is the selected-cell count with no scan and no second field.
   *  Session-only, deliberately: it is a scope for the next run, not a property of the map, and it
   *  is dropped when the run that used it finishes. */
  region: MacroCoord[];
  setRegion: (cells: MacroCoord[]) => void;
  /** The region's own history while it is being painted, apart from the map's: earlier regions to
   *  undo to and later ones to redo to (`state/history-lane.ts`, capped). Emptied
   *  whenever region selection starts or stops. */
  regionUndoLane: MacroCoord[][];
  regionRedoLane: MacroCoord[][];
  /** Sets the region as one entry of its history; replacing an empty region with an empty one records nothing. */
  commitRegion: (cells: MacroCoord[]) => void;
  /** Steps the region's history; false when the lane is empty. */
  undoRegion: () => boolean;
  redoRegion: () => boolean;
  setSelectingRegion: (v: boolean, owner?: 'agent' | 'generator') => void;
  setRegionTool: (t: RegionTool) => void;
  setRegionBrushSize: (s: number) => void;
  regionRequest: RegionRequest;
  /** Makes `request` the region request, moving `regionTool` to the request's first tool when it
   *  does not offer the current one; the returned release restores the default only while `request`
   *  is still the current one, so a remount that claims before the old release keeps it. */
  claimRegionRequest: (request: RegionRequest) => () => void;
  /** Applies `change` to `editMode` in one `set`; a mode the planet session does not offer
   *  (`modeOpenIn`) changes nothing. */
  setEditMode: (change: EditModeChange) => void;
  /** Reinstates exact inputs a caller saved from `editMode`, resolved as `setEditMode` resolves them. */
  restoreEditMode: (inputs: EditModeInputs) => void;
  setTileMaterial: (m: string) => void;
  setAutoEdgeCut: (m: AutoEdgeCut) => void;
  setEraserShape: (m: EraserShape) => void;
  /** Move the build floor by hand — the rail's steppers, the layer.up/down commands. Every caller
   *  is a person choosing a layer, so this pins it. Nothing automatic comes through here: the water
   *  brush's per-cell layer moves the highlight (`setDisplayLayer`), never the floor. */
  setActiveLayer: (layer: number) => void;
  /** A press on a layer row: pin that layer, or let go of it if it is the pinned one already. A floor
   *  is not the notes layer, so annotate stands down with it. */
  selectLayer: (layer: number) => void;
  setDisplayLayer: (layer: number | null) => void;
  setLayerVisibility: (layer: number, visible: boolean) => void;
  /** Locks or unlocks a build floor on the live map. The map owns its locks (`GridState.lockedLayers`,
   *  which the rules, copies and the save's session read), so a parked map keeps its own. */
  setLayerLocked: (layer: number, locked: boolean) => void;
  setBrushSize: (size: number) => void;
}

/** What `editModeFields` reads: the edit slice and the selection an arming may drop. */
type EditModeReads = EditSlice & Pick<EngineSlice, 'selection'>;

/**
 * The one update that stores `editMode`, shared by `setEditMode`, `restoreEditMode` and a selection
 * write that puts a brush away (`slices/engine.ts`). Arming a tool that cannot hold a selection
 * drops it in the same update.
 */
export function editModeFields(s: EditModeReads, inputs: EditModeInputs): Partial<EditModeReads> {
  const editMode = withSurfaceTools(inputs, isSurfacePrint(getCatalogItem(s.tileMaterial)));
  const next = { editMode };
  // A freshly armed (or disarmed) item starts at its natural orientation, so a rotation left
  // over from the last one is never picked up by the next placement.
  const armedChanged = armedItemOf(next) !== armedItemOf(s);
  // Choosing what to build puts the region brush away. Both arm the pointer and the region
  // outranks the tool, so leaving it on would hand every press to the brush that paints a
  // scope while the map showed a mode that paints terrain. Only a change of mode does this:
  // picking another tool or item inside the mode the region was painted for is not leaving it.
  const leftRegion = editMode.mode !== s.editMode.mode && s.selectingRegion;
  const macroChanged = armedMacroOf(next) !== armedMacroOf(s);
  const dropsSelection = s.selection.length > 0 && !holdsSelection(activeToolOf(next));
  return {
    editMode,
    displayLayer: null,
    ...(macroChanged ? { armingEpoch: s.armingEpoch + 1 } : null),
    ...(armedChanged ? { placementRotation: 0 } : null),
    ...(leftRegion ? { selectingRegion: false, regionSelectionOwner: null, regionUndoLane: [], regionRedoLane: [] } : null),
    ...(dropsSelection ? { selection: [] } : null),
  };
}

/** The fields choosing region tool `t` writes: a figure is also the shape the brush keeps. */
const regionToolFields = (t: RegionTool): Pick<EditSlice, 'regionTool'> & Partial<Pick<EditSlice, 'regionBrushShape'>> =>
  (t === 'erase' ? { regionTool: t } : { regionTool: t, regionBrushShape: t });

/** The region's lane as the store holds it: two arrays, newest last. */
const regionLane = (s: Pick<EditSlice, 'regionUndoLane' | 'regionRedoLane'>): HistoryLane<MacroCoord[]> =>
  ({ undo: s.regionUndoLane, redo: s.regionRedoLane });
const regionLaneFields = (lane: HistoryLane<MacroCoord[]>): Pick<EditSlice, 'regionUndoLane' | 'regionRedoLane'> =>
  ({ regionUndoLane: [...lane.undo], regionRedoLane: [...lane.redo] });

/** Steps the region's lane; false when that side is empty. */
function stepRegion(get: () => EditSlice, set: (patch: Partial<EditSlice>) => void, dir: 'undo' | 'redo'): boolean {
  const step = laneStep(regionLane(get()), get().region, dir);
  if (!step) return false;
  set({ region: step.restored, ...regionLaneFields(step.lane) });
  return true;
}

export const createEditSlice: StateCreator<EditSlice & Pick<AnnotationsSlice, 'annotationDraft' | 'requestAnnotationDiscard'> & Pick<EngineSlice, 'gridState' | 'selection'> & Pick<PlanetSessionSlice, 'planetSession'>, [], [], EditSlice> = (set, get) => ({
  editMode: REST_INPUTS,
  // The catalog's first Road item in authored order — something has to be armed, and nobody has
  // chosen yet.
  tileMaterial: getRoadMaterials()[0]!.id,
  tileMaterialPicked: false,
  autoEdgeCut: 'off',
  eraserShape: 'free',
  activeLayer: 0,   // Ground selected by default — an empty map shows only Ground (build floors to 1)
  layerPinned: false,   // nobody has chosen a layer yet
  displayLayer: null,
  layerVisibility: {},
  drawingBrushSize: 1,
  eraserBrushSize: 1,
  armingEpoch: 0,
  placementRotation: 0,
  setPlacementRotation: (r) => set({ placementRotation: r }),
  selectingRegion: false,
  regionSelectionOwner: null,
  regionTool: 'free',
  regionBrushShape: 'free',
  regionDimensions: true,
  setRegionDimensions: (visible) => set({ regionDimensions: visible }),
  regionBrushSize: 3,
  region: [],
  setRegion: (cells) => set({ region: cells }),
  regionUndoLane: [],
  regionRedoLane: [],
  commitRegion: (cells) => {
    const { region } = get();
    if (region.length === 0 && cells.length === 0) return;
    set({ region: cells, ...regionLaneFields(laneRecord(regionLane(get()), region)) });
  },
  undoRegion: () => stepRegion(get, set, 'undo'),
  redoRegion: () => stepRegion(get, set, 'redo'),
  setSelectingRegion: (v, owner = 'generator') => {
    const change = () => set({
      selectingRegion: v, regionSelectionOwner: v ? owner : null,
      ...(v === get().selectingRegion ? null : { regionUndoLane: [], regionRedoLane: [] }),
    });
    if (v && get().annotationDraft) get().requestAnnotationDiscard(change);
    else change();
  },
  setRegionTool: (t) => set(regionToolFields(t)),
  setRegionBrushSize: (s) => set({ regionBrushSize: s }),
  regionRequest: DEFAULT_REGION_REQUEST,
  claimRegionRequest: (request) => {
    const first = request.tools[0];
    const coerced = first && !request.tools.includes(get().regionTool) ? regionToolFields(first) : null;
    set({ regionRequest: request, ...coerced });
    return () => { if (get().regionRequest === request) set({ regionRequest: DEFAULT_REGION_REQUEST }); };
  },

  setEditMode: (change) => {
    const editMode = nextEditMode(get().editMode, change);
    if (!modeOpenIn(get().planetSession, editMode.mode)) return;
    if (get().annotationDraft && editMode.mode !== get().editMode.mode) {
      get().requestAnnotationDiscard(() => get().setEditMode(change));
      return;
    }
    set(editModeFields(get(), editMode));
  },
  restoreEditMode: (inputs) => set(editModeFields(get(), inputs)),
  setTileMaterial: (m) => set((s) => {
    const picked = { tileMaterial: m, tileMaterialPicked: true, placementRotation: 0 as const };
    return { ...picked, ...editModeFields({ ...s, ...picked }, s.editMode) };
  }),
  setAutoEdgeCut: (m) => set({ autoEdgeCut: m }),
  setEraserShape: (m) => set({ eraserShape: m }),
  setActiveLayer: (layer) => set({ activeLayer: layer, layerPinned: true, displayLayer: null }),
  selectLayer: (layer) => {
    const s = get();
    const layerFields = { activeLayer: layer, layerPinned: !(s.layerPinned && s.activeLayer === layer), displayLayer: null };
    if (s.editMode.mode !== 'annotate') { set(layerFields); return; }
    // A draft asks before annotate stands down; the floor is chosen either way.
    if (s.annotationDraft) { s.setEditMode({ mode: null }); set(layerFields); return; }
    set({ ...editModeFields(s, nextEditMode(s.editMode, { mode: null })), ...layerFields });
  },
  setDisplayLayer: (layer) => set((s) => (s.displayLayer === layer ? s : { displayLayer: layer })),
  setLayerVisibility: (layer, visible) => set((s) => ({
    layerVisibility: { ...s.layerVisibility, [layer]: visible },
  })),
  setLayerLocked: (layer, locked) => {
    const grid = get().gridState;
    if (!grid || grid.lockedLayers.has(layer) === locked) return;
    const next = new Set(grid.lockedLayers);
    if (locked) next.add(layer); else next.delete(layer);
    grid.lockedLayers = next;
    // A new Set, so a selector over `gridState.lockedLayers` sees the change this update publishes.
    set({ gridState: grid });
  },
  setBrushSize: (size) => set((s) => (buildToolOf(s) === 'erase' ? { eraserBrushSize: size } : { drawingBrushSize: size })),
});
