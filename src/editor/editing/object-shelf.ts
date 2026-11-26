/** What the object shelf's presses and category choice do to what is armed. */
import type { CategoryId, GridState, PlacedObject } from '../../core/model/types';
import type { KernelEvents } from '../../core/commands/events';
import type { MacroId } from '../../tools/macros';
import { getCatalogItem } from '../../state/catalog';
import { useEditorStore } from '../../state/store';
import { macroForShelfCategory } from '../../tools/macros';
import { armedItemOf, armedMacroOf, armedPicksOf } from '../../state/editing/edit-mode';
import { placesOneAtATime } from '../../state/object-geometry';
import { getObjectIndex } from '../../state/object-index';
import type { Carry } from '../../view/interaction/pointer/carry';
import { carryCard, type CardHold } from './card-carry';

/** Puts down an armed item or planting card the shelf tab `category` does not hold, so no ghost outlives its card. */
export function disarmOutsideCategory(category: CategoryId): void {
  const s = useEditorStore.getState();
  const item = armedItemOf(s), macro = armedMacroOf(s);
  if (item && getCatalogItem(item)?.category !== category) s.setEditMode({ mode: 'object', arm: { kind: 'none' } });
  else if (macro && macro !== macroForShelfCategory(category)) s.setEditMode({ mode: 'object', arm: { kind: 'none' } });
}

/** Whether a map change that `added` these objects placed armed item `itemId` up to its limit
 *  (`maxCount`, V-PLACE-MAX), so nothing of it is left to place. */
export function placingFilledCap(state: GridState, itemId: string | null, added: readonly PlacedObject[] | undefined): boolean {
  const cap = itemId ? getCatalogItem(itemId)?.maxCount : undefined;
  if (cap === undefined || !added?.some((o) => o.catalogId === itemId)) return false;
  return (getObjectIndex(state).countByCatalog.get(itemId!) ?? 0) >= cap;
}

/**
 * Puts down the armed item once the map holds as many of it as it may (`maxCount`, V-PLACE-MAX): a
 * placement that used the last of its cap leaves nothing to place next, whether a click or a drop
 * from the shelf made it. Returns its removal.
 */
export function watchCappedArming(): () => void {
  const bus = useEditorStore.getState().eventBus;
  const check = ({ added }: KernelEvents['objects-changed']): void => {
    const s = useEditorStore.getState();
    if (s.gridState && placingFilledCap(s.gridState, armedItemOf(s), added)) s.setEditMode({ arm: { kind: 'none' } });
  };
  bus.on('objects-changed', check);
  return () => bus.off('objects-changed', check);
}

/** A press on a planting card: arms its macro, or puts it down when it is the armed one. */
export function toggleArmedMacro(macro: MacroId): void {
  const s = useEditorStore.getState();
  s.setEditMode({ mode: 'object', arm: armedMacroOf(s) === macro ? { kind: 'none' } : { kind: 'macro', macro } });
}

/** The planting card the live shelf's row shows; null where it shows none. */
let shownPlanting: { macro: MacroId } | null = null;

/** The live shelf says which planting card its row shows, the one the Smart Build key arms. The
 *  returned function withdraws it, and only while it still stands: two shelves overlap for a frame
 *  as the layout turns. */
export function showPlanting(macro: MacroId): () => void {
  const shown = { macro };
  shownPlanting = shown;
  return () => { if (shownPlanting === shown) shownPlanting = null; };
}

/** The Smart Build key over the object shelf: a press on the planting card its row shows, if any. */
export function toggleShownPlanting(): void {
  if (shownPlanting) toggleArmedMacro(shownPlanting.macro);
}

/** A press on an item card: arms the item alone, or puts it down when it is the one armed. */
export function toggleArmedItem(itemId: string): void {
  const s = useEditorStore.getState();
  const only = armedPicksOf(s).length === 1 && armedItemOf(s) === itemId;
  s.setEditMode({ mode: 'object', arm: only ? { kind: 'none' } : { kind: 'item', itemId } });
}

/**
 * Ctrl+click on an item card, or a touch long press that never reached the map (EDIT-70): adds the
 * item to the armed ones, after those picked before it, or takes it out. An item placed one at a time
 * never stands beside another, so it, or any item picked beside it, arms alone as a click would.
 */
export function toggleItemPick(itemId: string): void {
  const s = useEditorStore.getState();
  const picks = armedPicksOf(s);
  const alone = placesOneAtATime(getCatalogItem(itemId)) || picks.some((id) => placesOneAtATime(getCatalogItem(id)));
  if (picks.length === 0 || alone) { toggleArmedItem(itemId); return; }
  const next = picks.includes(itemId) ? picks.filter((id) => id !== itemId) : [...picks, itemId];
  if (next.length === 0) { s.setEditMode({ mode: 'object', arm: { kind: 'none' } }); return; }
  s.setEditMode({ mode: 'object', arm: next.length === 1 ? { kind: 'item', itemId: next[0]! } : { kind: 'item', itemId: next[0]!, picks: next } });
}

/**
 * A press that carries an item card onto the map (`card-carry.ts:carryCard`). The drop is the
 * placer's own click, with its rules, refusal and undo step, and the item stays armed after a release
 * on the map, as a click on its card leaves it, unless that placement used the last of its cap
 * (`watchCappedArming`). Any other ending puts back what was armed before with its pending rotation;
 * a held lift (`picksOnReturn`) let go without reaching the map then picks the card
 * (`toggleItemPick`). Carrying the one armed item changes nothing armed. Null when the item cannot be
 * armed here.
 */
export function carryItem(itemId: string, hold: CardHold & { picksOnReturn?: boolean }): Carry | null {
  const s = useEditorStore.getState();
  const before = { editMode: s.editMode, rotation: s.placementRotation };
  const kept = armedItemOf(s) === itemId && armedPicksOf(s).length === 1;
  return carryCard(itemId, hold, {
    arm: () => {
      if (!kept) useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId } });
      return armedItemOf(useEditorStore.getState()) === itemId;
    },
    giveBack: () => {
      if (kept) return;
      useEditorStore.getState().restoreEditMode(before.editMode);
      useEditorStore.getState().setPlacementRotation(before.rotation);
    },
    stayed: () => { if (hold.picksOnReturn) toggleItemPick(itemId); },
  });
}
