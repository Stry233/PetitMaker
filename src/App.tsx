import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { petitWindow } from './core/runtime/window-bridge';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { I18nProvider } from './i18n/context';
import { useEditorStore } from './state/store';
import { PixiCanvas } from './canvas/map2d/PixiCanvas';
import { Editor3DCanvas } from './canvas/map3d/Editor3DCanvas';
import { createDefaultRegistry } from './rules/index';
import { setCursorBusy } from './canvas/interaction/cursor-controller';
import { installSelectionViewSync } from './canvas/interaction/selection-view-sync';
import { useCursorVars } from './ui/cursors/cursor-vars';

import { designModeToToolType } from './ui/menu/design-mode';
import { GeneratePanel } from './ui/menu/GeneratePanel';
import { HistoryControls } from './ui/chrome/HistoryControls';
import { ZoomControls } from './ui/chrome/ZoomControls';
import { MainMenuCard } from './ui/menu/MainMenuCard';
import { CollapsedPhone } from './ui/menu/PhoneCard';
import { BuildPanel } from './ui/menu/BuildPanel';
import { useMenuScale, ScaleProvider } from './ui/menu/scale';
import { KeyboardModal } from './ui/chrome/keyboard/KeyboardModal';
import { SettingsModal } from './ui/chrome/SettingsModal';
import { AboutModal } from './ui/chrome/AboutModal';
import { NewProjectModal } from './ui/chrome/NewProjectModal';
import { RestoreBubble } from './ui/chrome/RestoreBubble';
import { discardStoredSession } from './agent/session';
import { ToastContainer } from './ui/chrome/Toast';
import { DevBuildNotice } from './ui/chrome/DevBuildNotice';
import { PortraitGuard } from './ui/chrome/PortraitGuard';
import { LegalBar } from './legal/LegalBar';
import { ContextMenu } from './ui/chrome/ContextMenu';
import { DeletePopover } from './ui/chrome/DeletePopover';
import { SelectionHandles } from './ui/chrome/SelectionHandles';
import { RegionSelectPanel } from './ui/chrome/RegionSelectPanel';
import { ExportModal } from './ui/chrome/export/ExportModal';
import { ExportJsonModal } from './ui/chrome/export/ExportJsonModal';
import { ImportModal } from './ui/chrome/import/ImportModal';
import { DropImportOverlay } from './ui/chrome/import/DropImportOverlay';
import { useRegionBrush } from './ui/hooks/useRegionBrush';
import { useMapFileIO } from './ui/hooks/useMapFileIO';
import { useGenerateRun } from './ui/hooks/useGenerateRun';
import { useMenuNavigation } from './ui/hooks/useMenuNavigation';
import { useEditorShortcuts } from './ui/hooks/useEditorShortcuts';
import { useRestoreFade } from './ui/hooks/useRestoreFade';
import { LayerPanelHost } from './ui/menu/LayerPanelHost';
import { PlacementPanel } from './ui/menu/PlacementPanel';

import { scheduleAutosave, readAutosave, type RestoredAutosave } from './io/autosave';
import { installAPI } from './api/editor-api';

import { ToolType } from './core/model/types';
import type { MacroCoord, GridState } from './core/model/types';
import type { PersistedCamera } from './io/save-format';
// safe in the main bundle: the agent store only pulls provider METADATA (defaults.ts), not the SDKs
import { useAgentSession } from './agent/session';

import { getMapTemplate } from './config/maps';

// Lazy chunk: three.js + the 3D preview load only when the overlay first opens,
// keeping the main bundle untouched (same pattern as the agent SDK lazy-load).
const Preview3D = lazy(() => import('./canvas/map3d/Preview3D').then((m) => ({ default: m.Preview3D })));

// The 2D↔3D crossfade's duration, shared with the restore fade: one vocabulary for "the map view
// changes underneath you". Editor3DCanvas's half of the crossfade matches it.
const VIEW_FADE = '0.35s';

/** Whether an autosaved map is worth offering to restore: it has any terrain or
 *  any non-locked object. The plaza is auto-recreated and locked, so an untouched
 *  map reads as empty and we skip the prompt. */
function mapHasContent(state: GridState): boolean {
  for (const row of state.cells) {
    for (const cell of row) if (cell?.terrain) return true;
  }
  for (const obj of state.objects.values()) {
    if (!obj.locked) return true;
  }
  return false;
}

export default function App() {
  useCursorVars(); // publish the DOM cursors to <html>, which every non-canvas surface reads

  /* ── Modal state ──────────────────────────────────────── */
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  // A valid autosave awaiting the user's resume/start-fresh choice (startup only).
  const [restoreCandidate, setRestoreCandidate] = useState<RestoredAutosave | null>(null);
  const [phoneHover, setPhoneHover] = useState(false); // hovering the collapsed phone → hint the restore bubble will dismiss
  // A restored camera parked between "loadMap committed" and "the views have re-applied their own
  // camera reset" (2D's fitToMap runs in PixiCanvas's own gridState effect) — see the apply effect
  // below, keyed on gridState so it always runs AFTER that reset rather than racing it.
  const pendingRestoreCamera = useRef<PersistedCamera | null>(null);
  // Covers the restore's discontinuity (a new map, then a new camera, then the first frame that
  // shows them) with a fade of the view; see useRestoreFade for why the view fades instead of the
  // camera flying, and what the release waits for.
  const restoreFade = useRestoreFade();
  const settleRestoreFade = restoreFade.settle;

  /* ── Tool option state (single source of truth lives in the store) ── */
  const designMode = useEditorStore((s) => s.designMode);
  const setDesignMode = useEditorStore((s) => s.setDesignMode);
  const contentType = useEditorStore((s) => s.contentType);
  const brushSize = useEditorStore((s) => s.brushSize);
  const tileMaterial = useEditorStore((s) => s.tileMaterial);
  const setTileMaterial = useEditorStore((s) => s.setTileMaterial);
  const autoEdgeCut = useEditorStore((s) => s.autoEdgeCut);
  const setAutoEdgeCut = useEditorStore((s) => s.setAutoEdgeCut);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const motionPref = useEditorStore((s) => s.motionPref);
  const setMotionPref = useEditorStore((s) => s.setMotionPref);
  const systemCursors = useEditorStore((s) => s.systemCursors);
  const setSystemCursors = useEditorStore((s) => s.setSystemCursors);

  const menuScale = useMenuScale();
  const selectedItemId = useEditorStore((s) => s.selectedItemId);

  /* ── Generate state ──────────────────────────────────── */
  const agentRunning = useAgentSession((s) => s.running);
  const [genRegion, setGenRegion] = useState<MacroCoord[]>([]);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);
  const regionTool = useEditorStore((s) => s.regionTool);
  const regionBrushSize = useEditorStore((s) => s.regionBrushSize);
  const setRegionTool = useEditorStore((s) => s.setRegionTool);
  const setRegionBrushSize = useEditorStore((s) => s.setRegionBrushSize);

  /* ── Orchestration hooks (file IO, generate run, menu nav) ── */
  const { handleExport, handleImport, handleImage } = useMapFileIO();
  const {
    menuView,
    menuCollapsed, setMenuCollapsed,
    placementCategory,
    handleTileAction,
    openBuild,
  } = useMenuNavigation({
    setSelectingRegion,
    setGenRegion,
    setShowNewProject,
    handleImage,
    handleExport,
    handleImport,
  });
  const { generating, onGenerate, onClear } = useGenerateRun({
    menuView,
    genRegion,
    setGenRegion,
    setSelectingRegion,
  });

  // The map is unusable while a generation runs; say so on the pointer as well as in the panel.
  // The cleanup releases busy on unmount, so a `generating` that never flips back cannot strand it.
  useEffect(() => {
    setCursorBusy(generating);
    return () => setCursorBusy(false);
  }, [generating]);

  /* ── History state ────────────────────────────────────── */
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  /* ── Store selectors ──────────────────────────────────── */
  const locale = useEditorStore((s) => s.locale);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showChunkBounds = useEditorStore((s) => s.showChunkBounds);
  const preview3DOpen = useEditorStore((s) => s.preview3DOpen);
  const setPreview3DOpen = useEditorStore((s) => s.setPreview3DOpen);
  const viewMode = useEditorStore((s) => s.viewMode);
  const gridState = useEditorStore((s) => s.gridState);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setLocale = useEditorStore((s) => s.setLocale);
  const setShowGrid = useEditorStore((s) => s.setShowGrid);
  const setShowChunkBounds = useEditorStore((s) => s.setShowChunkBounds);
  const initMap = useEditorStore((s) => s.initMap);
  const eventBus = useEditorStore((s) => s.eventBus);

  /* ── Track undo/redo availability. Layer-panel refresh on cell changes lives in
       LayerPanelHost so painting re-renders only the panel, not all of App. ── */
  useEffect(() => {
    const onHistory = ({ canUndo: u, canRedo: r }: { canUndo: boolean; canRedo: boolean }) => {
      setCanUndo(u);
      setCanRedo(r);
    };
    eventBus.on('history-changed', onHistory);
    return () => eventBus.off('history-changed', onHistory);
  }, [eventBus]);

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
       camera applied any earlier). The 3D side has no equivalent race: Editor3DCanvas's bridge
       either applies straight to a live scene or parks the angle for the scene's own construction
       to pick up (see canvas/map3d/scene/pending-camera.ts), so calling it here is always safe. ── */
  useEffect(() => {
    if (!gridState) return;
    const cam = pendingRestoreCamera.current;
    pendingRestoreCamera.current = null;
    if (cam?.view2d) petitWindow().__petitSetCamera?.(cam.view2d);
    if (cam?.view3d) petitWindow().__petitSet3DCamera?.(cam.view3d);
    // The map and the camera are both applied now, so this is the earliest point from which "the
    // restored view is on screen" is a well-posed question. Arms the restore fade's release on it
    // (a no-op unless a fade is in flight — a save with no camera still needs the gate).
    settleRestoreFade(gridState);
  }, [gridState, settleRestoreFade]);

  /* ── Startup: offer to restore the last autosaved session (runs once). ── */
  useEffect(() => {
    // PixiCanvas always opens a FRESH map, so this never blocks. If a content-ful autosave exists,
    // offer to restore it via a bubble from the phone (held in memory, so an autosave overwrite by the
    // fresh map can't lose it). A blank/corrupt/absent save → no offer; the fresh map just stands.
    const candidate = readAutosave();
    if (candidate && mapHasContent(candidate.state)) setRestoreCandidate(candidate);
  }, []);

  // Region-selection brush (Generate) — state machine lives in its own hook.
  const { clearRegion: clearRegionBrush, regionUndo, regionRedo } = useRegionBrush(selectingRegion, genRegion, setGenRegion);

  /* ── The selection ring moves with the active view (2D↔3D). One subscription for both canvases,
       installed here because this is where both views are mounted. ── */
  useEffect(() => installSelectionViewSync(), []);

  /* ── Install programmatic API on mount ────────────────── */
  useEffect(() => {
    installAPI(
      () => useEditorStore.getState().gridState!,
      () => useEditorStore.getState().commandExecutor!,
    );
  }, []);

  /* ── Editor keyboard shortcuts (the full keymap lives in one hook) ───── */
  useEditorShortcuts({ openBuild, handleTileAction, onHelp: () => setShowHelp(true), regionUndo, regionRedo });

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

  /* ── Handlers ─────────────────────────────────────────── */

  const handleNewProject = useCallback(
    (templateId: string) => {
      initMap(getMapTemplate(templateId), createDefaultRegistry());
      setDesignMode('hand');
      setActiveTool(designModeToToolType('hand'));
      setShowNewProject(false);
    },
    [initMap, setActiveTool],
  );

  const handleUndo = useCallback(() => {
    useEditorStore.getState().commandExecutor?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    useEditorStore.getState().commandExecutor?.redo();
  }, []);

  const handleZoomIn = useCallback(() => {
    const fn = petitWindow().__petitZoomIn;
    fn?.();
  }, []);

  const handleZoomOut = useCallback(() => {
    const fn = petitWindow().__petitZoomOut;
    fn?.();
  }, []);

  const handleFit = useCallback(() => {
    const fn = petitWindow().__petitFitMap;
    fn?.();
  }, []);

  /* ── Render ───────────────────────────────────────────── */

  return (
    // reducedMotion="user" gates EVERY Framer/DOM animation on prefers-reduced-motion
    // (the canvas side is gated separately via renderer/motion-state). One switch.
    <MotionConfig reducedMotion={motionPref === 'reduced' ? 'always' : motionPref === 'full' ? 'never' : 'user'}>
    <I18nProvider>
      {/* Both map views stay mounted; viewMode picks the visible one with a soft crossfade
          (visibility flips after the fade so the hidden canvas stops taking pointer events). The
          hidden 2D view remains the capture/export engine.
          The outer wrapper is the RESTORE fade: it fades whichever view is visible, since the other
          is already at opacity 0. The hide itself carries no transition — it has to land in the same
          frame as the restore it covers; the release, once the restored map is painted, is what
          animates (the gate lives in useRestoreFade). */}
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

      {/* Floating phone menu. The home card stays visible; tapping a tile
          pops the matching subpanel up like a comic speech bubble FROM the
          phone (at its design-canvas position), rather than replacing the phone.
          The build spoke is still transitional (wraps the existing panel). */}
      <ScaleProvider value={menuScale}>
      {menuCollapsed ? (
        // Opening the menu = "start fresh": clear the restore offer. Hover hints the bubble dismissal.
        <CollapsedPhone
          onExpand={() => {
            setMenuCollapsed(false);
            // expanding past the offer = start fresh; the agent history starts fresh too
            if (restoreCandidate) discardStoredSession();
            setRestoreCandidate(null);
          }}
          onHoverStart={() => setPhoneHover(true)}
          onHoverEnd={() => setPhoneHover(false)}
        />
      ) : (
        <>
        <MainMenuCard
          onCollapse={() => setMenuCollapsed(true)}
          load={0}
          loadMax={10000}
          onAction={handleTileAction}
          onSettings={() => setShowSettings(true)}
          onHelp={() => setShowHelp(true)}
          generateBusy={generating || agentRunning}
        />
        <AnimatePresence>
        {menuView === 'build' && (
          <BuildPanel
            key="build"
            activeMode={designMode}
            contentType={contentType}
            brushSize={brushSize}
            tileMaterial={tileMaterial}
            onTileMaterialChange={setTileMaterial}
            autoEdgeCut={autoEdgeCut}
            onAutoEdgeCutChange={setAutoEdgeCut}
            onModeChange={(mode) => {
              setDesignMode(mode);
              setActiveTool(designModeToToolType(mode));
              setSelectingRegion(false); // exit region brush when switching to design tools
            }}
            onBrushSizeChange={setBrushSize}
          />
        )}
        {menuView === 'generate' && (
          <GeneratePanel
            key="generate"
            region={genRegion}
            regionSize={genRegion.length}
            isSelecting={selectingRegion}
            generating={generating}
            onSelectRegion={() => {
              setSelectingRegion(true);
              setGenRegion([]);
            }}
            onClearRegion={() => {
              setGenRegion([]);
              setSelectingRegion(false);
              petitWindow().__petitClearPreview?.();
            }}
            onGenerate={onGenerate}
            onClear={onClear}
          />
        )}
        {menuView === 'placement' && placementCategory && (
          <PlacementPanel
            key="placement"
            category={placementCategory}
            selectedItemId={selectedItemId}
            onSelectItem={(item) => {
              const store = useEditorStore.getState();
              if (store.selectedItemId === item.id) {
                store.setSelectedItemId(null);
              } else {
                store.setSelectedItemId(item.id);
                store.setActiveTool(ToolType.ObjectPlacer);
              }
            }}
          />
        )}
        </AnimatePresence>
        </>
      )}
      {/* Restore offer — a bubble FROM the collapsed phone. Its own AnimatePresence so it enters
          (after the phone) and exits smoothly whether dismissed, resumed, or the menu is opened. */}
      <AnimatePresence>
        {menuCollapsed && restoreCandidate && (
          <RestoreBubble
            key="restore"
            hint={phoneHover}
            onRestore={() => {
              // Hide the view from this commit until the restored map is actually painted: the map
              // swap lands here, the camera in the effect above, the first frame later still — all of
              // it behind a transparent canvas, and the restored view fades in once it is on screen.
              restoreFade.begin();
              useEditorStore.getState().loadMap(restoreCandidate.state, createDefaultRegistry());
              // Queued for the apply effect above (runs once this gridState commits), never both
              // views blind-swapped — each is independently optional, so a save missing one
              // (older build, or that view was never opened last session) simply leaves it alone.
              pendingRestoreCamera.current = restoreCandidate.camera ?? null;
              // the agent's site log follows the map: resuming the map resumes the chat
              useAgentSession.getState().hydrateFromStorage();
              setRestoreCandidate(null);
            }}
            onDismiss={() => { discardStoredSession(); setRestoreCandidate(null); }}
          />
        )}
      </AnimatePresence>
      </ScaleProvider>

      {/* History controls — bottom left */}
      <HistoryControls
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* Zoom controls — bottom right */}
      <ZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        tilt={viewMode === '3d'}
      />

      {/* Layer management panel — right side. Self-subscribing so brush strokes
          re-render only the panel (and only when cell stats actually change). */}
      {gridState && (
        <ScaleProvider value={menuScale}>
          <LayerPanelHost />
        </ScaleProvider>
      )}

      {/* Modals */}
      {preview3DOpen && (
        <Suspense fallback={null}>
          <Preview3D onClose={() => setPreview3DOpen(false)} />
        </Suspense>
      )}
      {/* Help/Settings/About/NewProject are all kept mounted and driven by
          `open` so each ModalShell animates the card enter AND exit as one
          unit (a wholesale unmount, `{showX && <XModal/>}`, skipped the exit
          animation). About opens over Settings; closing returns to Settings. */}
      <KeyboardModal open={showHelp} onClose={() => setShowHelp(false)} />

      <SettingsModal
        open={showSettings}
        locale={locale}
        showGrid={showGrid}
        showChunks={showChunkBounds}
        motionPref={motionPref}
        systemCursors={systemCursors}
        onLocaleChange={setLocale}
        onShowGridChange={setShowGrid}
        onShowChunksChange={setShowChunkBounds}
        onMotionPrefChange={setMotionPref}
        onSystemCursorsChange={setSystemCursors}
        onAbout={() => setShowAbout(true)}
        onClose={() => setShowSettings(false)}
      />

      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />

      <NewProjectModal
        open={showNewProject}
        onSelect={handleNewProject}
        onClose={() => setShowNewProject(false)}
      />

      <ExportModal />
      <ExportJsonModal />
      <ImportModal />
      <DropImportOverlay />

      {/* Region selection panel — shown when brushing region for generation.
          ScaleProvider + AnimatePresence stay mounted so the panel can exit-animate. */}
      <ScaleProvider value={menuScale}>
        <AnimatePresence>
          {selectingRegion && (
            <RegionSelectPanel
              key="region"
              cellCount={genRegion.length}
              tool={regionTool}
              brushSize={regionBrushSize}
              onToolChange={setRegionTool}
              onBrushSizeChange={setRegionBrushSize}
              onClear={clearRegionBrush}
              onDone={() => {
                setSelectingRegion(false);
              }}
            />
          )}
        </AnimatePresence>
      </ScaleProvider>

      <ToastContainer />
      <DevBuildNotice />
      <LegalBar />
      <PortraitGuard />
      <SelectionHandles />
      <ContextMenu />
      <DeletePopover />
    </I18nProvider>
    </MotionConfig>
  );
}
