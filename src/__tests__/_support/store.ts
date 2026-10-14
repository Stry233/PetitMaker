/*
 * The typed way for a test to seed the editor store.
 *
 * The store's own `setState`, cast to `never`, compiles whatever it is given, so a store field that
 * is renamed or removed leaves every seed of it passing while asserting nothing. Going through a
 * `Partial<EditorStore>` parameter restores TypeScript's excess-property check at the call site,
 * making a stale field name a compile error. `__tests__/repo/store-seed-typing.test.ts` keeps the
 * cast from coming back.
 *
 * Not for a test that calls `vi.resetModules()` and re-imports the store: that makes a second store
 * instance, and this helper closes over the outer graph's. Seed the fresh graph's own
 * `useEditorStore` there, or the component under test subscribes to a store nothing wrote to (see
 * `__tests__/ui/chrome/guards/dev-build-notice.test.tsx`).
 */
import { useEditorStore, type EditorStore, type ModalId } from '../../state/store';
import { nextEditMode, REST_INPUTS, type BuildShape, type ContentType, type EditModeChange } from '../../state/editing/edit-mode';
import { ToolType } from '../../state/editing/vocabulary';

/** Merge `partial` into the editor store. Same semantics as `useEditorStore.setState`. */
export function setStoreState(partial: Partial<EditorStore>): void {
  useEditorStore.setState(partial);
}

/** Open (or close) one overlay, leaving the rest as they are. */
export function setStoreModal(id: ModalId, open = true): void {
  useEditorStore.getState().setModal(id, open);
}

/** Return the editor store to its freshly created state, replacing every field, so a case reads
 *  nothing an earlier case in the file left behind. */
export function resetStore(): void {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
}

/** An arming named by what it resolves to: the tool, the surface it lays, the armed item or macro. */
export interface ArmedAs {
  tool: ToolType;
  content?: ContentType;
  item?: string | null;
  macro?: string | null;
  shape?: BuildShape;
}

/** The `editMode` that resolves to `arming`. Object mode with no item is the rest state, so
 *  `{ tool: ObjectPlacer }` without an item resolves to the hand, as the editor does. */
export function armedEditMode(arming: ArmedAs): Pick<EditorStore, 'editMode'> {
  const mode = arming.content ?? 'mountain';
  const change: Record<ToolType, EditModeChange> = {
    [ToolType.Hand]: arming.content ? { mode, arm: { kind: 'none' } } : { mode: null },
    [ToolType.TerrainBrush]: { mode, arm: arming.shape && arming.shape !== 'free' ? { kind: 'shape', shape: arming.shape } : { kind: 'brush' } },
    [ToolType.Eraser]: { mode, arm: { kind: 'erase' } },
    [ToolType.EdgeCut]: { mode, arm: { kind: 'trim' } },
    [ToolType.ObjectPlacer]: { mode: 'object', arm: arming.item ? { kind: 'item', itemId: arming.item } : { kind: 'none' } },
    [ToolType.Macro]: { mode, arm: arming.macro ? { kind: 'smart', macro: arming.macro } : { kind: 'none' } },
    [ToolType.Annotate]: { mode: 'annotate' },
  };
  return { editMode: nextEditMode(REST_INPUTS, change[arming.tool]) };
}

/** Arms the store as `arming` names it, through the store's own writer. */
export function setArmed(arming: ArmedAs): void {
  useEditorStore.getState().restoreEditMode(armedEditMode(arming).editMode);
}
