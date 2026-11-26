/**
 * Edit state: the `editMode` inputs (the facts they resolve into are selectors in
 * `editing/edit-mode.ts`), the tile material, auto edge-cut mode, layer selection and visibility,
 * the live map's layer locks, brush sizes, the armed item's pending rotation, and the region-select
 * tool with the cells it has painted. Everything the build brushes and the placer read while a
 * stroke is being planned, as opposed to `engine`'s grid/command handles or `shell`'s chrome.
 */
import { laneRecord, laneStep, type HistoryLane } from '../history-lane';
import type { StateCreator } from 'zustand';
import { type GridState, type MacroCoord, type Rotation } from '../../core/model/types';
import type { Arrangement } from '../clipboard';
import { shownOn } from '../selection';
import { DEFAULT_REGION_REQUEST, OBJECT_SPACING, type AutoEdgeCut, type BuildShape, type EraserShape, type ObjectBrush, type RegionRequest, type RegionTool } from '../editing/vocabulary';
import {
  armedItemOf, armedMacroOf, buildToolOf, modeOpenIn, nextEditMode, withSurfaceTools, REST_INPUTS, TERRAIN_THICKNESS,
  type BuildMode, type EditModeChange, type EditModeInputs,
} from '../editing/edit-mode';
import { armedFactsOf, leftBehindFields, movesOn, purposeMovesOn, purposeOf, rearmFields, type Left, type LeftBehind, type Purpose } from '../editing/intent';
import { paintedRegion, regionToolFields, type RegionOwner, type Regions } from '../editing/region';
import { getRoadMaterials, getCatalogItem } from '../catalog';
import { brushBarRefusal } from '../object-shelf-view';
import { selectedGroup } from '../placed-groups';
import { isSurfacePrint } from '../../core/model/traits';
import type { AnnotationsSlice } from './annotations';
import { stepEndFields, type BlueprintSlice, type BlueprintUi } from './blueprint';
import type { EngineSlice } from './engine';
import type { PlanetSessionSlice } from './planet-session';
import type { RepairSessionSlice } from './repair-session';
import { notesOpenable, type ShellSlice } from './shell';
import { markBrushHintSeen } from '../greetings';

/** The two families the road brush lays: road surfaces, and the surface prints laid over them. */
export const ROAD_FAMILIES = ['roads', 'prints'] as const;
export type RoadFamily = typeof ROAD_FAMILIES[number];

/** The family road material `id` belongs to. */
const familyOfMaterial = (id: string): RoadFamily => (isSurfacePrint(getCatalogItem(id)) ? 'prints' : 'roads');

/** The family the road brush lays now. */
export const roadFamilyOf = (s: Pick<EditSlice, 'tileMaterial'>): RoadFamily => familyOfMaterial(s.tileMaterial);

export interface EditSlice {
  /** The mode and its one arming. The active tool, drawing mode, content, armed item and macro and
   *  the brush size are selectors over it (`editing/edit-mode.ts`); `setEditMode` and
   *  `restoreEditMode` are its writers. */
  editMode: EditModeInputs;
  /** A road catalog id, e.g. 'path-overgrown-dirt'. The tile brush can lay any item in the Road category. */
  tileMaterial: string;
  /**
   * Whether a hand put `tileMaterial` where it is, as opposed to it being the catalog's first road
   * because something had to be armed. Its one reader: the road macros take their surface from the
   * map when nobody has chosen (a new lane comes out matching the street it grows from) and from the
   * bar when somebody has.
   *
   * `setTileMaterial` is the only writer of either, so the two cannot come apart.
   */
  tileMaterialPicked: boolean;
  /** The material last laid in each road family, which the family switch arms again; null until one
   *  was armed there, where the switch arms the family's first. Written by `setTileMaterial` and, for
   *  the family it leaves, by `switchRoadFamily`. */
  roadFamilyMaterials: Readonly<Record<RoadFamily, string | null>>;
  autoEdgeCut: AutoEdgeCut;     // auto corner-trim mode for the build brushes
  /** Erasing keeps its shape independently of the drawing tool. */
  eraserShape: EraserShape;
  /** The layer the layer panel and its readout show: a terrain stroke's from its press, an armed
   *  blueprint's surface; null shows the ground. No control writes it by hand. */
  displayLayer: number | null;
  /** How many layers a mountain stroke raises or lowers a cell by (`TERRAIN_THICKNESS`). */
  terrainThickness: number;
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
  /** The page's copied arrangement, or null before anything is copied (EDIT-53). */
  clipboard: Arrangement | null;
  setClipboard: (a: Arrangement | null) => void;
  /** The card or blueprint carried from a shelf to the map while a carry is under way; null for none. */
  carrying: string | null;
  /** Starts or ends a carry of `card` (null ends it); starting one moves on from the selection. */
  setCarrying: (card: string | null) => void;
  selectingRegion: boolean;
  /** The surface whose region brush is painting, while one is. */
  regionSelectionOwner: RegionOwner | null;
  regionTool: RegionTool;
  regionBrushShape: BuildShape;
  regionDimensions: boolean;
  setRegionDimensions: (visible: boolean) => void;
  regionBrushSize: number;
  /** The painted regions, one per surface that paints one, with the map each was painted on: the
   *  macro cells the region-select tool collected, which scope a generate, a clear and an agent run.
   *  An absent or empty one is "no region painted" (whole map); the cells are deduplicated as they
   *  are painted, so their length is the selected-cell count. Never saved: a region stays until its
   *  surface clears it, and another map drops them all (`mapSessionReset`). Every reader asks
   *  `editing/region.ts` for its own (`regionOf`). */
  regions: Regions;
  /** Sets `owner`'s region on the live map; the other surfaces' stay as they are. */
  setRegion: (cells: MacroCoord[], owner: RegionOwner) => void;
  /** The painting brush's own history, apart from the map's: earlier regions to undo to and later
   *  ones to redo to (`state/history-lane.ts`, capped). Emptied whenever region selection starts
   *  or stops, except that the assistant's lane waits with its region when a mode click ends its
   *  painting and comes back when its brush is picked up again. */
  regionUndoLane: MacroCoord[][];
  regionRedoLane: MacroCoord[][];
  /** Sets the painting surface's region as one entry of its history, over that surface's own
   *  (`editing/region.ts:paintedRegion`); replacing an empty region with an empty one records nothing. */
  commitRegion: (cells: MacroCoord[]) => void;
  /** Steps the region's history; false when the lane is empty. */
  undoRegion: () => boolean;
  redoRegion: () => boolean;
  /** Starts `owner`'s region brush under `request` (the default request when absent), or stops the
   *  one painting; the one start of every surface's painting, Blueprint's frame step included
   *  (`regionSelectingFields`). A start names its owner. */
  setSelectingRegion: {
    (v: false): void;
    (v: boolean, owner: RegionOwner, request?: RegionRequest): void;
  };
  setRegionTool: (t: RegionTool) => void;
  setRegionBrushSize: (s: number) => void;
  /** What the painting brush was started under (`setSelectingRegion`); the default while none paints. */
  regionRequest: RegionRequest;
  /** Applies `change` to `editMode` in one `set`; a mode the planet session does not offer
   *  (`modeOpenIn`) changes nothing, and nor does opening Notes while a Show me stands, since the
   *  Show me gives back the map and a note's own history is apart from it. */
  setEditMode: (change: EditModeChange) => void;
  /** Reinstates exact inputs a caller saved from `editMode`, resolved as `setEditMode` resolves them. */
  restoreEditMode: (inputs: EditModeInputs) => void;
  setTileMaterial: (m: string) => void;
  /** Arms `family`'s remembered material, or its first, keeping the material it leaves for the way
   *  back; the other family when none is named. Nothing in the family already laid. */
  switchRoadFamily: (family?: RoadFamily) => void;
  setAutoEdgeCut: (m: AutoEdgeCut) => void;
  setEraserShape: (m: EraserShape) => void;
  setDisplayLayer: (layer: number | null) => void;
  /** Sets the mountain stroke's thickness, clamped to `TERRAIN_THICKNESS`. */
  setTerrainThickness: (layers: number) => void;
  setLayerVisibility: (layer: number, visible: boolean) => void;
  /** Locks or unlocks a build floor on the live map. The map owns its locks (`GridState.lockedLayers`,
   *  which the rules, copies and the save's session read), so a parked map keeps its own. */
  setLayerLocked: (layer: number, locked: boolean) => void;
  setBrushSize: (size: number) => void;
  /** How an armed card places (EDIT-65), kept across the brush bar's Done and across cards. */
  objectBrush: ObjectBrush;
  /** The figure a Paint stroke lays along, apart from the terrain brush's. */
  objectPaintShape: BuildShape;
  /** The empty cells a Paint stroke keeps between items (`OBJECT_SPACING`). */
  objectPaintSpacing: number;
  /** The brush bar stands in the object shelf's place (EDIT-64), opened with or without a card armed
   *  but never over what `object-shelf-view.ts:brushBarRefusal` names; it closes when the shelf's mode
   *  or its armed card goes. */
  objectBrushBar: boolean;
  setObjectBrush: (brush: ObjectBrush) => void;
  setObjectPaintShape: (shape: BuildShape) => void;
  setObjectPaintSpacing: (spacing: number) => void;
  setObjectBrushBar: (open: boolean) => void;
  /** Touch multi-select: while on, a press reads as if the multi-select key were held
   *  (`keymap/held.ts`). Any change of mode or arming ends it. */
  multiSelectLatched: boolean;
  /** Touch move: while on, the next one-finger drag anywhere on the map moves the selection. The
   *  next selection write, a change of mode or arming, or the drop ends it. */
  moveLatched: boolean;
  setMultiSelectLatched: (on: boolean) => void;
  setMoveLatched: (on: boolean) => void;
  /** Ends both latches: the input mode left touch. Clearing the selection (`clearSelection`) ends
   *  them as well. */
  endTouchLatches: () => void;
}

/** What `editModeFields` writes: the edit slice, the selection and picked block an arming may drop,
 *  and what a mode it leaves owned. */
type EditModeWrites = EditSlice & Pick<EngineSlice, 'selection' | 'pickedCell'> & Pick<AnnotationsSlice, 'annotationSelection'>
  & Pick<BlueprintSlice, 'blueprintStep'>;
/** What `editModeFields` reads besides: the armed blueprint Blueprint mode resumes. */
type EditModeReads = EditModeWrites & { blueprint: Pick<BlueprintUi, 'armed'> } & Pick<EngineSlice, 'gridState'>;

type ModeOwnedWrites = Partial<Pick<EditModeWrites, 'annotationSelection' | 'blueprintStep' | 'selectingRegion' | 'regionSelectionOwner'
  | 'regionUndoLane' | 'regionRedoLane' | 'regions'>> & LeftBehind;

/** The transients each mode owns, as the update that leaves the mode writes them; null where
 *  nothing it owns stands. Notes owns its selection, which no other mode draws or edits; Blueprint
 *  its step, which returns to the strip, and a placement selected whole, which only it turns, moves
 *  and deletes as one (`placed-groups.ts`), so another mode never takes it apart. */
const MODE_OWNED: Partial<Record<Exclude<BuildMode, null>, (s: EditModeReads) => ModeOwnedWrites | null>> = {
  annotate: (s) => (s.annotationSelection.length > 0 ? { annotationSelection: [] } : null),
  blueprint: (s) => ({ ...stepEndFields(s), ...(selectedGroup(s) ? leftBehindFields(s) : null) }),
};

/**
 * The one update that stores `editMode`, shared by `setEditMode`, `restoreEditMode` and a selection
 * write that puts a brush away (`slices/engine.ts`). An arming that moves on to a new purpose
 * (`editing/intent.ts:movesOn`), or arms a tool that cannot hold a selection, drops it in the same
 * update, and any change of arming drops the picked block.
 */
export function editModeFields(s: EditModeReads, inputs: EditModeInputs): Partial<EditModeWrites> & LeftBehind {
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
  const leftOwned = editMode.mode !== s.editMode.mode && s.editMode.mode ? MODE_OWNED[s.editMode.mode]?.(s) : null;
  const rearm = rearmFields(s, armedFactsOf(s), armedFactsOf({
    ...s, editMode, blueprintStep: leftOwned?.blueprintStep ?? s.blueprintStep,
    selectingRegion: s.selectingRegion && !leftRegion, regionSelectionOwner: leftRegion ? null : s.regionSelectionOwner,
  }));
  // The bar opens with nothing armed too, so only putting down a card it stood for closes it.
  const closesBrushBar = s.objectBrushBar
    && (editMode.mode !== 'object' || (!!armedItemOf(s) && !armedItemOf(next)) || armedMacroOf(next) !== null);
  return {
    editMode,
    ...leftOwned,
    displayLayer: null,
    ...(macroChanged ? { armingEpoch: s.armingEpoch + 1 } : null),
    ...(armedChanged ? { placementRotation: 0 } : null),
    ...(leftRegion ? { selectingRegion: false, regionSelectionOwner: null, regionUndoLane: [], regionRedoLane: [], ...asideAgentLane(s) } : null),
    ...rearm,
    ...(closesBrushBar ? { objectBrushBar: false } : null),
  };
}

/** What arming road material `m` writes over `s`: the material as a hand's choice, remembered for
 *  its family, with what the arming then implies (a print armed drops the tools a print lacks). */
function tileMaterialFields(s: EditModeReads, m: string): Partial<EditModeWrites> & LeftBehind {
  const picked = {
    tileMaterial: m, tileMaterialPicked: true, placementRotation: 0 as const,
    roadFamilyMaterials: { ...s.roadFamilyMaterials, [familyOfMaterial(m)]: m },
  };
  return { ...picked, ...editModeFields({ ...s, ...picked }, s.editMode) };
}

/** The region's lane as the store holds it: two arrays, newest last. */
const regionLane = (s: Pick<EditSlice, 'regionUndoLane' | 'regionRedoLane'>): HistoryLane<MacroCoord[]> =>
  ({ undo: s.regionUndoLane, redo: s.regionRedoLane });
const regionLaneFields = (lane: HistoryLane<MacroCoord[]>): Pick<EditSlice, 'regionUndoLane' | 'regionRedoLane'> =>
  ({ regionUndoLane: [...lane.undo], regionRedoLane: [...lane.redo] });

/** The `regions` write that sets `owner`'s region to `cells` on `map`, the others kept. */
const ownedRegion = (regions: Regions, cells: MacroCoord[], owner: RegionOwner | null, map: GridState | null): Pick<EditSlice, 'regions'> =>
  (owner ? { regions: { ...regions, [owner]: { cells, map } } } : { regions });

/** The assistant's painting ended by a mode click: its lane waits in its region for the brush to be
 *  picked up again (`setSelectingRegion`). */
function asideAgentLane(s: Pick<EditSlice, 'regions' | 'regionSelectionOwner' | 'regionUndoLane' | 'regionRedoLane'>): Partial<Pick<EditSlice, 'regions'>> | null {
  if (s.regionSelectionOwner !== 'agent') return null;
  const own = s.regions.agent;
  return { regions: { ...s.regions, agent: { cells: own?.cells ?? [], map: own?.map ?? null, lane: regionLane(s) } } };
}

/** The region brush's fields and the map they are read against. */
type RegionFacts = Pick<EditSlice, 'selectingRegion' | 'regionSelectionOwner' | 'regions' | 'regionUndoLane' | 'regionRedoLane'> & Pick<EngineSlice, 'gridState'>;
type BrushFacts = RegionFacts & Pick<EditSlice, 'regionTool' | 'regionRequest'>;
type RegionPatch = Pick<EditSlice, 'regions' | 'regionUndoLane' | 'regionRedoLane'>;

/** The writes that set the painting surface's region to `cells` as one entry of its history, over
 *  that surface's own (`paintedRegion`); null where an empty region replaces an empty one. */
export function regionCommitFields(s: RegionFacts, cells: MacroCoord[]): RegionPatch | null {
  const own = paintedRegion(s);
  if (own.length === 0 && cells.length === 0) return null;
  return { ...ownedRegion(s.regions, cells, s.regionSelectionOwner, s.gridState), ...regionLaneFields(laneRecord(regionLane(s), own)) };
}

/** The writes one step of the painting surface's lane makes; null where that side is empty. */
export function regionStepFields(s: RegionFacts, dir: 'undo' | 'redo'): RegionPatch | null {
  const step = laneStep(regionLane(s), paintedRegion(s), dir);
  return step ? { ...ownedRegion(s.regions, step.restored, s.regionSelectionOwner, s.gridState), ...regionLaneFields(step.lane) } : null;
}

/** Steps the painting surface's lane; false when that side is empty. */
function stepRegion(get: () => RegionFacts, set: (patch: Partial<EditSlice>) => void, dir: 'undo' | 'redo'): boolean {
  const fields = regionStepFields(get(), dir);
  if (fields) set(fields);
  return fields !== null;
}

/** What starting `owner`'s region brush under `request` (`v`) or stopping the one painting writes over
 *  `s`, whose purpose is `purpose`: the request stands while it paints, the region tool moving to the
 *  request's first when it does not offer the current one; a brush picked up again takes the lane its
 *  region kept for it and any other start or stop empties it; Blueprint's frame step ends with any
 *  painting but its own; the brush takes the map's presses, so the picked block goes; and starting it
 *  moves on from the selection. */
export function regionSelectingFields(
  s: BrushFacts & Pick<BlueprintSlice, 'blueprintStep'> & Left, purpose: Purpose, v: boolean, owner: RegionOwner,
  request: RegionRequest = DEFAULT_REGION_REQUEST,
) {
  const step = { selectingRegion: v, regionSelectionOwner: v ? owner : null };
  const asked = v ? request : DEFAULT_REGION_REQUEST;
  const first = asked.tools[0];
  const kept = v && !s.selectingRegion ? s.regions[owner]?.lane : undefined;
  const lane = kept ? regionLaneFields(kept) : { regionUndoLane: [], regionRedoLane: [] };
  const own = s.regions[owner];
  const ended = s.blueprintStep.at === 'frame' && !(v && owner === 'blueprint') ? stepEndFields(s) : null;
  return {
    ...ended,
    ...step,
    ...(asked === s.regionRequest ? null : { regionRequest: asked }),
    ...(v && first && !asked.tools.includes(s.regionTool) ? regionToolFields(first) : null),
    ...(v === s.selectingRegion && !ended ? null : lane),
    ...(kept && own ? { regions: { ...s.regions, [owner]: { cells: own.cells, map: own.map } } } : null),
    ...(v && s.pickedCell ? { pickedCell: null } : null),
    ...(purposeMovesOn(purpose, { ...purpose, painting: v ? owner : null }) ? leftBehindFields(s) : null),
  };
}

export const createEditSlice: StateCreator<EditSlice & Pick<AnnotationsSlice, 'annotationDraft' | 'requestAnnotationDiscard' | 'annotationSelection'> & Pick<EngineSlice, 'gridState' | 'selection' | 'pickedCell'> & Pick<PlanetSessionSlice, 'planetSession'> & Pick<RepairSessionSlice, 'repairSession'> & Pick<ShellSlice, 'tourRunning' | 'tourPhase' | 'deletePopover' | 'contextMenu'> & { blueprint: Pick<BlueprintUi, 'armed'> } & Pick<BlueprintSlice, 'blueprintStep'>, [], [], EditSlice> = (set, get) => ({
  editMode: REST_INPUTS,
  // The catalog's first Road item in authored order — something has to be armed, and nobody has
  // chosen yet.
  tileMaterial: getRoadMaterials()[0]!.id,
  tileMaterialPicked: false,
  roadFamilyMaterials: { roads: null, prints: null },
  autoEdgeCut: 'off',
  eraserShape: 'free',
  displayLayer: null,
  terrainThickness: TERRAIN_THICKNESS.min,
  layerVisibility: {},
  drawingBrushSize: 1,
  eraserBrushSize: 1,
  armingEpoch: 0,
  placementRotation: 0,
  setPlacementRotation: (r) => set({ placementRotation: r }),
  clipboard: null,
  setClipboard: (a) => set({ clipboard: a }),
  carrying: null,
  setCarrying: (card) => set((s) => ({ carrying: card, ...(movesOn(s, { ...s, carrying: card }) ? leftBehindFields(s) : null) })),
  selectingRegion: false,
  regionSelectionOwner: null,
  regionTool: 'free',
  regionBrushShape: 'free',
  regionDimensions: true,
  setRegionDimensions: (visible) => set({ regionDimensions: visible }),
  regionBrushSize: 3,
  regions: {},
  setRegion: (cells, owner) => set((s) => ownedRegion(s.regions, cells, owner, s.gridState)),
  regionUndoLane: [],
  regionRedoLane: [],
  commitRegion: (cells) => {
    const fields = regionCommitFields(get(), cells);
    if (fields) set(fields);
  },
  undoRegion: () => stepRegion(get, set, 'undo'),
  redoRegion: () => stepRegion(get, set, 'redo'),
  setSelectingRegion: (v: boolean, owner?: RegionOwner, request?: RegionRequest) => {
    if (v && !owner) return;
    const change = () => set((s) => regionSelectingFields(s, purposeOf(s), v, owner ?? 'generator', request));
    if (v && get().annotationDraft) get().requestAnnotationDiscard(change);
    else change();
  },
  setRegionTool: (t) => set(regionToolFields(t)),
  setRegionBrushSize: (s) => set({ regionBrushSize: s }),
  regionRequest: DEFAULT_REGION_REQUEST,

  setEditMode: (change) => {
    const editMode = nextEditMode(get().editMode, change);
    if (!modeOpenIn(get().planetSession, editMode.mode, get().repairSession?.phase === 'hand')) return;
    if (editMode.mode === 'annotate' && get().editMode.mode !== 'annotate' && !notesOpenable(get())) return;
    if (get().annotationDraft && editMode.mode !== get().editMode.mode) {
      get().requestAnnotationDiscard(() => get().setEditMode(change));
      return;
    }
    set(editModeFields(get(), editMode));
  },
  restoreEditMode: (inputs) => set(editModeFields(get(), inputs)),
  setTileMaterial: (m) => set((s) => tileMaterialFields(s, m)),
  switchRoadFamily: (family) => set((s) => {
    const from = roadFamilyOf(s);
    const to = family ?? (from === 'roads' ? 'prints' : 'roads');
    const next = s.roadFamilyMaterials[to] ?? getRoadMaterials(to === 'prints')[0]?.id;
    if (to === from || !next) return s;
    return tileMaterialFields({ ...s, roadFamilyMaterials: { ...s.roadFamilyMaterials, [from]: s.tileMaterial } }, next);
  }),
  setAutoEdgeCut: (m) => set({ autoEdgeCut: m }),
  setEraserShape: (m) => set({ eraserShape: m }),
  setDisplayLayer: (layer) => set((s) => (s.displayLayer === layer ? s : { displayLayer: layer })),
  setTerrainThickness: (layers) => set({ terrainThickness: Math.max(TERRAIN_THICKNESS.min, Math.min(TERRAIN_THICKNESS.max, Math.round(layers))) }),
  // Hiding a floor drops the selected members on it; the question or menu over one closes on its
  // own watch (`editing/intent.ts:staleSurfaceFields`).
  setLayerVisibility: (layer, visible) => set((s) => {
    const layerVisibility = { ...s.layerVisibility, [layer]: visible };
    const kept = visible ? s.selection : s.selection.filter(shownOn({ gridState: s.gridState, layerVisibility }));
    return kept.length === s.selection.length ? { layerVisibility } : { layerVisibility, selection: kept };
  }),
  setLayerLocked: (layer, locked) => {
    const grid = get().gridState;
    if (!grid || grid.lockedLayers.has(layer) === locked) return;
    const next = new Set(grid.lockedLayers);
    if (locked) next.add(layer); else next.delete(layer);
    grid.lockedLayers = next;
    // A new Set, so a selector over `gridState.lockedLayers` sees the change this update publishes.
    set({ gridState: grid });
  },
  objectBrush: 'place',
  objectPaintShape: 'free',
  objectPaintSpacing: 0,
  objectBrushBar: false,
  setObjectBrush: (brush) => set({ objectBrush: brush }),
  setObjectPaintShape: (shape) => set({ objectPaintShape: shape }),
  setObjectPaintSpacing: (spacing) => set({ objectPaintSpacing: Math.max(OBJECT_SPACING.min, Math.min(OBJECT_SPACING.max, Math.round(spacing))) }),
  setObjectBrushBar: (open) => {
    set((s) => (open && (s.editMode.mode !== 'object' || brushBarRefusal(s) !== null) ? s : { objectBrushBar: open }));
    // Opening the bar, by the button or its pointer, says the button has been found.
    if (get().objectBrushBar) markBrushHintSeen();
  },
  multiSelectLatched: false,
  moveLatched: false,
  setMultiSelectLatched: (on) => set({ multiSelectLatched: on }),
  setMoveLatched: (on) => set({ moveLatched: on }),
  endTouchLatches: () => { if (get().multiSelectLatched || get().moveLatched) set({ multiSelectLatched: false, moveLatched: false }); },
  setBrushSize: (size) => set((s) => (buildToolOf(s) === 'erase' ? { eraserBrushSize: size } : { drawingBrushSize: size })),
});
