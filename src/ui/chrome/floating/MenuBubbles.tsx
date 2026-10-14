import { effectiveCombo } from '../../../state/keymap/resolve';
import { prettyCombo } from '../../../platform/input/combo';
import { useKeybinds } from '../../../state/keymap/store';
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
import { useFullscreen } from '../../primitives/use-fullscreen';
import { hasSeenTour } from '../tour/use-tour';
import { arrivalOpens } from './arrival-gate';
import { SpeechBubble } from './SpeechBubble';
import { anyModalOpen } from '../../../state/slices/shell';

export function MenuBubbles({ splashActive }: { splashActive: boolean }) {
  const t = useT();
  const loadDue = useEditorStore((s) => s.loadLimitNotice);
  const dismissLoad = useEditorStore((s) => s.dismissLoadLimitNotice);
  const touch = useTouchPrimary();
  const overrides = useKeybinds(s => s.overrides);
  const helpCombo = effectiveCombo(overrides, 'app.whats_this');
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

  const windowOpen = anyModalOpen({ modals });
  // A scanned planet's review chip stands under the session's nameplate, where a bubble from the
  // menu can reach in a narrow window; the bubbles wait until that session ends.
  const reviewing = useEditorStore((s) => !!s.planetSession?.review);
  const released = !windowOpen && !reviewing
    && arrivalOpens({ splashActive, blocked, tourRunning, tourSettled: hasSeenTour(), tourDoneOpen: modals.tourDone, whatsNewOpen: modals.whatsNew });
  // The bubbles look one task after the release, as the arrival notice does: a window that opens
  // in the same commit's effects is up before they do.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!released) { setSettled(false); return undefined; }
    const timer = setTimeout(() => setSettled(true), 0);
    return () => clearTimeout(timer);
  }, [released]);
  const load = released && settled && loadDue;
  const help = released && settled && !loadDue && helpDue;
  const immersive = released && settled && !loadDue && !helpDue && !immersiveDone && touch && fullscreen.available && !fullscreen.active;

  const openLoad = useCallback(() => setModal('regionLoad', true), [setModal]);
  const openHelp = useCallback(() => setModal('help', true), [setModal]);
  const closeHelp = useCallback(() => setHelpDue(false), []);
  const closeImmersive = useCallback(() => setImmersiveDone(true), []);

  return (
    <AnimatePresence>
      {load && <SpeechBubble key="load" anchor="load" text={t('load.disabled_bubble')} onAct={openLoad} onClose={dismissLoad} />}
      {help && <SpeechBubble key="help" anchor="menu" text={helpCombo && !touch ? t('hint.help', { shortcut: prettyCombo(helpCombo) }) : t('hint.help_touch')} onAct={openHelp} onClose={closeHelp} />}
      {immersive && <SpeechBubble key="immersive" anchor="menu" text={t('immersive.bubble')} onAct={fullscreen.toggle} onClose={closeImmersive} />}
    </AnimatePresence>
  );
}
