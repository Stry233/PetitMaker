import { useCallback, useEffect, useRef, useState } from 'react';
import { host } from './kit/host';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from './i18n/context';
import { useEditorStore } from './state/store';
import { PixiCanvas } from './canvas/map2d/PixiCanvas';
import { Editor3DCanvas } from './canvas/map3d/Editor3DCanvas';
import { preloadScene3D } from './canvas/map3d/preload';
import { installSelectionViewSync } from './canvas/interaction/selection-view-sync';
import { installRegionViewSync } from './canvas/interaction/region-view-sync';
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
import { InAppBrowserNotice } from './ui/chrome/guards/InAppBrowserNotice';
import { DevBuildNotice } from './ui/chrome/guards/DevBuildNotice';
import { PortraitGuard } from './ui/chrome/guards/PortraitGuard';
import { LegalBar } from './legal/LegalBar';
import { ContextMenu } from './ui/chrome/floating/ContextMenu';
import { DeletePopover } from './ui/chrome/floating/DeletePopover';
import { SelectionHandles } from './ui/chrome/floating/SelectionHandles';
import { AnnotationEditor } from './ui/chrome/floating/AnnotationEditor';
import { useRestoreFade } from './ui/hooks/useRestoreFade';

import { announceArrival } from './core/runtime/arrival-bus';
import { scheduleAutosave, type RestoredAutosave } from './io/autosave';
import { installAPI } from './api/editor-api';
import { poolAvailable, runMacroBuildInPool, runPreviewInPool, warmPool } from './kit/operations/candidate-pool';
import { installMacroBuildRunner, installMacroPreviewRunner } from './tools/macros';

import type { PersistedCamera } from './io/save-format';
// The panel's settings store pulls provider METADATA (defaults.ts) and the key vault only, never
// the SDKs, so it costs the main bundle nothing.
import { useAgentSession } from './agent/session/store';
import { useAgentPanelSettings } from './ui/agent/settings';

import { loadMap } from './kit/operations';

// The 2D↔3D crossfade's duration, shared with the restore fade: one vocabulary for "the map view
// changes underneath you". Editor3DCanvas's half of the crossfade matches it.
const VIEW_FADE = '0.35s';

export default function App() {
  useCursorVars(); // publish the DOM cursors to <html>, which every non-canvas surface reads
  useMotionEnabled(); // publish the effective motion preference to the canvas gate + <html>

  // A restored camera parked between "loadMap committed" and "the views have re-applied their own
  // camera reset" (2D's fitToMap runs in PixiCanvas's own gridState effect) — see the apply effect
  // below, keyed on gridState so it always runs AFTER that reset rather than racing it.
  const pendingRestoreCamera = useRef<PersistedCamera | null>(null);
  // Covers the restore's discontinuity (a new map, then a new camera, then the first frame that
  // shows them) with a fade of the view; see useRestoreFade for why the view fades instead of the
  // camera flying, and what the release waits for.
  const restoreFade = useRestoreFade();
  const settleRestoreFade = restoreFade.settle;

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
  const eventBus = useEditorStore((s) => s.eventBus);

  /* ── Autosave: debounced persistence of the working map. Edits mutate gridState in place (stable
       ref) and announce via the event bus, so we persist on cells/objects changes. ONLY persist a map
       with content — a fresh/untouched map must never overwrite a real saved session (so the
       restore-offer survives an open-and-reload), and accidentally clearing a map keeps the last good
       save as a safety net. ── */
  useEffect(() => {
    // The has-content gate lives inside scheduleAutosave, at write time: it is a
    // whole-grid walk, and cells-changed fires once per COMMAND (dozens per stroke).
    const persist = () => {
      const s = useEditorStore.getState().gridState;
      if (s) scheduleAutosave(s);
    };
    eventBus.on('cells-changed', persist);
    eventBus.on('objects-changed', persist);
    return () => {
      eventBus.off('cells-changed', persist);
      eventBus.off('objects-changed', persist);
    };
  }, [eventBus]);
  useEffect(() => {
    if (gridState) scheduleAutosave(gridState);
  }, [gridState]);
  // Annotation edits mutate gridState in place without a bus event; the epoch is their announce.
  const annotationsEpoch = useEditorStore((s) => s.annotationsEpoch);
  useEffect(() => {
    if (annotationsEpoch > 0 && gridState) scheduleAutosave(gridState);
  }, [annotationsEpoch, gridState]);

  /* ── Apply a restored camera once the new gridState has committed. Effects fire child-before-
       parent within one commit, so this (App, the parent) always runs AFTER PixiCanvas's own
       gridState effect (which calls viewport.fitToMap — a reset that would otherwise clobber a
       camera applied any earlier). The 3D side has no equivalent race: Editor3DCanvas's camera
       registry either applies straight to a live scene or parks the angle for the scene's own
       construction to pick up (see canvas/map3d/scene/pending-camera.ts), so calling it here is
       always safe. ── */
  useEffect(() => {
    if (!gridState) return;
    const cam = pendingRestoreCamera.current;
    pendingRestoreCamera.current = null;
    if (cam?.view2d) host.camera.set2d(cam.view2d);
    if (cam?.view3d) host.camera.set3d(cam.view3d);
    // The map and the camera are both applied now, so this is the earliest point from which "the
    // restored view is on screen" is a well-posed question. Arms the restore fade's release on it
    // (a no-op unless a fade is in flight — a save with no camera still needs the gate).
    settleRestoreFade(gridState);
  }, [gridState, settleRestoreFade]);

  // Resume the last session. The shell owns the offer; the sequencing is here, where the fade and
  // the camera hand-off live.
  const restoreSession = useCallback((save: RestoredAutosave) => {
    // Hide the view from this commit until the restored map is actually painted: the map
    // swap lands here, the camera in the effect above, the first frame later still — all of
    // it behind a transparent canvas, and the restored view fades in once it is on screen.
    restoreFade.begin();
    loadMap(save.state);
    // The undo steps that came with it, onto the executor `loadMap` has just built — it replaces the
    // one holding the old map's stack, so this runs after and never before. Resuming means picking
    // the work back up, and the work includes being able to take back the last thing you did.
    if (save.history?.length) {
      useEditorStore.getState().commandExecutor?.restoreHistory(save.history);
    }
    // Queued for the apply effect above (runs once this gridState commits), never both
    // views blind-swapped — each is independently optional, so a save missing one
    // (older build, or that view was never opened last session) simply leaves it alone.
    pendingRestoreCamera.current = save.camera ?? null;
    // The assistant's session follows the map: resuming the map resumes the conversation about it.
    useAgentSession.getState().hydrate();
    // What the arrival notice will say once the offer's own surface is gone. It replaces the boot
    // arrival announced below, which was posted before this was an answerable question.
    announceArrival({ kind: 'restored' });
  }, [restoreFade]);

  /* Announce the first map mounted by the app. The new-project window owns template changes, while
     file imports do not announce an arrival. The restore offer and notice resolve through the same
     restore-offer channel. */
  const arrivalAnnounced = useRef(false);
  useEffect(() => {
    if (!gridState || arrivalAnnounced.current) return;
    arrivalAnnounced.current = true;
    announceArrival({ kind: 'boot' });
  }, [gridState]);

  // One subscription keeps the selection ring synchronized across both mounted views.
  useEffect(() => installSelectionViewSync(), []);
  useEffect(() => installRegionViewSync(), []);

  // Install the worker-backed macro runners at the layer seam and warm them before first hover.
  // Headless environments keep the synchronous fallback when the pool is unavailable.
  useEffect(() => {
    if (!poolAvailable()) return;
    installMacroPreviewRunner(runPreviewInPool);
    installMacroBuildRunner(runMacroBuildInPool);
    warmPool();
  }, []);

  // Preload the 3D scene at idle; sessions that open in 3D load it eagerly at the entry point.
  useEffect(() => { preloadScene3D({ idle: true }); }, []);
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
      <InAppBrowserNotice />
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
