/*
 * The application shell around the map: the mode row, the assistant's block, the corner actions,
 * the active mode's bottom surface and the rail, under one combined page and UI zoom. The armed mode
 * drives the bottom surface; the assistant opens on its own. The shell also runs the tour.
 */
import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SUPPORTS_ASSISTANT } from '../../platform/build/edition';
import type { RestoredAutosave } from '../../io/storage/autosave';
import { hasAutosave } from '../../io/storage/facts';
import { useEditorStore } from '../../state/store';
import { anyModalOpen } from '../../state/slices/shell';
import { SurfaceBoundary } from '../chrome/guards/SurfaceBoundary';
import { TourDoneModal } from '../chrome/tour/TourDoneModal';
import { TourOverlay } from '../chrome/tour/TourOverlay';
import { useFirstLaunchTour } from '../chrome/tour/use-tour';
import { useFocusSource } from '../design/focus-source';
import { cssMotion } from '../design/motion';
import { useBeat, useMotionAllowed, useTransition } from '../design/motion/use-motion';
import { useUiPreview, useUiPreviewPose } from '../design/preview';
import { ScaleProvider } from '../design/scale';
import { ShapeEdgeFilter } from '../design/shape-edge';
import { z } from '../design/styles';
import { EDGE_VIGNETTE, FOCUS_HALO, FOCUS_RING, FOCUS_RING_FIELD, VIGNETTE_DEPTH } from '../design/tokens';
import { useRootCssVars } from '../primitives/use-root-css-vars';
import { RestoreShelf } from './bars/generate/RestoreShelf';
import { terrainSurface } from './bars/terrain-cells';
import { DockedAssistant } from './dock/DockedAssistant';
import { useDockPlanes } from './dock/use-dock-planes';
import { CharacterHost, useAssistantConnected, Windows } from './edition-surfaces';
import { sessionModeArt } from './frame';
import { CornerActions } from './controls/CornerActions';
import { ModeBar } from './controls/ModeBar';
import { AssistantBlock, ENTRANCE_CHAR_W, ModeRow, useChromeSwap } from './controls/ModeRow';
import { FrameLayoutProvider } from './frame-layout';
import { PlanetNameplate } from './planet/PlanetNameplate';
import { RepairPlate, useRepairLive } from './planet/RepairPlate';
import { Rail } from './Rail';
import { tourDiagram } from './tour/diagrams/tour-diagrams';
import { useDockDriver } from './use-dock';
import { useEditorShortcuts } from './use-editor-shortcuts';
import { useRestoreOffer } from './use-restore-offer';
import { ShellCommandsContext, useShellCommands } from './use-shell-commands';
import { useShellTour } from './tour/use-shell-tour';
import { SCALE } from './units';
import { MenuSheet } from './controls/MenuSheet';

/** The focus ring's tokens as the custom properties `animations.css` draws it with, on the document so windows outside the frame read them. */
const FOCUS_VARS = { '--focus-ring': FOCUS_RING, '--focus-halo': FOCUS_HALO, '--focus-ring-field': FOCUS_RING_FIELD } as const;

/** The assistant's open flag, flipped by her block and by her own layer. */
const toggleAssistant = () => {
  const store = useEditorStore.getState();
  store.setAssistantOpen(!store.assistantOpen);
};

function Frame({ onRestoreSession, splashActive, hidden, onHide, entranceRef }: {
  onRestoreSession: (save: RestoredAutosave) => void;
  /** The character's seat, measured by her layer outside this frame's zoom. */
  entranceRef: RefObject<HTMLDivElement>;
  /** The boot splash still covers the frame, so the restore offer's countdown waits. */
  splashActive: boolean;
  /** The interface is put away; only the button that hid it stands. */
  hidden: boolean;
  onHide: () => void;
}) {
  const preview = useUiPreview();
  const pose = useUiPreviewPose();
  const liveMode = useEditorStore((s) => s.editMode.mode);
  // A picture holds the mode its figure poses, whatever the live editor is doing.
  const mode = preview ? (pose?.mode ?? null) : liveMode;
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
  const planetSession = useEditorStore((s) => s.planetSession);
  const inSession = planetSession !== null;
  // A hand repair hands the row over too, with no modes in it: only its objects take presses.
  const repairing = useRepairLive();
  const repairAsked = useEditorStore((s) => s.repairSession !== null);
  const modes = sessionModeArt(planetSession, repairing);
  const swap = useChromeSwap();
  // The sheet belongs to the menu button and its rows differ across a session, so hiding or a session change puts it away.
  const menuKey = `${hidden}:${inSession}:${repairing}`;
  const [menu, setMenu] = useState({ key: menuKey, open: false });
  const menuOpen = menu.open && menu.key === menuKey;
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu({ key: menuKey, open: false }), [menuKey]);
  const toggleMenu = useCallback(() => setMenu((m) => ({ key: menuKey, open: !(m.open && m.key === menuKey) })), [menuKey]);
  // The editor's one keyboard surface; it also publishes the held modifiers the pointer reads.
  const commands = useShellCommands({ toggleMenu });
  useEditorShortcuts(commands);
  // A mode, the menu, any window but What's new, or the assistant withdraws the restore offer.
  const anyWindowOpen = useEditorStore((s) => anyModalOpen(s, 'whatsNew'));
  const whatsNewOpen = useEditorStore((s) => s.modals.whatsNew);
  const restore = useRestoreOffer(menuOpen || mode !== null || assistantOpen || anyWindowOpen);

  return (
    <ShellCommandsContext.Provider value={commands}>
      {/*
        Hiding the interface takes away everything the frame draws but the button that hid it; the
        conversations outside the frame (windows, toasts, the tour) and the dev-build notice stay.
        `visibility` keeps every surface as it was left and leaves fixed children on the window; the
        veil stands at its clusters' rung, since its fade makes a stacking context.
      */}
      <div
        data-testid="shell-frame-veil"
        style={{
          opacity: hidden ? 0 : 1, visibility: hidden ? 'hidden' : 'visible',
          transition: cssMotion(hidden ? 'frame.veil' : 'frame.unveil', ['opacity', 'visibility']),
          position: 'relative', zIndex: z.panel,
        }}
      >
        {/* One row per set of modes, so a planet session hands the row over the way a mode switch hands over the bar. */}
        <AnimatePresence initial={false}>
          <ModeRow key={inSession ? 'planet' : repairing ? 'repair' : 'map'} modes={modes} mode={mode} swap={swap}
            onPick={(id) => setEditMode({ mode: mode === id ? null : id })} />
        </AnimatePresence>
        {SUPPORTS_ASSISTANT && (
          <AnimatePresence initial={false}>
            {!inSession && !repairing && <AssistantBlock key="assistant" entranceRef={entranceRef} onToggle={toggleAssistant} />}
          </AnimatePresence>
        )}
        <AnimatePresence initial={false}>
          <CornerActions key={inSession || repairing ? 'planet-corner' : 'corner-actions'} inSession={inSession || repairing} swap={swap}
            menuOpen={menuOpen} toggleMenu={toggleMenu} menuButton={menuButton} />
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {inSession && <PlanetNameplate key="planet-nameplate" motionProps={swap} />}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {repairing && <RepairPlate key="repair-plate" motionProps={swap} />}
        </AnimatePresence>
        <ModeBar mode={mode} surface={terrainSurface(mode)} />
        {/* The restore offer stands in the shelf band no mode fills, and gives way to the assistant's panel. */}
        <AnimatePresence>
          {restore.offer && !assistantOpen && !preview && !whatsNewOpen && !inSession && !repairAsked && (
            <RestoreShelf
              key="restore"
              state={restore.offer.state}
              splashActive={splashActive}
              onRestore={() => { onRestoreSession(restore.offer!); restore.take(); }}
              onDismiss={restore.dismiss}
            />
          )}
        </AnimatePresence>
      </div>
      {/* Choosing another mode is the user moving on, so it mounts a failed rail afresh too. */}
      <SurfaceBoundary name="rail" resetKey={mode}>
        <Rail hidden={hidden} onHide={onHide} />
      </SurfaceBoundary>
      {/* A sibling of the rail rather than inside the veil, whose stacking context would scope the sheet's rung under the rail. */}
      <MenuSheet open={menuOpen} onDismiss={closeMenu} trigger={menuButton} />
    </ShellCommandsContext.Provider>
  );
}

/** The windows behind one boundary: any window opening or closing mounts a failed host afresh. */
function WindowsHost() {
  const modals = useEditorStore((s) => s.modals);
  return <SurfaceBoundary name="windows host" resetKey={modals}><Windows /></SurfaceBoundary>;
}

interface ShellProps {
  children: ReactNode;
  /** Resume the offered autosave; the sequencing behind it is the edition root's. */
  onRestoreSession: (save: RestoredAutosave) => void;
  /** The boot splash still covers the app. */
  splashActive?: boolean;
}

export function Shell({ children, onRestoreSession, splashActive = false }: ShellProps) {
  const preview = useUiPreview();
  const mode = useEditorStore((s) => s.editMode.mode);
  const portraitBlocked = useEditorStore((s) => s.portraitBlocked);
  // The vignette slides on the bottom bar's own clock, arriving or leaving with it.
  const shade = useBeat('mode.switch', mode === null ? 'vignette.leaving' : 'vignette.arriving');
  // A browser holding an autosave has used the editor before; a picture never opens the first-launch tour.
  const [hadSave] = useState(hasAutosave);
  useFirstLaunchTour(portraitBlocked, hadSave || preview);
  const inSession = useEditorStore((s) => s.planetSession !== null || s.repairSession?.phase === 'hand');
  // Session-only and keyed to the session: a planet session or a hand repair keeps the interface up.
  const [hide, setHide] = useState({ on: false, session: inSession });
  const hidden = hide.on && hide.session === inSession;
  const toggleHidden = useCallback(() => setHide((h) => ({ on: !(h.on && h.session === inSession), session: inSession })), [inSession]);
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
  const connected = useAssistantConnected();
  const entranceRef = useRef<HTMLDivElement>(null);
  const openAssistant = useCallback(() => useEditorStore.getState().setAssistantOpen(true), []);
  // Decoration: under reduced motion the frame is simply there.
  const arriving = useMotionAllowed('frame.arrive');
  const arrive = useTransition('frame.arrive');
  useDockDriver();
  const planes = useDockPlanes();
  useRootCssVars(FOCUS_VARS);
  useFocusSource();
  const tour = useShellTour();

  return (
    <>
      {/* The docked panel stays outside the sliding frame plane; a picture mounts none. */}
      {!preview && SUPPORTS_ASSISTANT && <DockedAssistant hidden={hidden} />}
      <div ref={planes.mapRef} data-testid="shell-map-plane" style={planes.mapStyle}>{children}</div>
      {/*
        The screen's one shading darkens the map toward the bottom edge where a shelf meets it, and
        hangs off screen with no mode chosen. It travels by `y` on the bar's clock, never a resize.
      */}
      <motion.div
        ref={planes.vignetteRef}
        aria-hidden
        data-testid="shell-vignette"
        style={{
          position: 'fixed', top: 0, left: planes.dockLeft, right: planes.dockRight, bottom: 0, pointerEvents: 'none',
          zIndex: z.canvasControls, background: EDGE_VIGNETTE,
        }}
        initial={false}
        animate={{ y: mode === null || hidden ? VIGNETTE_DEPTH : 0 }}
        transition={shade}
      />
      <ShapeEdgeFilter />
      {/* The frame arrives with the 3D fly-in, by opacity only: a transform would pull its fixed clusters off the window. */}
      <motion.div ref={planes.frameRef} style={planes.frameStyle} initial={arriving ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={arrive}>
        <ScaleProvider value={SCALE}>
          <FrameLayoutProvider>
            <Frame onRestoreSession={onRestoreSession} splashActive={splashActive} hidden={hidden} onHide={toggleHidden} entranceRef={entranceRef} />
          </FrameLayoutProvider>
        </ScaleProvider>
      </motion.div>
      {/* The one character stands outside the frame's zoom: she places herself from rects she measures. */}
      {!preview && SUPPORTS_ASSISTANT && (
        <CharacterHost
          entranceRef={entranceRef}
          open={assistantOpen}
          connected={connected}
          hidden={hidden || inSession}
          size={ENTRANCE_CHAR_W}
          onOpen={openAssistant}
          // She is the toggle in both states: once open, the panel covers her block, so her own layer takes the press.
          onToggle={toggleAssistant}
        />
      )}
      {/* The acting surfaces stay with the live shell: a picture has no windows to open and no tour to run. */}
      {!preview && <WindowsHost />}
      {!preview && !inSession && <TourOverlay steps={tour.steps} onStepEnter={tour.onStepEnter} diagram={tourDiagram} />}
      {!preview && !inSession && <TourDoneModal />}
    </>
  );
}
