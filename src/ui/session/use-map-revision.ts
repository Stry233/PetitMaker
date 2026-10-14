import { useCallback, useSyncExternalStore } from 'react';
import { onMapEdited } from '../../core/commands/map-edits';
import { subscribeMapStats } from '../../state/map-stats';
import { mapRevisionOf } from '../../state/map-revision';
import { useEditorStore } from '../../state/store';

/**
 * The live map's edit revision (`state/map-revision.ts:mapRevisionOf`), the one "the map changed" signal for
 * React surfaces: re-read after every edit, undo and redo included (`'edit'`), or once in the frame
 * after edits (`'frame'`) for a surface that reads the live `getMapStats` view, which a stroke changes
 * many times a frame. With `listening` off the hook subscribes to nothing and re-reads only on render.
 */
export function useMapRevision(listening = true, timing: 'edit' | 'frame' = 'edit'): string {
  const map = useEditorStore((s) => s.gridState);
  const bus = useEditorStore((s) => s.eventBus);
  const subscribe = useCallback((notify: () => void) => {
    if (!listening) return () => {};
    return timing === 'edit' ? onMapEdited(bus, notify) : subscribeMapStats(bus, () => useEditorStore.getState().gridState, notify);
  }, [listening, timing, bus]);
  const read = useCallback(() => mapRevisionOf(map), [map]);
  return useSyncExternalStore(subscribe, read, read);
}
