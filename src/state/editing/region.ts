/**
 * The painted regions and which readers see them. The store holds one region per surface that
 * paints one, with the map it was painted on (`slices/edit.ts:regions`); every reader asks for its
 * own here, so Generate's scope, the assistant's boundary and a blueprint's frame never stand in for
 * one another, painting one never discards another, and a region left on another map reads as none.
 */
import type { GridState, MacroCoord } from '../../core/model/types';
import type { HistoryLane } from '../history-lane';
import type { ShellSlice } from '../slices/shell';
import type { RegionRequest, RegionTool } from './vocabulary';

/** The surfaces that paint a region: Generate's scope screen, the assistant panel, Blueprint's frame step. */
export type RegionOwner = 'agent' | 'generator' | 'blueprint';

/** One surface's region: its cells and the map they were painted on, with the brush's lane while a
 *  painting set aside by a mode click waits to be picked up again. */
export interface PaintedRegion {
  readonly cells: MacroCoord[];
  readonly map: GridState | null;
  readonly lane?: HistoryLane<MacroCoord[]>;
}

export type Regions = Readonly<Partial<Record<RegionOwner, PaintedRegion>>>;

/** The store facts a region is read from. */
interface RegionFacts {
  readonly gridState: GridState | null;
  readonly regions: Regions;
  readonly selectingRegion: boolean;
  readonly regionSelectionOwner: RegionOwner | null;
}

/** The one empty answer, so a selector over a region keeps its identity while none is painted. */
const NO_CELLS: MacroCoord[] = [];

/** `owner`'s region on the live map, `[]` for none (the whole map). */
export function regionOf(s: RegionFacts, owner: RegionOwner): MacroCoord[] {
  const own = s.regions[owner];
  return own && own.map === s.gridState ? own.cells : NO_CELLS;
}

/** Whether `owner`'s region brush is painting now. */
export function paintsRegion(s: Pick<RegionFacts, 'selectingRegion' | 'regionSelectionOwner'>, owner: RegionOwner): boolean {
  return s.selectingRegion && s.regionSelectionOwner === owner;
}

/** The region the brush paints now, its painter's own; `[]` while no brush paints. */
export function paintedRegion(s: RegionFacts): MacroCoord[] {
  return s.selectingRegion && s.regionSelectionOwner ? regionOf(s, s.regionSelectionOwner) : NO_CELLS;
}

/** The surface in front of the map and its region, the one the map's region overlay shows: the
 *  surface painting now, else Generate's scope while Generate mode is open, else the assistant's
 *  while its panel is open; null for none. */
export function frontRegion(
  s: RegionFacts & { readonly editMode: { readonly mode: string | null } } & Readonly<Pick<ShellSlice, 'assistantOpen'>>,
): { owner: RegionOwner; cells: MacroCoord[] } | null {
  const owner: RegionOwner | null = s.selectingRegion && s.regionSelectionOwner ? s.regionSelectionOwner
    : s.editMode.mode === 'generate' ? 'generator'
      : s.assistantOpen ? 'agent' : null;
  return owner ? { owner, cells: regionOf(s, owner) } : null;
}

/** The cells of the region in front (`frontRegion`), `[]` for none: what a paste aims into. */
export function regionOnScreen(s: Parameters<typeof frontRegion>[0]): MacroCoord[] {
  return frontRegion(s)?.cells ?? NO_CELLS;
}

/** The fields choosing region tool `t` writes: a figure is also the shape the brush keeps. */
export const regionToolFields = (t: RegionTool): { regionTool: RegionTool; regionBrushShape?: Exclude<RegionTool, 'erase'> } =>
  (t === 'erase' ? { regionTool: t } : { regionTool: t, regionBrushShape: t });

/** What the painting brush is asked for: the request its surface started it under (`slices/edit.ts:setSelectingRegion`). */
export function regionRequestOf(s: { readonly regionRequest: RegionRequest }): RegionRequest {
  return s.regionRequest;
}
