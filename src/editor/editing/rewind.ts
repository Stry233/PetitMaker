/** The live map's undo depth, and rewinding it to a recorded watermark, as the assistant's checkpoints ask. */
import { useEditorStore } from '../../state/store';
import { rewindTo } from '../operations/undo-depth';

/** Undoes the live map down to `undoIndex`; nothing before a map is loaded. */
export function rewindLiveMap(undoIndex: number): void {
  const executor = useEditorStore.getState().commandExecutor;
  if (executor) rewindTo(executor, undoIndex);
}

/** The live map's undo depth; undefined before a map is loaded. */
export function liveUndoDepth(): number | undefined {
  return useEditorStore.getState().commandExecutor?.historyDepth();
}
