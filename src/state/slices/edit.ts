/**
 * Edit state: the `editMode` inputs (and the four facts they resolve into), the tile material,
 * auto edge-cut mode, layer selection/visibility/locks, brush size, the armed item's pending
 * rotation, and the region-select tool with the cells it has painted. Everything the build brushes
 * and the placer read while a stroke is being planned, as opposed to `engine`'s grid/command
 * handles or `shell`'s chrome.
 */
import type { StateCreator } from 'zustand';
import {
  ToolType,
  type AutoEdgeCut,
  type EraserShape,
  type DesignMode,
  type MacroCoord,
  type RegionTool,
} from '../../core/model/types';
import {
  nextEditMode, resolveEditMode, REST_INPUTS,
  type ContentType, type EditModeInputs, type EditModePatch,
} from '../../core/model/edit-mode';
import { getRoadMaterials } from '../catalog';

export interface EditSlice {
  activeTool: ToolType;
  // The current UI tool/mode (brush/line/.../eraser/hand/edge-cut). Single source
  // of truth — PixiCanvas derives DrawingTool.mode from this for drawing modes.
  designMode: DesignMode;
  contentType: ContentType;
  /** The mode and the ONE arming `setEditMode` resolves into `activeTool`/`designMode`/
   *  `contentType`/`selectedItemId`, so those four cannot disagree with each other. `setEditMode`
   *  is the ONLY writer of any of the four. `tool`/`shape` are projections for callers not yet
   *  migrated onto `arming`. */
  editMode: EditModeInputs;
  /** A road catalog id, e.g. 'path-overgrown-dirt'. The tile brush can lay any item in the Road category. */
  tileMaterial: string;
  /**
   * Whether a HAND put `tileMaterial` where it is, as opposed to it being the catalog's first road
   * because something had to be armed. The same distinction `layerPinned` draws, and it has the same
   * one reader: the road macros take their surface from the MAP when nobody has chosen (a new lane
   * comes out matching the street it grows from) and from the bar when somebody has.
   *
   * `setTileMaterial` is the only writer of either, so the two cannot come apart.
   */
  tileMaterialPicked: boolean;
  autoEdgeCut: AutoEdgeCut;     // auto corner-trim mode for the build brushes
  /**
   * What the eraser takes back in one gesture: a DAB under the brush, or a rectangle/circle dragged
   * out and taken on release. It is the eraser's own setting rather than the row's shape, because
   * the row's shape arms what the DRAWING tool lays and the eraser is a different tool: switching to
   * the eraser must not inherit the shape you were painting with, nor lose it on the way back.
   */
  eraserShape: EraserShape;
  activeLayer: number;          // build floor: the layer the user explicitly selected
  /**
   * Whether a HAND put `activeLayer` where it is, as opposed to it being wherever the automatic
   * default sits. The water brush is the reader: PINNED it lays water at that layer everywhere the
   * rules allow, AUTOMATIC it follows each cell's own surface as the stroke travels.
   *
   * Pressing the pinned layer's row again lets go of it (`selectLayer`). The control that pins is
   * the one that unpins, so the state needs no chrome of its own; the panel does not yet DRAW the
   * difference between a pinned layer and a highlighted one.
   */
  layerPinned: boolean;
  displayLayer: number | null;  // transient pill highlight while auto-stacking (null → activeLayer)
  layerVisibility: Record<number, boolean>;
  layerLocked: Record<number, boolean>;
  brushSize: number;
  selectedItemId: string | null;
  /** The armed macro's id, derived by `setEditMode` exactly as `selectedItemId` is. */
  armedMacro: string | null;
  /**
   * How many times the armed macro has CHANGED. Counting is what a comparison of the id itself
   * cannot do: `road-link` to `patch-tree` and back leaves the id where it started, so anything
   * holding state across that round trip (a `road-link` mark waiting for its second tap) reads the
   * arming as untouched and acts on a gesture the user abandoned two clicks ago.
   */
  armingEpoch: number;
  /** The armed item's PENDING rotation — turned by the rotate shortcuts while its ghost is showing,
   *  read by the ghost preview and the placement it lands. Lives here (not the placer tool instance)
   *  because the shortcut engine, the ghost preview, and the placement command are three separate
   *  call sites that all need it, and only two of those touch a tool at all. Reset by `setEditMode`
   *  whenever the armed item changes, so a fresh item starts at its natural orientation; nothing
   *  reads it while nothing is armed. */
  placementRotation: 0 | 90 | 180 | 270;
  setPlacementRotation: (r: 0 | 90 | 180 | 270) => void;
  selectingRegion: boolean;
  regionTool: RegionTool;
  regionBrushSize: number;
  /** The painted region: the macro cells the region-select tool has collected, which scope a
   *  generate, a clear and an agent run. `[]` is the ONE representation of "no region painted"
   *  (whole map), matching `selection`'s empty-list contract; the cells are deduplicated as they
   *  are painted, so `region.length` IS the selected-cell count with no scan and no second field.
   *  Session-only, deliberately: it is a scope for the next run, not a property of the map, and it
   *  is dropped when the run that used it finishes. */
  region: MacroCoord[];
  setRegion: (cells: MacroCoord[]) => void;
  setSelectingRegion: (v: boolean) => void;
  setRegionTool: (t: RegionTool) => void;
  setRegionBrushSize: (s: number) => void;
  /** Resolves the patch against `editMode` and derives `activeTool`/`designMode`/`contentType`/
   *  `selectedItemId` from it in one `set` — the only writer of any of the four. */
  setEditMode: (patch: EditModePatch) => void;
  setTileMaterial: (m: string) => void;
  setAutoEdgeCut: (m: AutoEdgeCut) => void;
  setEraserShape: (m: EraserShape) => void;
  /** Move the build floor by hand — the rail's steppers, the layer.up/down commands. Every caller
   *  is a person choosing a layer, so this PINS it. Nothing automatic comes through here: the water
   *  brush's per-cell layer moves the highlight (`setDisplayLayer`), never the floor. */
  setActiveLayer: (layer: number) => void;
  /** A press on a layer ROW: pin that layer, or let go of it if it is the pinned one already. */
  selectLayer: (layer: number) => void;
  setDisplayLayer: (layer: number | null) => void;
  setLayerVisibility: (layer: number, visible: boolean) => void;
  setLayerLocked: (layer: number, locked: boolean) => void;
  setBrushSize: (size: number) => void;
}

export const createEditSlice: StateCreator<EditSlice, [], [], EditSlice> = (set, get) => ({
  activeTool: ToolType.Hand,
  designMode: 'hand' as DesignMode,
  contentType: 'mountain' as const,
  editMode: REST_INPUTS,
  // The catalog's first Road item in authored order — something has to be armed, and nobody has
  // chosen yet.
  tileMaterial: getRoadMaterials()[0]!.id,
  tileMaterialPicked: false,
  autoEdgeCut: 'off' as AutoEdgeCut,
  eraserShape: 'dot' as EraserShape,
  activeLayer: 0,   // Ground selected by default — an empty map shows only Ground (build floors to 1)
  layerPinned: false,   // nobody has chosen a layer yet
  displayLayer: null,
  layerVisibility: {} as Record<number, boolean>,
  layerLocked: {} as Record<number, boolean>,
  brushSize: 1,
  selectedItemId: null,
  armedMacro: null,
  armingEpoch: 0,
  placementRotation: 0,
  setPlacementRotation: (r) => set({ placementRotation: r }),
  selectingRegion: false,
  regionTool: 'brush' as const,
  regionBrushSize: 3,
  region: [],
  setRegion: (cells) => set({ region: cells }),
  setSelectingRegion: (v) => set({ selectingRegion: v }),
  setRegionTool: (t) => set({ regionTool: t }),
  setRegionBrushSize: (s) => set({ regionBrushSize: s }),

  setEditMode: (patch) => {
    const editMode = nextEditMode(get().editMode, patch);
    const resolved = resolveEditMode(editMode);
    // A freshly armed (or disarmed) item starts at its natural orientation, so a rotation left
    // over from the last one is never picked up by the next placement.
    const armedChanged = resolved.armedItem !== get().selectedItemId;
    // Choosing what to build puts the region brush away. Both arm the pointer and the region
    // outranks the tool, so leaving it on would hand every press to the brush that paints a
    // scope while the map showed a mode that paints terrain. Only a change of MODE does this:
    // picking another tool or item inside the mode the region was painted for is not leaving it.
    const leftRegion = editMode.mode !== get().editMode.mode && get().selectingRegion;
    const macroChanged = resolved.armedMacro !== get().armedMacro;
    set({
      editMode,
      displayLayer: null,
      activeTool: resolved.toolType,
      designMode: resolved.designMode,
      contentType: resolved.contentType,
      selectedItemId: resolved.armedItem,
      armedMacro: resolved.armedMacro,
      ...(macroChanged ? { armingEpoch: get().armingEpoch + 1 } : null),
      ...(armedChanged ? { placementRotation: 0 } : null),
      ...(leftRegion ? { selectingRegion: false } : null),
    });
  },
  setTileMaterial: (m) => set({ tileMaterial: m, tileMaterialPicked: true }),
  setAutoEdgeCut: (m) => set({ autoEdgeCut: m }),
  setEraserShape: (m) => set({ eraserShape: m }),
  setActiveLayer: (layer) => set({ activeLayer: layer, layerPinned: true, displayLayer: null }),
  selectLayer: (layer) => set((s) => ({
    activeLayer: layer,
    layerPinned: !(s.layerPinned && s.activeLayer === layer),
    displayLayer: null,
  })),
  setDisplayLayer: (layer) => set((s) => (s.displayLayer === layer ? s : { displayLayer: layer })),
  setLayerVisibility: (layer, visible) => set((s) => ({
    layerVisibility: { ...s.layerVisibility, [layer]: visible },
  })),
  setLayerLocked: (layer, locked) => set((s) => ({
    layerLocked: { ...s.layerLocked, [layer]: locked },
  })),
  setBrushSize: (size) => set({ brushSize: size }),
});
