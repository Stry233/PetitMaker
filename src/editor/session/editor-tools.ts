/**
 * The editor's tool layer for the session: one ToolManager per live map, built from the store and
 * independent of which map view is mounted. A view attaches itself through the active-view registry
 * (`view/active-view.ts`), which re-points the manager; with no view attached the tools draw nowhere.
 *
 * Each store change is handled in one ordered step: a map swap retires the outgoing map's manager
 * (its active tool deactivates against the map it was built for, taking its ghost down) before the
 * incoming map's manager is built, registered and armed; an arming change on the same map activates
 * the bar's tool. Both end with `tool-synced`, the signal that the managers match the store.
 */
import { ToolManager } from '../../tools/pointer/runtime';
import { getActiveView, registerToolManager } from '../../view/active-view';
import type { GridState } from '../../core/model/types';
import type { CommandExecutor } from '../../core/commands/command-executor';
import { useEditorStore, type EditorStore } from '../../state/store';
import { activeToolOf, brushSizeOf, contentTypeOf, designModeOf } from '../../state/editing/edit-mode';
import { editorToolWiring } from './tool-wiring';
import { poolAvailable, warmPool } from '../../tools/generation/run';

/** The store readings whose change reaches the tools as a `tool-synced`. */
const ARMING_READS: readonly ((s: EditorStore) => unknown)[] = [
  activeToolOf, designModeOf, contentTypeOf, brushSizeOf, (s) => s.activeLayer,
];

type ArmingKey = readonly unknown[];

const armingKey = (s: EditorStore): ArmingKey => ARMING_READS.map((read) => read(s));

const sameArming = (a: ArmingKey, b: ArmingKey): boolean => a.every((value, i) => value === b[i]);

/**
 * Starts the session's tool layer and returns its stop, which retires the live manager. It warms
 * the worker pool Smart Build runs in (`tool-wiring.ts`) before the first hover; where there is no
 * pool the tools keep their synchronous fallback. The state
 * each step acts on is read when it runs, never taken from the subscription's arguments: a tool's
 * deactivation can write the store, and that nested change must not be answered with an older state.
 */
export function startEditorTools(): () => void {
  let tools: ToolManager | null = null;
  let map: GridState | null = null;
  let executor: CommandExecutor | null = null;
  let arming: ArmingKey | null = null;

  const announce = (): void => {
    const s = useEditorStore.getState();
    s.eventBus.emit('tool-synced', { tool: activeToolOf(s) });
  };

  const sync = (): void => {
    const s = useEditorStore.getState();
    const nextArming = armingKey(s);
    if (s.gridState !== map || s.commandExecutor !== executor) {
      const outgoing = tools;
      map = s.gridState;
      executor = s.commandExecutor;
      arming = nextArming;
      tools = null;
      outgoing?.retire();
      if (map && executor) {
        // The manager registers the full default tool set in its constructor.
        tools = new ToolManager(getActiveView(), executor, map, editorToolWiring());
        tools.syncArming();
      }
      registerToolManager(tools);
      announce();
      return;
    }
    if (arming && sameArming(arming, nextArming)) return;
    arming = nextArming;
    if (!tools) return;
    // Activate the bar's tool; the rest of the arming reaches the tools through `armingOf`.
    tools.syncArming();
    announce();
  };

  if (poolAvailable()) warmPool();
  const unsubscribe = useEditorStore.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    const outgoing = tools;
    tools = null;
    map = null;
    executor = null;
    outgoing?.retire();
    registerToolManager(null);
  };
}
