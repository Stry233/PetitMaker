/** The offer to resume the session this browser arrived with. */
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { restoreOffer, standRestoreOffer, subscribeRestoreOffer } from '../../editor/session/restore';
import type { RestoredAutosave } from '../../io/storage/autosave';

/**
 * The page's saved-session offer (`editor/session/restore.ts`), which the live shell stands as it
 * mounts; a pictured shell (`live` false) only reads it. Its answers, its clock and its end once the
 * visitor sets to work are the editor's.
 */
export function useRestoreOffer(live: boolean): RestoredAutosave | null {
  useLayoutEffect(() => { if (live) standRestoreOffer(); }, [live]);
  return useSyncExternalStore(subscribeRestoreOffer, restoreOffer);
}
