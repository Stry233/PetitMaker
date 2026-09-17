/**
 * What the menu button says on arrival: a pointer to Help as the tour ends, then on a touch device
 * the invitation into immersive mode. Both wait behind the splash, the portrait guard, the tour and
 * any open window; neither is remembered.
 */
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { useTouchPrimary } from '../../design/scale';
import { useFullscreen } from '../../hooks/useFullscreen';
import { hasSeenTour } from '../tour/use-tour';
import { arrivalOpens } from './arrival-gate';
import { SpeechBubble } from './SpeechBubble';

export function MenuBubbles({ splashActive }: { splashActive: boolean }) {
  const t = useT();
  const touch = useTouchPrimary();
  const fullscreen = useFullscreen();
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const blocked = useEditorStore((s) => s.portraitBlocked);
  const modals = useEditorStore((s) => s.modals);
  const setModal = useEditorStore((s) => s.setModal);
  const [helpDue, setHelpDue] = useState(false);
  const [immersiveDone, setImmersiveDone] = useState(false);

  // The Help hint is owed by a tour that has just ended; settled during render so no other bubble
  // mounts in the commit between.
  const [seenRunning, setSeenRunning] = useState(tourRunning);
  if (seenRunning !== tourRunning) {
    setSeenRunning(tourRunning);
    if (seenRunning && !tourRunning) setHelpDue(true);
  }

  const windowOpen = Object.values(modals).some(Boolean);
  const released = !windowOpen
    && arrivalOpens({ splashActive, blocked, tourRunning, tourSettled: hasSeenTour(), tourDoneOpen: modals.tourDone, whatsNewOpen: modals.whatsNew });
  // The bubbles look one task after the release, as the arrival notice does: a window that opens
  // in the same commit's effects is up before they do.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!released) { setSettled(false); return undefined; }
    const timer = setTimeout(() => setSettled(true), 0);
    return () => clearTimeout(timer);
  }, [released]);
  const help = released && settled && helpDue;
  const immersive = released && settled && !helpDue && !immersiveDone && touch && fullscreen.available && !fullscreen.active;

  const openHelp = useCallback(() => setModal('help', true), [setModal]);
  const closeHelp = useCallback(() => setHelpDue(false), []);
  const closeImmersive = useCallback(() => setImmersiveDone(true), []);

  return (
    <AnimatePresence>
      {help && <SpeechBubble key="help" anchor="menu" text={t('hint.help')} onAct={openHelp} onClose={closeHelp} />}
      {immersive && <SpeechBubble key="immersive" anchor="menu" text={t('immersive.bubble')} onAct={fullscreen.toggle} onClose={closeImmersive} />}
    </AnimatePresence>
  );
}
