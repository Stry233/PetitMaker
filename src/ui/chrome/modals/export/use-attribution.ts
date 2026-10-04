import { useMemo } from 'react';
import { useEditorStore } from '../../../../state/store';
import { protectedImageNotes } from '../../../../core/provenance/image-attribution';
import { useMapRevision } from '../../../hooks/use-map-revision';

/** Re-evaluate the lock after map edits and undo, even while the export window stays mounted. */
export function useAttribution(open: boolean) {
  const map = useEditorStore(s => s.gridState);
  const notesEpoch = useEditorStore(s => s.notesEpoch);
  const revision = useMapRevision(open);
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
