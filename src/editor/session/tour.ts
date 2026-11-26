/** The welcome tips as the session runs them: this build's tour started, and a visit's one offer of it. */
import { hasAutosave } from '../../io/storage/facts';
import { tourOpenable } from '../../state/slices/shell';
import { useEditorStore } from '../../state/store';
import { TOUR_VERSION, recordTourOffered, takeVisitStart } from '../../state/tour-offer';

/** Runs this build's tour from its first card, over a run standing too; false where none may start
 *  (`tourOpenable`). */
export function startTour(): boolean {
  const store = useEditorStore.getState();
  if (!tourOpenable(store)) return false;
  store.startTour(TOUR_VERSION);
  return true;
}

/** Offers the tour once per version as the editor's session starts: the visit's start acts once a
 *  page, so a session installed again cannot start it again. A browser holding a saved map
 *  (`hasSavedMap`) has used the editor before. */
export function offerTourAtStart(hasSavedMap: boolean = hasAutosave()): void {
  const decision = takeVisitStart(TOUR_VERSION, hasSavedMap);
  if (decision === 'waive') recordTourOffered(TOUR_VERSION);
  else if (decision === 'run') startTour();
}
