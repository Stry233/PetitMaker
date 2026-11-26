/** Arming a blueprint from the library, turning and flipping it, and laying it on the live map by a press, a drop
 *  or a carry, with what each placement says and selects. */
import type { MacroCoord } from '../../../core/model/types';
import type { BlueprintRecord } from '../../../io/blueprint';
import { blueprintSkipNotices, type CopyNotice } from '../../../i18n/terms/copy-notices';
import { translate } from '../../../i18n/context';
import { showToast } from '../../../platform/channels/toast-bus';
import { groupRefs, groupsSelectable } from '../../../state/placed-groups';
import { useEditorStore } from '../../../state/store';
import { placeBlueprint, type BlueprintLaid, type BlueprintPlacement, type PlacementSkips } from '../../../tools/blueprint';
import type { PasteDoor } from '../../../tools/objects';
import type { Carry } from '../../../view/interaction/pointer/carry';
import { carryCard, type CardHold } from '../card-carry';
import { currentEditor } from '../../session/context';
import { lastBlueprintAuthor, seedOf } from './authorship';
import { editorBlueprintLibrary, recordOf } from './library';
import { shownBlueprints } from './names';

const store = () => useEditorStore.getState();

/** Raises each of `notices` as a toast. */
export const say = (notices: readonly CopyNotice[]): void => { for (const n of notices) showToast(n.text, n.tone); };

/** Lays `record` (as the page shows it) as `p` asks through `door`, by `author`, recording its group. */
export function layBlueprint(door: PasteDoor, record: BlueprintRecord, p: BlueprintPlacement, author: string | null): BlueprintLaid {
  return placeBlueprint(door, record.body, p, seedOf(record, author));
}

/** Arms blueprint `id` from the library at no turn, or disarms with null or an id it lacks. */
export function armBlueprint(id: string | null): void {
  const record = id === null ? undefined : shownBlueprints().find((r) => r.id === id);
  store().setArmedBlueprint(record ? { id: record.id, body: record.body, seed: seedOf(record, lastBlueprintAuthor()) } : null);
}

/** Disarms whenever the library stops holding the armed record; returns the stop. */
export function watchArmedBlueprint(): () => void {
  return editorBlueprintLibrary().subscribe(() => {
    const { armed } = store().blueprint;
    if (armed !== null && !recordOf(armed)) store().setArmedBlueprint(null);
  });
}

/** Turns the armed blueprint a quarter, clockwise for 90. */
export function turnArmedBlueprint(delta: 90 | -90): void {
  store().turnArmedBlueprintBy(delta / 90);
}

/** Flips the armed blueprint to the next place in Flip's cycle. */
export function flipArmedBlueprint(): void {
  store().flipArmedBlueprint();
}

/**
 * What follows a placement of the armed blueprint (the blueprint tool's channel,
 * `tools/pointer/blueprint/channel.ts`), whether a press or a drop made it: one placement puts the
 * blueprint down, as an item placed up to its limit is, so the tool rests; it says what it skipped
 * when it skipped anything, and selects the group it laid, its objects and terrain, for the
 * selection card to turn, move or delete.
 */
export function armedBlueprintPlaced(_p: BlueprintPlacement, laid: BlueprintLaid): void {
  store().setArmedBlueprint(null);
  followPlacement(laid);
}

/** Says what a placement skipped and selects the group it laid; nothing laid leaves nothing selected. */
export function followPlacement(laid: BlueprintLaid): void {
  say(blueprintSkipNotices(translate, laid.skips));
  selectPlacement(laid);
}

/** Selects the group `laid` recorded: whole in Blueprint mode, elsewhere its objects, since only
 *  Blueprint mode selects a group whole (BLUE-07). Nothing laid leaves nothing selected. */
export function selectPlacement(laid: BlueprintLaid): void {
  const s = store();
  const refs = laid.group && s.gridState ? groupRefs(s.gridState, laid.group) : [];
  s.setSelection(groupsSelectable(s) ? refs : refs.filter((r) => r.kind === 'object'), { record: false });
}

/** The editor's door for laying a body, through its own undo history, a lay's changes of objects held as one. */
export function doorOf(ed: NonNullable<ReturnType<typeof currentEditor>>): PasteDoor {
  const { executor } = ed;
  return {
    state: ed.state, registry: executor.getRegistry(), execute: (cmd) => executor.execute(cmd), beginStroke: () => executor.beginStroke(),
    hold: (body) => executor.transaction({}, () => body()),
  };
}

/**
 * Lays the armed blueprint with its frame's top-left on `cell`, at its turn and flip on the surface under it,
 * as one undo step, followed as a press of the blueprint tool is (`armedBlueprintPlaced`). Null with
 * nothing armed or no map; an armed record the library no longer holds is disarmed.
 */
export function placeArmedAt(cell: MacroCoord): PlacementSkips | null {
  const ed = currentEditor();
  const s = store();
  const { armed, body, seed, quarters, mirror, flip } = s.blueprint;
  if (!ed || armed === null || body === null) return null;
  if (!recordOf(armed)) { s.setArmedBlueprint(null); return null; }
  const p: BlueprintPlacement = { at: cell, quarters, ...(mirror ? { mirror } : null) };
  const laid = placeBlueprint(doorOf(ed), body, p, seed ? { ...seed, flip } : undefined);
  armedBlueprintPlaced(p, laid);
  return laid.skips;
}

/**
 * Carries blueprint `id` from the strip or the explorer onto the map (`card-carry.ts:carryCard`):
 * armed for the carry, so the map shows the armed tool's ghost under the pointer, and a release over
 * the map places it once and puts it down, as a press does (`armedBlueprintPlaced`); any other ending
 * puts back what was armed, at its turn and flip. Null when `id` cannot be armed.
 */
export function carryBlueprint(id: string, hold: CardHold): Carry | null {
  const was = store().blueprint;
  const kept = was.armed === id;
  return carryCard(id, hold, {
    arm: () => {
      if (!kept) armBlueprint(id);
      return store().blueprint.armed === id;
    },
    giveBack: () => {
      if (kept) return;
      store().setArmedBlueprint(was.armed !== null && was.body !== null && was.seed !== null ? { id: was.armed, body: was.body, seed: was.seed } : null, was);
    },
    // A drop the map took is a placement, which put the blueprint down (`armedBlueprintPlaced`).
    dropped: () => store().setArmedBlueprint(null),
  });
}
