/*
 * Placed blueprints as the selection holds them. In Blueprint mode a group is selected as a whole:
 * the selection is then exactly its standing members, its objects then its terrain cells, which the
 * selection marks outline as its frame and the selection card turns, moves and deletes as one.
 */
import type { Rect } from '../core/grid/rect';
import type { GridState, MacroCoord } from '../core/model/types';
import { groupAt, groupOf, liveMembers, type PlacedGroup } from '../core/model/placed-group';
import type { BuildMode } from './editing/edit-mode';
import { sameSelection, type BlockRef } from './selection';

/** What the group readers ask of the store. */
interface GroupView {
  readonly gridState: GridState | null;
  readonly selection: readonly BlockRef[];
  readonly editMode: { readonly mode: BuildMode };
}

/** The selection a group makes: its standing objects, then its standing terrain cells. */
export function groupRefs(state: GridState, group: PlacedGroup): BlockRef[] {
  const { objects, cells } = liveMembers(state, group);
  return [
    ...objects.map((o) => ({ kind: 'object', id: o.id }) as const),
    ...cells.map((c) => ({ kind: 'terrain', x: c.x, y: c.y }) as const),
  ];
}

/** Whether presses select placed blueprints whole: in Blueprint mode only. */
export const groupsSelectable = (s: Pick<GroupView, 'editMode'>): boolean => s.editMode.mode === 'blueprint';

/** Where a pointer or a selection stands: an object id or a terrain cell, and for a pointer the
 *  object-grid cell under it. */
export type GroupProbe = ({ object: string } | { cell: MacroCoord }) & { readonly at?: MacroCoord };

/** The group whose frame holds `on.at`, the last placed where frames overlap, whatever stands there,
 *  else the one `on` is a live member of (a laid cell reaches half a cell past the frame). */
const groupFor = (state: GridState, on: GroupProbe): PlacedGroup | null => (on.at && groupAt(state, on.at)) || groupOf(state, on);

/** The group a press on `on` selects whole, with that selection: on an object of the selection, the
 *  group the selection is or none, so selected objects come before every frame; elsewhere the group
 *  holding `on`. Null outside Blueprint mode or off every group. */
export function groupUnder(s: GroupView, on: GroupProbe): { group: PlacedGroup; refs: BlockRef[] } | null {
  const state = s.gridState;
  if (!state || !groupsSelectable(s)) return null;
  const selected = 'object' in on && s.selection.some((r) => r.kind === 'object' && r.id === on.object);
  const group = selected ? selectedGroup(s) : groupFor(state, on);
  return group ? { group, refs: groupRefs(state, group) } : null;
}

/** The last answer of `selectedGroup` and what it read, so a store update that changed none of it
 *  asks no group again. */
let lastSelected: {
  selection: readonly BlockRef[]; state: GridState | null; groups: unknown; cells: number; objects: number; mode: BuildMode; group: PlacedGroup | null;
} | null = null;

/** The group the selection is, exactly its standing members, in Blueprint mode; null otherwise. */
export function selectedGroup(s: GroupView): PlacedGroup | null {
  const state = s.gridState;
  const k = lastSelected;
  if (k && k.selection === s.selection && k.state === state && k.groups === state?.groups && k.mode === s.editMode.mode
    && k.cells === state?.cellsVersion && k.objects === state?.objectsVersion) return k.group;
  const first = s.selection[0];
  const found = state && first && groupsSelectable(s) ? groupFor(state, first.kind === 'object' ? { object: first.id } : { cell: first }) : null;
  const group = state && found && sameSelection(s.selection, groupRefs(state, found)) ? found : null;
  lastSelected = {
    selection: s.selection, state, groups: state?.groups, cells: state?.cellsVersion ?? 0, objects: state?.objectsVersion ?? 0, mode: s.editMode.mode, group,
  };
  return group;
}

/** The frame of the group the selection is, which the selection marks outline as one; null otherwise. */
export function selectedGroupFrame(s: GroupView): Rect | null {
  return selectedGroup(s)?.frame ?? null;
}
