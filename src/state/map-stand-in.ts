/**
 * A map the views draw in place of the live one, while the live map stays the one every edit, the
 * history, autosave and the selection work on. A stand-in names the live map it stands for, so it
 * shows only over that map and a map swap retires it at once; whatever the views draw thus stands
 * for the live map of the moment, which is how a view tells two maps drawn over one place.
 */
import type { GridState } from '../core/model/types';

export interface MapStandIn {
  /** The live map it stands for. */
  readonly for: GridState;
  /** What the views draw instead. */
  readonly shown: GridState;
}

/** A stand-in drawing `shown` over the live map `live`. */
export function standIn(live: GridState, shown: GridState): MapStandIn {
  return { for: live, shown };
}

/** The map the views draw: the stand-in's while one stands for the live map, else the live map. */
export function shownMap(s: { gridState: GridState | null; mapStandIn: MapStandIn | null }): GridState | null {
  return s.mapStandIn && s.mapStandIn.for === s.gridState ? s.mapStandIn.shown : s.gridState;
}

/** Whether the views draw a stand-in now, so a press on the map has nothing it draws to act on. */
export function standInShown(s: { gridState: GridState | null; mapStandIn: MapStandIn | null }): boolean {
  return shownMap(s) !== s.gridState;
}
