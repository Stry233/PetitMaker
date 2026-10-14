/**
 * The custom-planet session: whether the editor is shaping a planet template, where layer 0 (sea
 * and bare ground) is editable, and which material the mountain-mode brush lays there.
 *
 * Self-contained: no setter here reads another slice, so this slice takes no cross-slice
 * dependency.
 */
import type { StateCreator } from 'zustand';
import type { GridState, MacroCoord } from '../../core/model/types';
import type { BlockRef } from '../selection';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { BuildMode, EditModeInputs } from '../editing/edit-mode';
import type { ViewMode } from '../../platform/storage/prefs';
import type { CameraAngle, View2dCamera } from '../view-camera';
import type { EditSlice } from './edit';
import type { AnnotationsSlice } from './annotations';

/** The live editor fields a parked map carries and gets back: its layer choices and annotation lanes.
 *  Its layer locks stay on its own `GridState`. */
const PARKED_FIELDS = ['activeLayer', 'layerPinned', 'layerVisibility', 'annotationUndoLane', 'annotationRedoLane'] as const;
type ParkedFields = Pick<EditSlice & AnnotationsSlice, typeof PARKED_FIELDS[number]>;

/** `PARKED_FIELDS` read off `source`. */
export function parkedFields(source: ParkedFields): ParkedFields {
  return Object.fromEntries(PARKED_FIELDS.map((key) => [key, source[key]])) as unknown as ParkedFields;
}

/** The map the session set aside, held by identity so leaving hands back the same executor and undo stack. */
export interface ParkedEditor extends ParkedFields {
  gridState: GridState;
  executor: CommandExecutor;
  selection: BlockRef[];
  /** The painted generation region, a scope that belongs to this map. */
  region: MacroCoord[];
  editMode: EditModeInputs;
  /** Null when that view had no camera to read. */
  camera2d: View2dCamera | null;
  camera3d: CameraAngle | null;
  viewMode: ViewMode;
}

export interface PlanetSession {
  /** The saved planet this session edits, or null for one not yet saved. */
  entryId: string | null;
  /** The entry's stored name, which may still await the text check; empty for a new planet. */
  name: string;
  /** Whether `name` has passed the text check; true for a new planet. */
  nameReviewed: boolean;
  parked: ParkedEditor;
  /** What a planet read from a scan asks the person to check; absent for a drawn or saved one. */
  review?: PlanetReview;
}

/** Cells of a scanned planet to check: canvas cells whose ground was inferred near the grass's
 *  outline, and whether the landmark's place or turn was inferred. */
export interface PlanetReview {
  readonly cells: readonly MacroCoord[];
  readonly landmark: boolean;
  /** Ids of the landmarks left for the person to place. */
  readonly unplaced?: readonly string[];
}

/** What the mountain brush lays in the planet session: grass ground, stacking up to
 *  `PLANET_PROFILE.maxLayer`, or flat sand. */
export const PLANET_MATERIALS = ['mountain', 'sand'] as const;

/** The build modes a planet session offers, ground first; every other mode waits until it ends. */
export const SESSION_BUILD_MODES = ['mountain', 'water', 'object'] as const satisfies readonly BuildMode[];
export type PlanetMaterial = typeof PLANET_MATERIALS[number];

export interface PlanetSessionSlice {
  /** Null outside the planet session. */
  planetSession: PlanetSession | null;
  setPlanetSession: (session: PlanetSession | null) => void;
  planetMaterial: PlanetMaterial;
  setPlanetMaterial: (material: PlanetMaterial) => void;
  /** Whether the session's review cells are drawn on the map; each session with a review starts with them shown. */
  planetReviewShown: boolean;
  setPlanetReviewShown: (shown: boolean) => void;
}

export const createPlanetSessionSlice: StateCreator<PlanetSessionSlice, [], [], PlanetSessionSlice> = (set) => ({
  planetSession: null,
  setPlanetSession: (planetSession) => set(planetSession?.review ? { planetSession, planetReviewShown: true } : { planetSession }),
  planetMaterial: 'mountain',
  setPlanetMaterial: (planetMaterial) => set({ planetMaterial }),
  planetReviewShown: true,
  setPlanetReviewShown: (planetReviewShown) => set({ planetReviewShown }),
});
