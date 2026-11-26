import { useEffect, useState } from 'react';
import { useEditorStore } from '../../state/store';
import { onAfterPaint } from '../../platform/async/after-paint';
import { startWarm } from '../shell/warm/schedule';

import { useDockRefValue } from '../shell/use-dock';
import { Splash } from '../shell/splash/Splash';
import { cacheWarmAtBoot, splashOwedNow } from '../../editor/session/boot-assets';
import { ArrivalToast } from '../chrome/floating/ArrivalToast';
import { UnsupportedBrowserNotice } from '../chrome/guards/UnsupportedBrowserNotice';
import { MenuBubbles } from '../chrome/floating/MenuBubbles';
import { WhatsNewGate } from '../chrome/modals/whats-new/WhatsNewGate';
import { DevBuildNotice } from '../chrome/guards/DevBuildNotice';
import { LegalBar } from '../chrome/LegalBar';
import { useRestoreFade } from './use-restore-fade';
import { usePlanetSessionFade } from '../shell/planet/use-planet-session-fade';
import { EditorRoot } from './EditorRoot';
import { MapViews } from './MapViews';

// The panel's settings store pulls provider metadata (defaults.ts) and the key vault only, never
// the SDKs, so it costs the main bundle nothing.
import { hydrateAssistantConnection } from '../../agent/boot';
import { whenRestoreBegins } from '../../editor/session/restore';
import { isTextEntry } from '../../platform/input/text-entry';

export default function App() {
  // Covers the restore's discontinuity (a new map, then a new camera, then the first frame that
  // shows them) with a fade of the view; see useRestoreFade for why the view fades instead of the
  // camera flying, and what the release waits for.
  const restoreFade = useRestoreFade();
  // Entering and leaving a planet session swap the map and its camera the same way a restore does.
  usePlanetSessionFade(restoreFade.begin);

  // The boot splash: shown until this build's assets have been fetched once
  // (`editor/session/boot-assets.ts`). The flag can lie warm (a hard reload or cache eviction empties
  // the cache and keeps the flag), so the boot's cache answer decides; the web entry renders once it is known.
  const [splashActive, setSplashActive] = useState(splashOwedNow);
  const [splashLeaving, setSplashLeaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void cacheWarmAtBoot().then((warm) => {
      if (!cancelled && !warm) setSplashActive(true);
    });
    return () => { cancelled = true; };
  }, []);
  const gridState = useEditorStore((s) => s.gridState);
  // A restore, whoever asks for it (`editor/session/restore.ts:acceptRestoreOffer`), lands between
  // the fade's hide and its release; what follows the map in is the editor's and the assistant's.
  const { begin: beginFade, settle: settleFade } = restoreFade;
  useEffect(() => whenRestoreBegins(beginFade), [beginFade]);
  // Parent effects run after the views have drawn the new map and taken its parked camera.
  useEffect(() => { if (gridState) settleFade(gridState); }, [gridState, settleFade]);

  // A visit without the splash warms every lazy chunk and first-use file after its first paint; the
  // cold splash runs the same schedule itself. Sessions that open in 3D start the scene at the entry.
  useEffect(() => {
    if (splashActive) return;
    return onAfterPaint(() => { startWarm(); });
  }, [splashActive]);

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

  // The assistant's dock is a fact about the window, so it is published from the top: while the sheet
  // of interface is slid aside the docked panel owns a strip of the viewport, and the frame and the
  // chrome both fit into what is left at one factor (`ui/design/scale.tsx:frameFit`'s `refWiden`). A
  // surface deriving its own answer is the drift that file exists to prevent, so the number stands
  // over the whole app.
  const dockRef = useDockRefValue();

  return (
    <EditorRoot
      dockRef={dockRef}
      splashActive={splashActive}
      plane={{ handoff: !splashActive ? 'none' : splashLeaving ? 'leaving' : 'covered' }}
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
        </>
      )}
      after={splashActive ? <Splash onHandoff={() => setSplashLeaving(true)} onDone={() => setSplashActive(false)} /> : null}
    >
      <MapViews hidden={restoreFade.hidden} />
    </EditorRoot>
  );
}
