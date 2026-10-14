import { useEffect, useState } from 'react';
import { useEditorStore } from '../../state/store';

/** Whether the map's history has a step to undo and one to redo, as each history change reports it. */
export function useHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const eventBus = useEditorStore((s) => s.eventBus);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  useEffect(() => {
    const onHistory = (e: { canUndo: boolean; canRedo: boolean }) => setHistory({ canUndo: e.canUndo, canRedo: e.canRedo });
    eventBus.on('history-changed', onHistory);
    return () => eventBus.off('history-changed', onHistory);
  }, [eventBus]);
  return history;
}
