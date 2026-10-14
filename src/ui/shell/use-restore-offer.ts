/** The offer to resume the session this browser arrived with. */
import { useCallback, useEffect, useState } from 'react';
import { SUPPORTS_ASSISTANT } from '../../platform/build/edition';
import { offerRestoreDismiss } from '../session/restore-offer';
import { readRestoreOffer, watchFirstEdit } from '../../editor/session/restore';
import type { RestoredAutosave } from '../../io/storage/autosave';
import { clearAssistantSession } from './edition-surfaces';

/** True once the visitor's own work reaches the map while `armed` (`watchFirstEdit`). */
function useFirstEdit(armed: boolean): boolean {
  const [edited, setEdited] = useState(false);
  useEffect(() => (armed ? watchFirstEdit(() => setEdited(true)) : undefined), [armed]);
  return edited;
}

/**
 * The saved session offered back, read once at mount: a save written later is this session's own.
 * The offer is withdrawn for good once `engaged` (a mode, the menu, a window or the assistant) or a
 * first edit says the visitor has chosen to work here, and by the arrival notice's OK.
 */
export function useRestoreOffer(engaged: boolean): { offer: RestoredAutosave | null; dismiss: () => void; take: () => void } {
  const [offer, setOffer] = useState<RestoredAutosave | null>(readRestoreOffer);
  const dismiss = useCallback(() => {
    if (SUPPORTS_ASSISTANT) clearAssistantSession();
    setOffer(null);
  }, []);
  const edited = useFirstEdit(offer !== null);
  const withdrawn = offer !== null && (engaged || edited);
  useEffect(() => { if (withdrawn) dismiss(); }, [withdrawn, dismiss]);
  useEffect(() => (offer ? offerRestoreDismiss(dismiss) : undefined), [offer, dismiss]);
  return { offer: withdrawn ? null : offer, dismiss, take: useCallback(() => setOffer(null), []) };
}
