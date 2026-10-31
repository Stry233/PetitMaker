/** What the object shelf's presses and category choice do to what is armed. */
import type { CategoryId } from '../../core/model/types';
import type { KernelEvents } from '../../core/commands/events';
import type { MacroId } from '../../tools/macros';
import { getCatalogItem } from '../../state/catalog';
import { useEditorStore } from '../../state/store';
import { macroForShelfCategory } from '../../tools/macros';
import { armedItemOf, armedMacroOf, armedPicksOf } from '../../state/editing/edit-mode';
import { placesOneAtATime } from '../../state/object-geometry';
import { getObjectIndex } from '../../state/object-index';
import { startCarry, type Carry } from '../../view/interaction/pointer/carry';

/** Puts down an armed item or planting card the shelf tab `category` does not hold, so no ghost outlives its card. */
export function disarmOutsideCategory(category: CategoryId): void {
  const s = useEditorStore.getState();
  const item = armedItemOf(s), macro = armedMacroOf(s);
  if (item && getCatalogItem(item)?.category !== category) s.setEditMode({ mode: 'object', arm: { kind: 'none' } });
  else if (macro && macro !== macroForShelfCategory(category)) s.setEditMode({ mode: 'object', arm: { kind: 'none' } });
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
    const itemId = armedItemOf(s);
    const cap = itemId ? getCatalogItem(itemId)?.maxCount : undefined;
    if (cap === undefined || !s.gridState || !added?.some((o) => o.catalogId === itemId)) return;
    if ((getObjectIndex(s.gridState).countByCatalog.get(itemId!) ?? 0) >= cap) s.setEditMode({ arm: { kind: 'none' } });
  };
  bus.on('objects-changed', check);
  return () => bus.off('objects-changed', check);
}

/** A press on a planting card: arms its macro, or puts it down when it is the armed one. */
export function toggleArmedMacro(macro: MacroId): void {
  const s = useEditorStore.getState();
  s.setEditMode({ mode: 'object', arm: armedMacroOf(s) === macro ? { kind: 'none' } : { kind: 'macro', macro } });
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

/** The pointer carrying a card: its id, the element holding its capture, and what to tell the card
 *  when the carry ends, however it ends. */
export interface CardHold {
  pointerId: number;
  surface: HTMLElement | null;
  onEnd: () => void;
  /** A held finger or pen lifted the card: let go without reaching the map, it picks the card
   *  beside the armed ones (EDIT-70). */
  picksOnReturn?: boolean;
}

/**
 * A press that carries an item card onto the map. The item is armed for the carry, so the drop is
 * the placer's own click, with its rules, refusal and undo step, and it stays armed after a release
 * on the map, as a click on its card leaves it, unless that placement used the last of its cap
 * (`watchCappedArming`). A carry that ends anywhere else (off the map, Escape,
 * a cancelled pointer) puts back what was armed before with its pending rotation; a held lift let go
 * without reaching the map then picks the card (`toggleItemPick`). Carrying the one armed item changes
 * nothing armed. Null when the item cannot be armed here.
 */
export function carryItem(itemId: string, hold: CardHold): Carry | null {
  const s = useEditorStore.getState();
  const before = { editMode: s.editMode, rotation: s.placementRotation };
  const kept = armedItemOf(s) === itemId && armedPicksOf(s).length === 1;
  if (!kept) s.setEditMode({ mode: 'object', arm: { kind: 'item', itemId } });
  if (armedItemOf(useEditorStore.getState()) !== itemId) return null;
  return startCarry({
    pointerId: hold.pointerId,
    surface: hold.surface,
    end: (dropped, stayed) => {
      if (!kept && !dropped) {
        const now = useEditorStore.getState();
        now.restoreEditMode(before.editMode);
        now.setPlacementRotation(before.rotation);
      }
      if (stayed && hold.picksOnReturn) toggleItemPick(itemId);
      hold.onEnd();
    },
  });
}
