/**
 * Opens the What's new window once per version for a returning browser. It speaks first among the
 * arrivals: after the splash and the tour, before the arrival notice and the
 * saved-session offer, and never over a window already open. A first visit records the version and
 * says nothing; the tour is that visitor's welcome. A visit offering a returning browser a newer tour
 * says nothing either and records nothing, so the notes wait for its next visit: one welcome a visit.
 */
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../../../state/store';
import { APP_VERSION } from '../../../../platform/build/build-info';
import { arrivalOpens } from '../../floating/arrival-gate';
import { tourSettled, tourVisitStanding } from '../../tour/use-tour';
import { currentNotes } from './current';
import { lastSeenVersion, recordSeenVersion } from '../../../../io/storage/seen-version-facts';
import { whatsNewDue } from './notes';
import { anyModalOpen } from '../../../../state/slices/shell';

export function WhatsNewGate({ splashActive }: { splashActive: boolean }) {
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const modals = useEditorStore((s) => s.modals);
  // The standing this visit found, whatever the tour has recorded since.
  const standing = useRef(tourVisitStanding());
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return undefined;
    if (standing.current === 'never') { decided.current = true; recordSeenVersion(); return undefined; }
    if (standing.current === 'older') { decided.current = true; return undefined; }
    const gate = arrivalOpens({
      splashActive, tourRunning, tourSettled: tourSettled(), whatsNewOpen: modals.whatsNew,
      repairOpen: useEditorStore.getState().repairSession !== null,
    });
    if (!gate || anyModalOpen({ modals })) return undefined;
    // Decided in this commit's effects: the arrival notice defers its own reading past them, so the
    // window it should wait for is already open when it looks.
    decided.current = true;
    const st = useEditorStore.getState();
    const notes = currentNotes(st.locale);
    if (whatsNewDue({ returning: true, lastSeen: lastSeenVersion(), current: APP_VERSION, notes })) st.setModal('whatsNew', true);
    else recordSeenVersion();
    return undefined;
  }, [splashActive, tourRunning, modals]);

  return null;
}
