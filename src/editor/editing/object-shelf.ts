/** What the object shelf's presses and category choice do to what is armed. */
import type { CategoryId } from '../../core/model/types';
import type { MacroId } from '../../tools/macros';
import { getCatalogItem } from '../../state/catalog';
import { useEditorStore } from '../../state/store';
import { macroForShelfCategory } from '../../tools/macros';
import { armedItemOf, armedMacroOf } from '../../state/editing/edit-mode';
import { startCarry, type Carry } from '../../view/interaction/pointer/carry';

/** Puts down an armed item or planting card the shelf tab `category` does not hold, so no ghost outlives its card. */
export function disarmOutsideCategory(category: CategoryId): void {
  const s = useEditorStore.getState();
  const item = armedItemOf(s), macro = armedMacroOf(s);
  if (item && getCatalogItem(item)?.category !== category) s.setEditMode({ mode: 'object', arm: { kind: 'none' } });
  else if (macro && macro !== macroForShelfCategory(category)) s.setEditMode({ mode: 'object', arm: { kind: 'none' } });
}

/** A press on a planting card: arms its macro, or puts it down when it is the armed one. */
export function toggleArmedMacro(macro: MacroId): void {
  const s = useEditorStore.getState();
  s.setEditMode({ mode: 'object', arm: armedMacroOf(s) === macro ? { kind: 'none' } : { kind: 'macro', macro } });
}

/** A press on an item card: arms the item, or puts it down when it is the armed one. */
export function toggleArmedItem(itemId: string): void {
  const s = useEditorStore.getState();
  s.setEditMode({ mode: 'object', arm: armedItemOf(s) === itemId ? { kind: 'none' } : { kind: 'item', itemId } });
}

/** The pointer carrying a card: its id, the element holding its capture, and what to tell the card
 *  when the carry ends, however it ends. */
export interface CardHold {
  pointerId: number;
  surface: HTMLElement | null;
  onEnd: () => void;
}

/**
 * A press that carries an item card onto the map. The item is armed for the carry alone, so the
 * drop is the placer's own click, with its rules, refusal and undo step, and what was armed before
 * comes back with its pending rotation however the carry ends. Carrying the armed item changes
 * nothing armed. Null when the item cannot be armed here.
 */
export function carryItem(itemId: string, hold: CardHold): Carry | null {
  const s = useEditorStore.getState();
  const before = { editMode: s.editMode, rotation: s.placementRotation };
  const kept = armedItemOf(s) === itemId;
  if (!kept) s.setEditMode({ mode: 'object', arm: { kind: 'item', itemId } });
  if (armedItemOf(useEditorStore.getState()) !== itemId) return null;
  return startCarry({
    pointerId: hold.pointerId,
    surface: hold.surface,
    end: () => {
      if (!kept) {
        const now = useEditorStore.getState();
        now.restoreEditMode(before.editMode);
        now.setPlacementRotation(before.rotation);
      }
      hold.onEnd();
    },
  });
}
