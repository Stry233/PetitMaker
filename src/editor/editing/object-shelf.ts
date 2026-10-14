/** What the object shelf's presses and category choice do to what is armed. */
import type { CategoryId } from '../../core/model/types';
import type { MacroId } from '../../tools/macros';
import { getCatalogItem } from '../../state/catalog';
import { useEditorStore } from '../../state/store';
import { macroForShelfCategory } from '../../tools/macros';
import { armedItemOf, armedMacroOf } from '../../state/editing/edit-mode';

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
