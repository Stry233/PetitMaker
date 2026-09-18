import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from './i18n/context';
import { useEditorStore } from './state/store';
import { PixiCanvas } from './canvas/map2d/PixiCanvas';
import { Editor3DCanvas } from './canvas/map3d/Editor3DCanvas';
import { preloadScene3D } from './canvas/map3d/preload';
import { hasWebGL2 } from './core/runtime/device-quality';
import { useCursorVars } from './ui/design/cursors/cursor-vars';
import { useMotionEnabled } from './ui/hooks/useMotionEnabled';

import { Shell } from './ui/shell/Shell';
import { DockRefProvider } from './ui/design/scale';
import { PINNED_DOCK_REF_W } from './ui/shell/panel-frame';
import { useDockStage } from './ui/shell/use-dock';
import { Splash } from './ui/shell/splash/Splash';
import { probeWarmCache, shouldShowSplash } from './ui/shell/splash/preload';
import { warmIconDecodes } from './ui/shell/splash/idle-warm';
import { cssMotion } from './ui/shell/motion/use-motion';
import { ToastContainer } from './ui/chrome/floating/Toast';
import { ArrivalToast } from './ui/chrome/floating/ArrivalToast';
import { CurveHandles } from './ui/chrome/floating/CurveHandles';
import { UnsupportedBrowserNotice } from './ui/chrome/guards/UnsupportedBrowserNotice';
import { MenuBubbles } from './ui/chrome/floating/MenuBubbles';
import { WhatsNewGate } from './ui/chrome/modals/whats-new/WhatsNewGate';
import { DevBuildNotice } from './ui/chrome/guards/DevBuildNotice';
import { PortraitGuard } from './ui/chrome/guards/PortraitGuard';
import { LegalBar } from './legal/LegalBar';
import { ContextMenu } from './ui/chrome/floating/ContextMenu';
import { DeletePopover } from './ui/chrome/floating/DeletePopover';
import { SelectionHandles } from './ui/chrome/floating/SelectionHandles';
import { AnnotationEditor } from './ui/chrome/floating/AnnotationEditor';
import { useRestoreFade } from './ui/hooks/useRestoreFade';
import { useEditorSession } from './ui/hooks/use-editor-session';

import { announceArrival } from './core/runtime/arrival-bus';
import { installAPI } from './api/editor-api';
import { poolAvailable, runMacroBuildInPool, runPreviewInPool, warmPool } from './kit/operations/candidate-pool';
import { installMacroBuildRunner, installMacroPreviewRunner } from './tools/macros';

// The panel's settings store pulls provider METADATA (defaults.ts) and the key vault only, never
// the SDKs, so it costs the main bundle nothing.
import { useAgentSession } from './agent/session/store';
import { useAgentPanelSettings } from './ui/agent/settings';

// The 2D↔3D crossfade's duration, shared with the restore fade: one vocabulary for "the map view
// changes underneath you". Editor3DCanvas's half of the crossfade matches it.
const VIEW_FADE = '0.35s';

export default function App() {
  useCursorVars(); // publish the DOM cursors to <html>, which every non-canvas surface reads
  useMotionEnabled(); // publish the effective motion preference to the canvas gate + <html>

  // Covers the restore's discontinuity (a new map, then a new camera, then the first frame that
  // shows them) with a fade of the view; see useRestoreFade for why the view fades instead of the
  // camera flying, and what the release waits for.
  const restoreFade = useRestoreFade();

  const motionPref = useEditorStore((s) => s.motionPref);
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
    useAgentSession.getState().hydrate();
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

  // Install the worker-backed macro runners at the layer seam and warm them before first hover.
  // Headless environments keep the synchronous fallback when the pool is unavailable.
  useEffect(() => {
    if (!poolAvailable()) return;
    installMacroPreviewRunner(runPreviewInPool);
    installMacroBuildRunner(runMacroBuildInPool);
    warmPool();
  }, []);

  // Preload the 3D scene at idle; sessions that open in 3D load it eagerly at the entry point.
  // three is WebGL2-only, so a device without it never fetches the chunk.
  useEffect(() => { if (hasWebGL2()) preloadScene3D({ idle: true }); }, []);
  // Decode the catalog icons at idle, so the object shelf's first open paints already-decoded
  // art instead of paying ~80 PNG decodes in one burst.
  useEffect(() => { warmIconDecodes(); }, []);

  // Hydrate provider, model, supervision and key status at boot. Sessions hydrate with their map.
  useEffect(() => { void useAgentPanelSettings.getState().hydrate(); }, []);

  /* ── Install programmatic API on mount ────────────────── */
  useEffect(() => {
    installAPI(
      () => useEditorStore.getState().gridState!,
      () => useEditorStore.getState().commandExecutor!,
    );
  }, []);

  // Suppress the browser's native right-click menu app-wide (copy image / link
  // etc.) so only our own context menu shows. Text fields keep theirs (copy/paste).
  useEffect(() => {
    const suppress = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', suppress);
    return () => document.removeEventListener('contextmenu', suppress);
  }, []);

  /* ── Render ───────────────────────────────────────────── */

  // Both map views stay mounted; viewMode picks the visible one with a soft crossfade
  // (visibility flips after the fade so the hidden canvas stops taking pointer events). The
  // hidden 2D view remains the capture/export engine.
  // The outer wrapper is the RESTORE fade: it fades whichever view is visible, since the other
  // is already at opacity 0. The hide itself carries no transition — it has to land in the same
  // frame as the restore it covers; the release, once the restored map is painted, is what
  // animates (the gate lives in useRestoreFade).
  const mapViews = (
    <div
      style={{
        opacity: restoreFade.hidden ? 0 : 1,
        transition: restoreFade.hidden ? 'none' : `opacity ${VIEW_FADE} ease`,
      }}
    >
      <div
        style={{
          opacity: viewMode === '3d' ? 0 : 1,
          visibility: viewMode === '3d' ? 'hidden' : 'visible',
          transition: viewMode === '3d'
            ? `opacity ${VIEW_FADE} ease, visibility 0s linear ${VIEW_FADE}`
            : `opacity ${VIEW_FADE} ease, visibility 0s linear 0s`,
        }}
      >
        <PixiCanvas />
      </div>
      <Editor3DCanvas />
    </div>
  );

  // THE ASSISTANT'S DOCK IS A FACT ABOUT THE WINDOW, so it is published from the top: while the sheet
  // of interface is slid aside the docked panel owns a strip of the viewport, and the frame and the
  // chrome both fit into what is left at ONE factor (`ui/design/scale.tsx:frameFit`'s `refWiden`). A
  // surface deriving its own answer is the drift that file exists to prevent, so the number stands
  // over the whole app.
  const { aside } = useDockStage();

  return (
    // reducedMotion="user" gates EVERY Framer/DOM animation on prefers-reduced-motion
    // (the canvas side is gated separately via renderer/motion-state). One switch.
    <MotionConfig reducedMotion={motionPref === 'reduced' ? 'always' : motionPref === 'full' ? 'never' : 'user'}>
    <I18nProvider>
    <DockRefProvider value={aside * PINNED_DOCK_REF_W}>
      {/* The splash hand-off is two planes parting: the overlay slides up and away while this
          plane — the whole app — slides its last stretch up into place on the same clock. The
          transform breaks position:fixed anchoring INSIDE the plane for exactly the boot
          hand-off (everything rides together, which is the effect), and is removed entirely,
          not left at an identity value, the moment the splash unmounts. */}
      <div
        style={splashActive
          ? {
              // A real full-viewport box, not a bare wrapper: the app's surfaces are
              // position:fixed, so the plane must be their containing block at viewport size for
              // the translate to carry them — a zero-height div translates nothing. vh, not %,
              // for the same reason.
              position: 'fixed',
              inset: 0,
              transform: splashLeaving ? 'translateY(0)' : 'translateY(4vh)',
              transition: splashLeaving ? cssMotion('splash.handoff', 'transform') : 'none',
            }
          : undefined}
      >
      <Shell onRestoreSession={restoreSession} splashActive={splashActive}>{mapViews}</Shell>

      {/* Chrome the shell does not own: it reads the store and the event bus, and places itself. */}
      {/* BEFORE the toasts, and it has to be: the two share the `z.toast` rung, so paint order is
          what decides which wins where they meet. A refusal answers something the visitor just
          tried and must never be lost under an eight-second greeting. The greeting also stands one
          toast lower on the screen, so the two only meet under a stack of them. */}
      <ArrivalToast splashActive={splashActive} />
      <ToastContainer />
      <CurveHandles />
      <DevBuildNotice />
      <UnsupportedBrowserNotice />
      <MenuBubbles splashActive={splashActive} />
      <WhatsNewGate splashActive={splashActive} />
      <LegalBar />
      <PortraitGuard />
      <SelectionHandles />
      <AnnotationEditor />
      <ContextMenu />
      <DeletePopover />
      </div>
      {splashActive && (
        <Splash onHandoff={() => setSplashLeaving(true)} onDone={() => setSplashActive(false)} />
      )}
    </DockRefProvider>
    </I18nProvider>
    </MotionConfig>
  );
}
