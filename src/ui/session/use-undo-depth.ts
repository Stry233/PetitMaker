import { useEffect, useState } from 'react';
import { watchUndoDepth } from '../../editor/operations';
import { useEditorStore } from '../../state/store';

/** The executor's undo depth, read once per frame of edits and again when `epoch` moves. */
export function useUndoDepth(epoch: number): number | undefined {
  const executor = useEditorStore((s) => s.commandExecutor);
  const eventBus = useEditorStore((s) => s.eventBus);
  const [seen, setSeen] = useState<number | undefined>(undefined);
  // A job settling can change the depth without a map event, so the caller's epoch re-reads it.
  const [readAt, setReadAt] = useState({ epoch, executor });
  if (readAt.epoch !== epoch || readAt.executor !== executor) {
    setReadAt({ epoch, executor });
    setSeen(executor?.historyDepth());
  }
  useEffect(() => {
    if (!executor || !eventBus) return undefined;
    return watchUndoDepth(eventBus, executor, setSeen, { frame: true });
  }, [executor, eventBus]);
  return seen ?? executor?.historyDepth();
}
