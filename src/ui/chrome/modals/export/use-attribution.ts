import { useEditorStore } from '../../../../state/store';
import { protectedImageNotes } from '../../../../state/notes-attribution';
import { useMapDerived } from '../../../session/use-map-derived';

/** Re-evaluate the lock after map edits and undo, even while the export window stays mounted. */
export function useAttribution(open: boolean) {
  const map = useEditorStore(s => s.gridState);
  const notes = useEditorStore(s => s.gridState?.notes);
  // The notes say the map moved in place as well as its revision.
  return useMapDerived(() => {
    const original = open && map ? protectedImageNotes(map) : undefined;
    return {
      notes: { ...map?.notes, ...original },
      titleLocked: !!original?.title,
      descriptionLocked: !!original?.description,
      locked: !!original,
    };
  }, [open, map, notes], { listening: open });
}
