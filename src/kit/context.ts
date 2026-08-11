/**
 * The live editor, handed to every operation explicitly.
 *
 * `kit/operations/` must never import the store itself: an operation that reached for it directly
 * could only ever have one caller, since a live `useEditorStore` bakes in one instance. Instead the
 * UI passes `currentKit()`, the agent builds a `KitContext` from its own deps, and a test constructs
 * one by hand — three callers running the same operation code. `installMap`/`installLoadedMap`
 * below are the one sanctioned path in, which is what `kit/operations/map.ts` calls instead of
 * touching the store.
 *
 * `kit/host.ts`, `kit/commands.ts` and `kit/group-edit.ts` read the store live too, same as this
 * file — they sit beside `operations/` rather than in it, each with exactly one caller (the app
 * shell), so the single-caller argument that binds an operation doesn't bind them.
 */
import type { GridState, MapTemplate } from '../core/model/types';
import type { RuleRegistry } from '../rules/registry';
import type { MacroContext } from '../tools/macros/context';
import { useEditorStore } from '../state/store';

/** The `{state, executor, registry}` triple, defined once in `tools/macros/context.ts` — the
 *  operations layer and the macros run against the same editor shape. */
export type KitContext = MacroContext;

/** The live editor, or null before a map is loaded. */
export function currentKit(): KitContext | null {
  const { gridState, commandExecutor } = useEditorStore.getState();
  if (!gridState || !commandExecutor) return null;
  return {
    state: gridState,
    executor: commandExecutor,
    registry: commandExecutor.getRegistry(),
  };
}

/** Opens `template` as the live map. The mechanism `newMap` calls. */
export function installMap(template: MapTemplate, registry: RuleRegistry): void {
  useEditorStore.getState().initMap(template, registry);
}

/** Opens `state` as the live map. The mechanism `loadMap` calls. */
export function installLoadedMap(state: GridState, registry: RuleRegistry): void {
  useEditorStore.getState().loadMap(state, registry);
}
