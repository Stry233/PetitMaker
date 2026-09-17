import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../../../state/store';
import { protectedImageNotes } from '../../../../core/provenance/image-attribution';

/** Re-evaluate the lock after map edits and undo, even while the export window stays mounted. */
export function useAttribution(open: boolean) {
  const map = useEditorStore(s => s.gridState);
  const bus = useEditorStore(s => s.eventBus);
  const notesEpoch = useEditorStore(s => s.notesEpoch);
  const subscribe = useCallback((notify: () => void) => {
    if (!open) return () => {};
    bus.on('cells-changed', notify);
    bus.on('objects-changed', notify);
    bus.on('history-applied', notify);
    return () => {
      bus.off('cells-changed', notify);
      bus.off('objects-changed', notify);
      bus.off('history-applied', notify);
    };
  }, [open, bus]);
  const read = useCallback(() => `${map?.cellsVersion ?? 0}:${map?.objectsVersion ?? 0}`, [map]);
  const revision = useSyncExternalStore(subscribe, read, read);
  return useMemo(() => {
    const original = open && map ? protectedImageNotes(map) : undefined;
    return {
      notes: { ...map?.notes, ...original },
      titleLocked: !!original?.title,
      descriptionLocked: !!original?.description,
      locked: !!original,
    };
  }, [open, map, revision, notesEpoch]);
}
