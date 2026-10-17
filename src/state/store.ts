import { create } from 'zustand';
import { createPrefsSlice, type PrefsSlice, type HintLevel, type ViewMode } from './slices/prefs';
import { createShellSlice, type ShellSlice, type ModalId, type ShareSection } from './slices/shell';
import { createEditSlice, type EditSlice } from './slices/edit';
import { createEngineSlice, type EngineSlice } from './slices/engine';
import { createAnnotationsSlice, type AnnotationsSlice } from './slices/annotations';
import { createPlanetSessionSlice, type PlanetSessionSlice } from './slices/planet-session';
import { createRepairSessionSlice, type RepairSessionSlice } from './slices/repair-session';

export type { HintLevel, ViewMode };
export type { ModalId, ShareSection };

// The store is seven independently-typed slices composed at one `create()` call. Each factory
// types its own `set`/`get` no wider than the fields it actually touches (see the cross-slice
// `Deps` picks in `edit.ts`/`engine.ts`/`annotations.ts`), so a slice naming a field outside its
// declared type is a compile error rather than a convention. `shell` declares no engine field at
// all, which is the boundary a shell replaces. The check is the type system's, so a cast still
// defeats it.
export type EditorStore = PrefsSlice & ShellSlice & EditSlice & EngineSlice & AnnotationsSlice
  & PlanetSessionSlice & RepairSessionSlice;

/** The state `batchStore`'s body writes into, published when the body returns; null outside a batch. */
let draft: EditorStore | null = null;

export const useEditorStore = create<EditorStore>((publish, read, api) => {
  const get = (): EditorStore => draft ?? read();
  const set: typeof publish = (partial, replace) => {
    if (!draft) { publish(partial as EditorStore, replace as false); return; }
    const next = typeof partial === 'function' ? partial(draft) : partial;
    if (next !== draft) draft = replace ? next as EditorStore : { ...draft, ...next };
  };
  // Callers outside the slices read and write through the draft too while a batch runs.
  api.getState = get;
  api.setState = set;
  return {
    ...createPrefsSlice(set, get, api),
    ...createShellSlice(set, get, api),
    ...createEditSlice(set, get, api),
    ...createEngineSlice(set, get, api),
    ...createAnnotationsSlice(set, get, api),
    ...createPlanetSessionSlice(set, get, api),
    ...createRepairSessionSlice(set, get, api),
  };
});

/**
 * Runs `body` against a draft of the store and publishes its writes as one update, so subscribers
 * never see the steps in between. A throw publishes nothing. Nested batches join the outer one.
 */
export function batchStore<T>(body: () => T): T {
  if (draft) return body();
  const base = useEditorStore.getState();
  draft = base;
  let result: T;
  try {
    result = body();
  } catch (err) {
    draft = null;
    throw err;
  }
  const next = draft;
  draft = null;
  if (next !== base) useEditorStore.setState(next, true);
  return result;
}
