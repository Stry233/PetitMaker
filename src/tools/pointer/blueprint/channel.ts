/** What the blueprint tool tells the editor it serves after each placement it lays, and the drag the
 *  editor offers for a placement it holds selected. */
import type { MacroCoord } from '../../../core/model/types';
import type { BlueprintLaid, BlueprintPlacement, BlueprintPreview } from '../../blueprint/place';
import type { BlockRef } from '../../../state/selection';

export type { BlueprintLaid };

/** A placed blueprint selected as a group, as a drag of its selection reads it: the drag moves it
 *  whole rather than lifting its objects alone off the terrain they were laid with, and a copy drag
 *  (EDIT-60) lays a copy of it whole. */
export interface PlacementDrag {
  /** The group's frame top-left while `selection` is that group and the press is on one of its
   *  objects or a cell of its frame; null otherwise. */
  held(selection: readonly BlockRef[], on: { object: string } | { cell: MacroCoord }): MacroCoord | null;
  /** What the group would lay with its frame's top-left at `at`, judged on the map without it, or
   *  for a `copy` on the map as it stands. */
  preview(at: MacroCoord, copy: boolean): BlueprintPreview | null;
  /** Takes the group back and lays it with its frame's top-left at `at`, as one undo step. */
  move(at: MacroCoord): void;
  /** Lays a copy of the group with its frame's top-left at `at` as a new group, as one undo step. */
  copy(at: MacroCoord): void;
}

export interface BlueprintChannel {
  /** Hears each placement after it lands, laid as `p` asked with the group it recorded; the editor
   *  puts the blueprint down, says what was skipped and selects the group. */
  blueprintPlaced: (p: BlueprintPlacement, laid: BlueprintLaid) => void;
  /** The editor's drag of the placement it holds selected; absent on a host with no editor behind it. */
  placementDrag?: PlacementDrag;
}
