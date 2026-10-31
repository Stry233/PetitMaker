/** The offer to resume the session this browser arrived with. */
import { useCallback, useEffect, useState } from 'react';
import { SUPPORTS_ASSISTANT } from '../../platform/build/edition';
import { offerRestoreDismiss } from '../session/restore-offer';
import { readRestoreOffer } from '../../editor/session/restore';
import { useVisitorEngaged } from '../session/engagement';
import type { RestoredAutosave } from '../../io/storage/autosave';
import { clearAssistantSession } from './edition-surfaces';

/**
 * The saved session offered back, read once at mount: a save written later is this session's own.
 * The offer is withdrawn for good once the visitor sets to work (`session/engagement.ts`), and by
 * the arrival notice's OK.
 */
export function useRestoreOffer(): { offer: RestoredAutosave | null; dismiss: () => void; take: () => void } {
  const [offer, setOffer] = useState<RestoredAutosave | null>(readRestoreOffer);
  const dismiss = useCallback(() => {
    if (SUPPORTS_ASSISTANT) clearAssistantSession();
    setOffer(null);
  }, []);
  const withdrawn = useVisitorEngaged(offer !== null);
  useEffect(() => { if (withdrawn) dismiss(); }, [withdrawn, dismiss]);
  useEffect(() => (offer ? offerRestoreDismiss(dismiss) : undefined), [offer, dismiss]);
  return { offer: withdrawn ? null : offer, dismiss, take: useCallback(() => setOffer(null), []) };
}
