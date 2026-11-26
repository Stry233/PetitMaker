import { useEditorStore } from '../../../../state/store';
import { noteAttribution } from '../../../../state/notes-attribution';
import { useMapDerived } from '../../../session/use-map-derived';
import { pressCommand } from '../../../../editor/commands/run';
import type { MapNotes } from '../../../../core/model/types';

const UNLOCKED = { titleLocked: false, descriptionLocked: false, locked: false } as const;

/** The title and description fields' write: the map's notes are set by their command. */
export const setMapNotes = ({ title = '', description = '' }: MapNotes): void => pressCommand('map.notes', { title, description });

/** The map's notes and which of them an image import still holds (`noteAttribution`), read again
 *  after map edits and undo, even while the export window stays mounted. A closed window reads the
 *  notes as they stand and holds nothing. */
export function useAttribution(open: boolean) {
  const map = useEditorStore(s => s.gridState);
  const notes = useEditorStore(s => s.gridState?.notes);
  // The notes say the map moved in place as well as its revision.
  return useMapDerived(
    () => (open && map ? noteAttribution(map) : { notes: { ...map?.notes }, ...UNLOCKED }),
    [open, map, notes], { listening: open },
  );
}
