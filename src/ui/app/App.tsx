import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../state/store';
import { PixiCanvas } from '../../view/map2d/PixiCanvas';
import { Editor3DCanvas } from '../../view/map3d/Editor3DCanvas';
import { onAfterPaint } from '../../platform/async/after-paint';
import { startWarm } from '../shell/warm/schedule';

import { PINNED_DOCK_REF_W } from '../shell/panel-frame';
import { useDockStage } from '../shell/use-dock';
import { Splash } from '../shell/splash/Splash';
import { probeWarmCache } from '../shell/splash/preload';
import { shouldShowSplash } from '../../io/storage/splash-facts';
import { warmIconDecodes } from '../shell/splash/idle-warm';
import { cssMotion, fadeVisibilityCss } from '../design/motion';
import { ArrivalToast } from '../chrome/floating/ArrivalToast';
import { UnsupportedBrowserNotice } from '../chrome/guards/UnsupportedBrowserNotice';
import { MenuBubbles } from '../chrome/floating/MenuBubbles';
import { WhatsNewGate } from '../chrome/modals/whats-new/WhatsNewGate';
import { DevBuildNotice } from '../chrome/guards/DevBuildNotice';
import { PortraitGuard } from '../chrome/guards/PortraitGuard';
import { LegalBar } from '../chrome/LegalBar';
import { useRestoreFade } from './use-restore-fade';
import { usePlanetSessionFade } from '../shell/planet/use-planet-session-fade';
import { useEditorSession } from './use-editor-session';
import { EditorRoot } from './EditorRoot';

import { announceArrival } from '../session/arrival-bus';

// The panel's settings store pulls provider metadata (defaults.ts) and the key vault only, never
// the SDKs, so it costs the main bundle nothing.
import { hydrateAssistantConnection, hydrateAssistantSession } from '../../agent/boot';
import { isTextEntry } from '../../platform/input/text-entry';

// The 2D↔3D crossfade and the restore fade share one motion: "the map view changes underneath you".
const VIEW_FADE = 'map.view.crossfade';
const viewFade = (visible: boolean): string => fadeVisibilityCss(VIEW_FADE, visible);

export default function App() {
  // Covers the restore's discontinuity (a new map, then a new camera, then the first frame that
  // shows them) with a fade of the view; see useRestoreFade for why the view fades instead of the
  // camera flying, and what the release waits for.
  const restoreFade = useRestoreFade();
  // Entering and leaving a planet session swap the map and its camera the same way a restore does.
  usePlanetSessionFade(restoreFade.begin);

  // The boot splash: shown until this build's assets have been fetched once (see splash/preload).
  const [splashActive, setSplashActive] = useState(() => shouldShowSplash());
  const [splashLeaving, setSplashLeaving] = useState(false);
  // The flag can lie warm: a hard reload or cache eviction empties the HTTP cache while
  // localStorage keeps the flag. When the flag skipped the splash, one probe fetch verifies the
  // cache actually answers; a cold answer mounts the splash after all (within the first frames,
  // before anything meaningful is on screen).
  useEffect(() => {
    if (shouldShowSplash()) return;
    let cancelled = false;
    void probeWarmCache().then((warm) => {
      if (!cancelled && !warm) setSplashActive(true);
    });
    return () => { cancelled = true; };
  }, []);
  const viewMode = useEditorStore((s) => s.viewMode);
  const gridState = useEditorStore((s) => s.gridState);
  const afterRestore = useCallback(() => {
    hydrateAssistantSession();
    announceArrival({ kind: 'restored' });
  }, []);
  const restoreSession = useEditorSession({
    beforeRestore: restoreFade.begin,
    afterRestore,
    settleRestore: restoreFade.settle,
  });

  /* Announce the first map mounted by the app. The new-project window owns template changes, while
     file imports do not announce an arrival. The restore offer and notice resolve through the same
     restore-offer channel. */
  const arrivalAnnounced = useRef(false);
  useEffect(() => {
    if (!gridState || arrivalAnnounced.current) return;
    arrivalAnnounced.current = true;
    announceArrival({ kind: 'boot' });
  }, [gridState]);

  // A visit without the splash warms every lazy chunk and first-use file after its first paint; the
  // cold splash runs the same schedule itself. Sessions that open in 3D start the scene at the entry.
  useEffect(() => {
    if (splashActive) return;
    return onAfterPaint(() => { startWarm(); });
  }, [splashActive]);
  // Warm visits decode cached catalog images in idle batches.
  useEffect(() => { if (!splashActive) warmIconDecodes(); }, [splashActive]);

  // Hydrate provider, model, supervision and key status at boot. Sessions hydrate with their map.
  useEffect(() => { void hydrateAssistantConnection(); }, []);

  // The console API is development-only: the dead branch drops its module from a production build.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import('../../editor/dev/editor-api').then(({ installDevAPI }) => installDevAPI());
  }, []);

  // Suppress the browser's native right-click menu app-wide (copy image / link
  // etc.) so only our own context menu shows. Text fields keep theirs (copy/paste).
  useEffect(() => {
    const suppress = (e: MouseEvent) => {
      if (isTextEntry(e.target)) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', suppress);
    return () => document.removeEventListener('contextmenu', suppress);
  }, []);

  /* ── Render ───────────────────────────────────────────── */

  // Both map views stay mounted; viewMode picks the visible one with a soft crossfade
  // (visibility flips after the fade so the hidden canvas stops taking pointer events). The
  // hidden 2D view remains the capture/export engine.
  // The outer wrapper is the restore fade: it fades whichever view is visible, since the other
  // is already at opacity 0. The hide itself carries no transition — it has to land in the same
  // frame as the restore it covers; the release, once the restored map is painted, is what
  // animates (the gate lives in useRestoreFade).
  const mapViews = (
    <div
      style={{
        opacity: restoreFade.hidden ? 0 : 1,
        transition: restoreFade.hidden ? 'none' : cssMotion(VIEW_FADE, ['opacity']),
      }}
    >
      <div
        style={{
          opacity: viewMode === '3d' ? 0 : 1,
          visibility: viewMode === '3d' ? 'hidden' : 'visible',
          transition: viewFade(viewMode !== '3d'),
        }}
      >
        <PixiCanvas />
      </div>
      <Editor3DCanvas fade={viewFade} />
    </div>
  );

  // The assistant's dock is a fact about the window, so it is published from the top: while the sheet
  // of interface is slid aside the docked panel owns a strip of the viewport, and the frame and the
  // chrome both fit into what is left at one factor (`ui/design/scale.tsx:frameFit`'s `refWiden`). A
  // surface deriving its own answer is the drift that file exists to prevent, so the number stands
  // over the whole app.
  const { aside } = useDockStage();

  return (
    <EditorRoot
      dockRef={aside * PINNED_DOCK_REF_W}
      onRestoreSession={restoreSession}
      splashActive={splashActive}
      // The splash hand-off is two planes parting: the overlay slides up and away while this plane,
      // the whole app, slides its last stretch up into place on the same clock. The transform breaks
      // position:fixed anchoring inside the plane for exactly the boot hand-off (everything rides
      // together, which is the effect), and is removed entirely, not left at an identity value, the
      // moment the splash unmounts. A real full-viewport box rather than a bare wrapper: the app's
      // surfaces are position:fixed, so the plane must be their containing block at viewport size for
      // the translate to carry them; vh rather than %, for the same reason.
      plane={{
        style: splashActive
          ? {
              position: 'fixed',
              inset: 0,
              transform: splashLeaving ? 'translateY(0)' : 'translateY(4vh)',
              transition: splashLeaving ? cssMotion('splash.handoff', ['transform']) : 'none',
            }
          : undefined,
      }}
      // The arrival greeting shares the toast rung, so it paints first: a refusal answers something
      // the visitor just tried and must never be lost under the greeting, which also stands one toast
      // lower, so the two only meet under a stack of them.
      beforeToasts={<ArrivalToast splashActive={splashActive} />}
      notices={(
        <>
          <DevBuildNotice />
          <UnsupportedBrowserNotice />
          <MenuBubbles splashActive={splashActive} />
          <WhatsNewGate splashActive={splashActive} />
          <LegalBar />
          <PortraitGuard />
        </>
      )}
      after={splashActive ? <Splash onHandoff={() => setSplashLeaving(true)} onDone={() => setSplashActive(false)} /> : null}
    >
      {mapViews}
    </EditorRoot>
  );
}
