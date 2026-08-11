import { useCallback, useEffect, useRef } from 'react';
import { host } from './kit/host';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from './i18n/context';
import { useEditorStore } from './state/store';
import { PixiCanvas } from './canvas/map2d/PixiCanvas';
import { Editor3DCanvas } from './canvas/map3d/Editor3DCanvas';
import { preloadScene3D } from './canvas/map3d/preload';
import { installSelectionViewSync } from './canvas/interaction/selection-view-sync';
import { useCursorVars } from './ui/design/cursors/cursor-vars';
import { useMotionEnabled } from './ui/hooks/useMotionEnabled';

import { Shell } from './ui/shell/Shell';
import { ToastContainer } from './ui/chrome/floating/Toast';
import { CurveHandles } from './ui/chrome/floating/CurveHandles';
import { RouteMarks } from './ui/chrome/floating/RouteMarks';
import { InAppBrowserNotice } from './ui/chrome/guards/InAppBrowserNotice';
import { DevBuildNotice } from './ui/chrome/guards/DevBuildNotice';
import { PortraitGuard } from './ui/chrome/guards/PortraitGuard';
import { LegalBar } from './legal/LegalBar';
import { ContextMenu } from './ui/chrome/floating/ContextMenu';
import { DeletePopover } from './ui/chrome/floating/DeletePopover';
import { SelectionHandles } from './ui/chrome/floating/SelectionHandles';
import { useRestoreFade } from './ui/hooks/useRestoreFade';

import { scheduleAutosave, type RestoredAutosave } from './io/autosave';
import { installAPI } from './api/editor-api';
import { poolAvailable, runMacroBuildInPool, runPreviewInPool, warmPool } from './kit/operations/candidate-pool';
import { installMacroPreviewRunner } from './tools/macros/preview';
import { installMacroBuildRunner } from './tools/macros';

import type { PersistedCamera } from './io/save-format';
// safe in the main bundle: the agent store only pulls provider METADATA (defaults.ts), not the SDKs
import { useAgentSession } from './agent/session';

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
    // the agent's site log follows the map: resuming the map resumes the chat
    useAgentSession.getState().hydrateFromStorage();
  }, [restoreFade]);

  /* ── The selection ring moves with the active view (2D↔3D). One subscription for both canvases,
       installed here because this is where both views are mounted. ── */
  useEffect(() => installSelectionViewSync(), []);

  /* ── The macro tool's ghost preview AND its press's build run in the generation worker pool.
       The tool layer declares the hooks and cannot import the pool (kit sits above it); this is
       the one place that holds both ends. Guarded, so tests and headless runs keep the
       synchronous path. The pool is WARMED here too: a worker's first job otherwise pays the
       module load, under the first hovering pointer. ── */
  useEffect(() => {
    if (!poolAvailable()) return;
    installMacroPreviewRunner(runPreviewInPool);
    installMacroBuildRunner(runMacroBuildInPool);
    warmPool();
  }, []);

  /* ── The 3D scene's module, fetched at idle for the same reason: the first press of the 3D
       button otherwise waits on a download before it can start building. A session that OPENS in
       3D has already started it eagerly from the entry point, where it can overlap this mount. ── */
  useEffect(() => { preloadScene3D({ idle: true }); }, []);

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

  return (
    // reducedMotion="user" gates EVERY Framer/DOM animation on prefers-reduced-motion
    // (the canvas side is gated separately via renderer/motion-state). One switch.
    <MotionConfig reducedMotion={motionPref === 'reduced' ? 'always' : motionPref === 'full' ? 'never' : 'user'}>
    <I18nProvider>
      <Shell onRestoreSession={restoreSession}>{mapViews}</Shell>

      {/* Chrome the shell does not own: it reads the store and the event bus, and places itself. */}
      <ToastContainer />
      <CurveHandles />
      <RouteMarks />
      <DevBuildNotice />
      <InAppBrowserNotice />
      <LegalBar />
      <PortraitGuard />
      <SelectionHandles />
      <ContextMenu />
      <DeletePopover />
    </I18nProvider>
    </MotionConfig>
  );
}
