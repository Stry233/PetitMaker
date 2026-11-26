/**
 * Opens the What's new window once per version for a returning browser. It speaks first among the
 * greetings (`state/greetings.ts:whatsNewStep`): after the splash and the tour, before the arrival
 * notice and the saved-session offer, and never over a window already open. A first visit records
 * the version and says nothing; the tour is that visitor's welcome. A visit offering a returning
 * browser a newer tour says nothing either and records nothing: one welcome a visit.
 */
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../../../state/store';
import { APP_VERSION } from '../../../../platform/build/build-info';
import { whatsNewDue, whatsNewStep } from '../../../../state/greetings';
import { greetWhatsNew } from '../../../../editor/session/whats-new';
import { tourSettled, tourVisitStanding } from '../../../../state/tour-offer';
import { changelogText } from './current';
import { lastSeenVersion } from '../../../../io/storage/seen-version-facts';

export function WhatsNewGate({ splashActive }: { splashActive: boolean }) {
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const modals = useEditorStore((s) => s.modals);
  // The standing this visit found, whatever the tour has recorded since.
  const standing = useRef(tourVisitStanding());
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current) return;
    const st = useEditorStore.getState();
    const step = whatsNewStep(standing.current, st, { splashActive, tourSettled: tourSettled() });
    if (step === 'wait') return;
    // Decided in this commit's effects: the arrival notice defers its own reading past them, so the
    // window it should wait for is already open when it looks.
    decided.current = true;
    if (step === 'skip') return;
    const due = step === 'greet'
      && whatsNewDue({ returning: true, lastSeen: lastSeenVersion(), current: APP_VERSION, changelog: changelogText(st.locale) });
    greetWhatsNew(due);
  }, [splashActive, tourRunning, modals]);

  return null;
}
