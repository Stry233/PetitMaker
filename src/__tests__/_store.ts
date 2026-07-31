/*
 * _store.ts — the typed way for a test to seed the editor store.
 *
 * The store's own `setState`, cast to `never`, compiles whatever it is given, so a store field that
 * is renamed or removed leaves every seed of it passing while asserting nothing. Going through a
 * `Partial<EditorStore>` parameter restores TypeScript's excess-property check at the call site,
 * making a stale field name a compile error. `__tests__/state/store-seed-typing.test.ts` keeps the
 * cast from coming back.
 *
 * NOT for a test that calls `vi.resetModules()` and re-imports the store: that makes a SECOND store
 * instance, and this helper closes over the outer graph's. Seed the fresh graph's own
 * `useEditorStore` there, or the component under test subscribes to a store nothing wrote to (see
 * `__tests__/ui/dev-build-notice.test.tsx`).
 */
import { useEditorStore, type EditorStore, type ModalId } from '../state/store';

/** Merge `partial` into the editor store. Same semantics as `useEditorStore.setState`. */
export function setStoreState(partial: Partial<EditorStore>): void {
  useEditorStore.setState(partial);
}

/** Open (or close) one overlay, leaving the rest as they are. */
export function setStoreModal(id: ModalId, open = true): void {
  useEditorStore.getState().setModal(id, open);
}
