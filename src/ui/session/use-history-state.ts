import { useCallback, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../state/store';

/** Whether the map's history has a step to undo and one to redo, read from the live executor and
 *  re-read on each history change and each store update, since whether a selection step would show
 *  anything follows the selection and the tool up. */
export function useHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const executor = useEditorStore((s) => s.commandExecutor);
  const eventBus = useEditorStore((s) => s.eventBus);
  const subscribe = useCallback((onChange: () => void) => {
    eventBus.on('history-changed', onChange);
    const offStore = useEditorStore.subscribe(onChange);
    return () => { eventBus.off('history-changed', onChange); offStore(); };
  }, [eventBus]);
  const canUndo = useSyncExternalStore(subscribe, () => executor?.canUndo() ?? false);
  const canRedo = useSyncExternalStore(subscribe, () => executor?.canRedo() ?? false);
  return { canUndo, canRedo };
}
