import { create } from 'zustand';
import type { BlockRef } from '../core/model/types';
import { createPrefsSlice, type PrefsSlice, type HintLevel, type ViewMode } from './slices/prefs';
import { createShellSlice, type ShellSlice, type ModalId } from './slices/shell';
import { createEditSlice, type EditSlice } from './slices/edit';
import { createEngineSlice, type EngineSlice } from './slices/engine';
import { createAnnotationsSlice, type AnnotationsSlice } from './slices/annotations';

export type { BlockRef };
export type { HintLevel, ViewMode };
export type { ModalId };

// The store is five independently-typed slices composed at one `create()` call. Each factory
// types its own `set`/`get` no wider than the fields it actually touches (see the cross-slice
// `Deps` picks in `edit.ts`/`engine.ts`/`annotations.ts`), so a slice naming a field outside its
// declared type is a compile error rather than a convention. `shell` declares no engine field at
// all, which is the boundary a shell replaces. The check is the type system's, so a cast still
// defeats it.
export type EditorStore = PrefsSlice & ShellSlice & EditSlice & EngineSlice & AnnotationsSlice;

export const useEditorStore = create<EditorStore>((set, get, api) => ({
  ...createPrefsSlice(set, get, api),
  ...createShellSlice(set, get, api),
  ...createEditSlice(set, get, api),
  ...createEngineSlice(set, get, api),
  ...createAnnotationsSlice(set, get, api),
}));
