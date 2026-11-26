/** A placed blueprint's group on the live map: in Blueprint mode the selection card names, turns,
 *  flips, moves and deletes a selected group whole (`state/placed-groups.ts`), a drag of it moves it and a
 *  Ctrl+drag lays a copy, and a copy of it pastes as a placement of its blueprint. */
import { rectContains } from '../../../core/grid/rect';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { groupRecipe, liveMembers, mapGroups, type PlacedGroup } from '../../../core/model/placed-group';
import { translate } from '../../../i18n/context';
import { blueprintSkipNotices, pasteNotices } from '../../../i18n/terms/copy-notices';
import type { Arrangement } from '../../../state/clipboard';
import { selectedGroup } from '../../../state/placed-groups';
import { useEditorStore, type EditorStore } from '../../../state/store';
import { textApproved } from '../../../state/text-verdicts';
import {
  copyGroup, flippedPlacement, groupFlip, groupTurn, layGroupCopy, mapWithout, movedPlacement, pasteGroupAt, previewBlueprint, previewGroupAt,
  relayGroup, takeBackGroup, turnedPlacement,
  type BlueprintLaid, type BlueprintPlacement, type BlueprintPreview,
} from '../../../tools/blueprint';
import type { PlacementDrag } from '../../../tools/pointer/blueprint';
import type { GroupRotation, PasteAim } from '../../../tools/objects';
import type { GhostBlock, GhostPrior } from '../../../tools/pointer/runtime';
import { getActiveView } from '../../../view/active-view';
import { currentEditor } from '../../session/context';
import { recordOf } from './library';
import { appNameOf } from './names';
import { doorOf, followPlacement, say } from './placing';

const store = () => useEditorStore.getState();

/** The name of the placed blueprint the selection is in Blueprint mode: in the interface language
 *  while the library holds that blueprint under the app's own name, else as the page showed it at
 *  placement, or its numbered placeholder while the text check has not approved a name a map file
 *  brought; null otherwise. A store selector, which also reads the library and the text verdicts. */
export function selectedGroupName(s: EditorStore): string | null {
  const group = selectedGroup(s);
  if (!group) return null;
  const own = recordOf(group.blueprint);
  if (own?.appName) return appNameOf(own);
  return textApproved(group.name) ? group.name : translate('blueprint.default_name', { n: mapGroups(s.gridState!).indexOf(group) + 1 });
}

/**
 * Turns the selected group a quarter about its frame's centre, clockwise for 1: takes back exactly
 * its standing members and lays them again turned where it stood, so other work is never touched; the
 * turn is one undo step of its own, whose undo gives the group back as it stood. What no longer lands
 * is skipped and said, as a placement says it. False when the selection is no group.
 */
export function turnSelectedGroup(turn: 1 | -1): boolean {
  const group = selectedGroup(store());
  return !!group && relay(group, turnedPlacement(group, turn), (state, laid) => groupTurn(state, laid, turn));
}

/** Moves the selected group whole, its frame's top-left to `at`, as `turnSelectedGroup` turns it.
 *  False when the selection is no group. */
export function moveSelectedGroup(at: MacroCoord): boolean {
  const group = selectedGroup(store());
  return !!group && relay(group, movedPlacement(at));
}

/** Flips the selected group to the next place in Flip's cycle about its frame's centre, as
 *  `turnSelectedGroup` turns it, keeping it the same group. False when the selection is no group. */
export function flipSelectedGroup(): boolean {
  const group = selectedGroup(store());
  if (!group) return false;
  const { p, turn, flip } = flippedPlacement(group);
  return relay(group, p, (state, laid) => groupFlip(state, laid, turn), flip);
}

/** Lays `group` again as `p` asks, at `flip` in Flip's cycle, and selects it, playing `motion` of
 *  what landed. Where nothing of it would land, judged on the map without it, the turn, flip or move
 *  is refused with what it would skip said, and the group stays. */
function relay(
  group: PlacedGroup, p: BlueprintPlacement, motion?: (state: GridState, laid: PlacedGroup) => GroupRotation, flip = group.flip,
): boolean {
  const ed = currentEditor();
  const plan = previewGroup(group, p);
  if (!ed || !plan) return false;
  if (plan.cells.length === 0 && plan.objects.length === 0) {
    say(blueprintSkipNotices(translate, { ground: plan.blocked.length, objects: liveMembers(ed.state, group).objects.length, capped: 0, unknown: 0 }));
    return false;
  }
  const laid = relayGroup(doorOf(ed), group, p, flip);
  if (!laid) return false;
  followPlacement(laid);
  if (motion && laid.group) playTurn(laid.group, motion(ed.state, laid.group));
  return true;
}

/** Plays `turn` (`tools/blueprint/group.ts:groupTurn` or `groupFlip`) on the view: the placement's
 *  objects arc or flip on the object group's tween, and the terrain it laid moves with them as one body. */
function playTurn(group: PlacedGroup, turn: GroupRotation): void {
  const state = store().gridState;
  const view = getActiveView();
  if (!state || !view) return;
  if (turn.members.length > 0) view.animateGroupRotation(turn);
  const { cells } = liveMembers(state, group);
  view.overlay.turnBlocks?.(
    cells.map((c): GhostBlock => ({ x: c.x, y: c.y, terrain: c.laid })),
    cells.map((c): GhostPrior => ({ x: c.x, y: c.y, terrain: c.prior })), turn.pivot, turn.sweepDeg, turn.flip,
  );
}

/** The map without a group's members, detached, for a drag's previews: kept per group while the map
 *  stands as it was when it was worked out. */
const withoutGroup = new WeakMap<PlacedGroup, { state: GridState; cells: number; objects: number; without: GridState }>();

/** What `group` would lay as `p` asks, judged on the map without it. */
function previewGroup(group: PlacedGroup, p: BlueprintPlacement): BlueprintPreview | null {
  const ed = currentEditor();
  if (!ed) return null;
  const { state } = ed;
  let kept = withoutGroup.get(group);
  if (!kept || kept.state !== state || kept.cells !== state.cellsVersion || kept.objects !== state.objectsVersion) {
    kept = { state, cells: state.cellsVersion, objects: state.objectsVersion, without: mapWithout(state, group) };
    withoutGroup.set(group, kept);
  }
  return previewGroupAt(doorOf(ed), kept.without, group, p);
}

/** Takes back exactly the selected group's standing members, its objects and its terrain, as an
 *  edit of its own that an undo reverses; the selection empties. False when the selection is no group. */
export function takeBackSelectedGroup(): boolean {
  const group = selectedGroup(store());
  const ed = currentEditor();
  if (!group || !ed) return false;
  store().setSelection([], { record: false });
  takeBackGroup(doorOf(ed), group);
  return true;
}

/** What a copy of `group` would lay with its frame's top-left at `at`, judged on the map as it
 *  stands, the group included. */
function previewCopy(group: PlacedGroup, at: MacroCoord): BlueprintPreview | null {
  const ed = currentEditor();
  return ed ? previewBlueprint(doorOf(ed), groupRecipe(ed.state, group), movedPlacement(at)) : null;
}

/**
 * Lays a copy of the selected group with its frame's top-left at `at` (a Ctrl+drag's drop, EDIT-60),
 * as one undo step recording a new group of its blueprint, leaving the group where it stands; what
 * does not land is skipped and said, and the copy becomes the selection. Where nothing of it would
 * land nothing changes and that is said. False when the selection is no group.
 */
function copySelectedGroupTo(at: MacroCoord): boolean {
  const group = selectedGroup(store());
  const ed = currentEditor();
  const plan = group && previewCopy(group, at);
  if (!group || !ed || !plan) return false;
  if (plan.cells.length === 0 && plan.objects.length === 0) {
    say(blueprintSkipNotices(translate, { ground: plan.blocked.length, objects: liveMembers(ed.state, group).objects.length, capped: 0, unknown: 0 }));
    return false;
  }
  const laid = layGroupCopy(doorOf(ed), copyGroup(ed.state, group), at);
  if (laid) followPlacement(laid);
  return true;
}

/** Lays one copy of the placed blueprint `a` holds where `aim` asks (`tools/blueprint/paste.ts:pasteGroupAt`)
 *  and says where it went, whether there was room and what it skipped; what it laid, or null. */
export function pasteGroupCopy(a: Arrangement, aim: PasteAim): BlueprintLaid | null {
  const ed = currentEditor();
  if (!ed) return null;
  const out = pasteGroupAt(doorOf(ed), a, aim);
  say(pasteNotices(translate, { nearby: out.nearby, noRoom: out.noRoom, capped: 0 }));
  if (out.laid) say(blueprintSkipNotices(translate, out.laid.skips));
  return out.laid;
}

/** The drag of the group the live selection is, which moves it whole or with Ctrl lays a copy; the
 *  editor's tool wiring hands it to the map's object drag (`tools/pointer/blueprint/channel.ts:PlacementDrag`). */
export const selectedGroupDrag: PlacementDrag = {
  held: (_selection, on) => {
    const group = selectedGroup(store());
    if (!group) return null;
    const at = { x: group.frame.x, y: group.frame.y };
    if ('object' in on) return group.objects.some((o) => o.id === on.object) ? at : null;
    return rectContains(group.frame, on.cell.x, on.cell.y) ? at : null;
  },
  preview: (at, copy) => {
    const group = selectedGroup(store());
    if (!group) return null;
    return copy ? previewCopy(group, at) : previewGroup(group, movedPlacement(at));
  },
  move: (at) => { moveSelectedGroup(at); },
  copy: (at) => { copySelectedGroupTo(at); },
};
