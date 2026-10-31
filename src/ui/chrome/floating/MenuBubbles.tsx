import { effectiveCombo } from '../../../state/keymap/resolve';
import { prettyCombo } from '../../../platform/input/combo';
import { useKeybinds } from '../../../state/keymap/store';
/**
 * The shell's speech bubbles, one at a time in this order: the region-load notice, a pointer to Help
 * as the tour ends, on a touch device the invitation into immersive mode, and the first time the
 * object shelf's brush button stands usable, a pointer to it (UI-57). All wait behind the splash,
 * the tour and any open window; only the brush pointer is remembered, once per browser.
 */
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { useLayoutShape, useTouchMode } from '../../design/input-mode';
import { useArrivalStanding } from '../../session/arrival-bus';
import { useFullscreen } from '../../primitives/use-fullscreen';
import { entersImmersiveItself } from '../../../platform/device/installed-immersive';
import { tourSettled } from '../tour/use-tour';
import { arrivalOpens } from './arrival-gate';
import { SpeechBubble } from './SpeechBubble';
import { anyModalOpen } from '../../../state/slices/shell';
import { brushHintOwed, rememberBrushHintSeen } from '../../../io/storage/brush-hint-facts';
import { useShelfBrushStanding } from '../../session/shelf-brush-standing';
import { useReadingT } from '../../design/reading';

export function MenuBubbles({ splashActive }: { splashActive: boolean }) {
  const t = useT();
  const read = useReadingT();
  const loadDue = useEditorStore((s) => s.loadLimitNotice);
  const dismissLoad = useEditorStore((s) => s.dismissLoadLimitNotice);
  const touch = useTouchMode();
  const overrides = useKeybinds(s => s.overrides);
  const helpCombo = effectiveCombo(overrides, 'app.whats_this');
  const fullscreen = useFullscreen();
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const modals = useEditorStore((s) => s.modals);
  const setModal = useEditorStore((s) => s.setModal);
  const [helpDue, setHelpDue] = useState(false);
  const [immersiveDone, setImmersiveDone] = useState(false);
  const [brushOwed, setBrushOwed] = useState(brushHintOwed);
  const brushStanding = useShelfBrushStanding();
  const brushBarOpen = useEditorStore((s) => s.objectBrushBar);
  const openBrushBar = useEditorStore((s) => s.setObjectBrushBar);
  // Opening the brush bar, by the button or the bubble, says the button has been found.
  useEffect(() => {
    if (!brushBarOpen || !brushOwed) return;
    rememberBrushHintSeen();
    setBrushOwed(false);
  }, [brushBarOpen, brushOwed]);

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
  const repairOpen = useEditorStore((s) => s.repairSession !== null);
  // Upright, the arrival notice spans the band a bubble from the menu points into, and in touch mode
  // both draw at a fingertip's size, which leaves no room beside it; they wait for it.
  const upright = useLayoutShape() === 'portrait';
  const arrivalStanding = useArrivalStanding();
  const arrivalCovered = (upright || touch) && arrivalStanding;
  const released = !windowOpen && !reviewing && !arrivalCovered
    && arrivalOpens({
      splashActive, tourRunning, tourSettled: tourSettled(), whatsNewOpen: modals.whatsNew, repairOpen,
    });
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
  // An installed app that enters on its own needs no invitation.
  const invited = !entersImmersiveItself();
  const immersive = released && settled && !loadDue && !helpDue && !immersiveDone && touch && fullscreen.available && !fullscreen.active && invited;
  const brush = released && settled && !loadDue && !helpDue && !immersive && brushOwed && brushStanding && !brushBarOpen;

  const openLoad = useCallback(() => setModal('regionLoad', true), [setModal]);
  const openHelp = useCallback(() => setModal('help', true), [setModal]);
  const closeHelp = useCallback(() => setHelpDue(false), []);
  const closeImmersive = useCallback(() => setImmersiveDone(true), []);
  const actBrush = useCallback(() => openBrushBar(true), [openBrushBar]);
  const closeBrush = useCallback(() => { rememberBrushHintSeen(); setBrushOwed(false); }, []);

  return (
    <AnimatePresence>
      {load && <SpeechBubble key="load" anchor="load" text={t('load.disabled_bubble')} onAct={openLoad} onClose={dismissLoad} />}
      {help && <SpeechBubble key="help" anchor="menu" text={helpCombo && !touch ? t('hint.help', { shortcut: prettyCombo(helpCombo) }) : t('hint.help_touch')} onAct={openHelp} onClose={closeHelp} />}
      {immersive && <SpeechBubble key="immersive" anchor="menu" text={t('immersive.bubble')} onAct={fullscreen.toggle} onClose={closeImmersive} />}
      {brush && <SpeechBubble key="brush" anchor="shelf-brush" text={read('objects.brush_bubble')} onAct={actBrush} onClose={closeBrush} prefer="above" anchorPresses />}
    </AnimatePresence>
  );
}
