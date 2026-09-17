/**
 * Opens the What's new window once per version for a returning browser. It speaks first among the
 * arrivals: after the splash, the portrait guard and the tour, before the arrival notice and the
 * saved-session offer, and never over a window already open. A first visit records the version and
 * says nothing; the tour is that visitor's welcome.
 */
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../../../state/store';
import { APP_VERSION } from '../../../../version';
import { arrivalOpens } from '../../floating/arrival-gate';
import { hasSeenTour } from '../../tour/use-tour';
import { currentNotes, lastSeenVersion, recordSeenVersion } from './current';
import { whatsNewDue } from './notes';

export function WhatsNewGate({ splashActive }: { splashActive: boolean }) {
  const blocked = useEditorStore((s) => s.portraitBlocked);
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const modals = useEditorStore((s) => s.modals);
  // Read at mount: the first-launch tour marks itself seen in a later commit.
  const returning = useRef(hasSeenTour());
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return undefined;
    if (!returning.current) { decided.current = true; recordSeenVersion(); return undefined; }
    const gate = arrivalOpens({
      splashActive, blocked, tourRunning, tourSettled: hasSeenTour(), tourDoneOpen: modals.tourDone, whatsNewOpen: modals.whatsNew,
    });
    if (!gate || Object.values(modals).some(Boolean)) return undefined;
    // Decided in this commit's effects: the arrival notice defers its own reading past them, so the
    // window it should wait for is already open when it looks.
    decided.current = true;
    const st = useEditorStore.getState();
    const notes = currentNotes(st.locale);
    if (whatsNewDue({ returning: true, lastSeen: lastSeenVersion(), current: APP_VERSION, notes })) st.setModal('whatsNew', true);
    else recordSeenVersion();
    return undefined;
  }, [splashActive, blocked, tourRunning, modals]);

  return null;
}
