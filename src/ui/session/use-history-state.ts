import { useCallback, useSyncExternalStore } from 'react';
import { historySteps } from '../../editor/commands/commands';
import { onEditsInFlightChange } from '../../state/edits-in-flight';
import { useEditorStore } from '../../state/store';

/** Whether undo and redo each have a step where the history commands step now
 *  (`editor/commands/commands.ts:historySteps`), re-read on each history change, each store update
 *  and each edit that starts or stops landing, since whether a selection step would show anything
 *  follows the selection and the tool up. */
export function useHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const eventBus = useEditorStore((s) => s.eventBus);
  const subscribe = useCallback((onChange: () => void) => {
    eventBus.on('history-changed', onChange);
    const offStore = useEditorStore.subscribe(onChange);
    const offLanding = onEditsInFlightChange(onChange);
    return () => { eventBus.off('history-changed', onChange); offStore(); offLanding(); };
  }, [eventBus]);
  const canUndo = useSyncExternalStore(subscribe, () => historySteps().undo);
  const canRedo = useSyncExternalStore(subscribe, () => historySteps().redo);
  return { canUndo, canRedo };
}
