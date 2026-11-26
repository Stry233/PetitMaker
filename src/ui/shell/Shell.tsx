/*
 * The application shell around the map: the mode row, the assistant's block, the corner actions,
 * the active mode's bottom surface and the rail, under one combined page and UI zoom. The armed mode
 * drives the bottom surface; the assistant opens on its own. The shell also runs the tour.
 */
import { memo, useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { SUPPORTS_ASSISTANT } from '../../platform/build/edition';
import { useEditorStore } from '../../state/store';
import { restoreOfferShown, shellEngagedIn } from '../../state/greetings';
import { blueprintSaving, explorerUnfolded } from '../../state/slices/blueprint';
import { interfaceHidden } from '../../state/slices/shell';
import { SurfaceBoundary } from '../chrome/guards/SurfaceBoundary';
import { useExportNotice } from '../chrome/modals/export/review/ExportNotice';
import { Tour } from '../chrome/tour/Tour';
import { useFocusSource } from '../design/focus-source';
import { cssMotion, seconds } from '../design/motion';
import { useBeat, useMotionAllowed, useTransition } from '../design/motion/use-motion';
import { useUiPreview, useUiPreviewPose } from '../design/preview';
import { ScaleProvider, SurfaceZoomProvider } from '../design/scale';
import { useFrameZoom } from './use-frame-zoom';
import { ShapeEdgeFilter } from '../design/shape-edge';
import { z } from '../design/styles';
import { EDGE_VIGNETTE, FOCUS_HALO, FOCUS_RING, FOCUS_RING_FIELD, PLATE, VIGNETTE_DEPTH } from '../design/tokens';
import { useRootCssVars } from '../primitives/use-root-css-vars';
import { AwayOwner, useAway } from '../primitives/away';
import { useTransient } from '../primitives/use-transient';
import { RestoreShelf } from './bars/generate/RestoreShelf';
import { terrainSurface } from './bars/terrain-cells';
import { DockedAssistant } from './dock/DockedAssistant';
import { useDockPlanes } from './dock/use-dock-planes';
import { CharacterHost, loadHelpFactsAbove, useAssistantConnected, Windows } from './edition-surfaces';
import { sessionModeArt } from './frame';
import { CornerActions } from './controls/CornerActions';
import { ModeBar } from './controls/ModeBar';
import { AssistantBlock, ENTRANCE_CHAR_W, ModeRow, useChromeSwap } from './controls/ModeRow';
import { FrameLayoutProvider, useFrameLayout } from './frame-layout';
import { MapLayer } from './map-layer';
import { useLayoutShape } from '../design/input-mode';
import { UPRIGHT_EDGE_LEFT_VAR, UPRIGHT_EDGE_RIGHT_VAR, UPRIGHT_TOP_VAR, WIDE_SECOND_ROW_VAR } from '../chrome/floating/toast-band';
import { PlanetNameplate } from './planet/PlanetNameplate';
import { RepairPlate } from './planet/RepairPlate';
import { useFramePose } from '../session/use-frame-pose';
import { Rail } from './Rail';
import { useDockDriver } from './use-dock';
import { useEditorShortcuts } from './use-editor-shortcuts';
import { useRestoreOffer } from './use-restore-offer';
import { useShellEngagedSource } from '../session/engagement';
import { ShellCommandsContext, useShellCommands } from './use-shell-commands';
import { SCALE, ZOOM } from './units';
import { MenuSheet } from './controls/MenuSheet';
import { ChromeMorph } from './ChromeMorph';
import { pressCommand } from '../../editor/commands/run';

/** The focus ring's tokens as the custom properties `animations.css` draws it with, on the document so windows outside the frame read them. */
const FOCUS_VARS = { '--focus-ring': FOCUS_RING, '--focus-halo': FOCUS_HALO, '--focus-ring-field': FOCUS_RING_FIELD } as const;

/** The assistant's open flag, flipped by her block and by her own layer. */
const toggleAssistant = () => pressCommand('app.assistant', { on: !useEditorStore.getState().assistantOpen });

/** Memoised: the planes' per-render styles re-render `Shell`, and none of them reach the frame's tree. */
const Frame = memo(function Frame({ splashActive, hidden, onHide, entranceRef, overColumn }: {
  /** The character's seat, measured by her layer outside this frame's zoom. */
  entranceRef: RefObject<HTMLDivElement>;
  /** The boot splash still covers the frame, so the restore offer's countdown waits. */
  splashActive: boolean;
  /** The interface is put away; only the button that hid it stands. */
  hidden: boolean;
  onHide: () => void;
  /** The blueprint library unfolded window wide covers the column and the character's seat, as a
   *  tall upright panel does (`useLibraryOverColumn`). */
  overColumn: boolean;
}) {
  const preview = useUiPreview();
  const pose = useUiPreviewPose();
  const liveMode = useEditorStore((s) => s.editMode.mode);
  // A picture holds the mode its figure poses, whatever the live editor is doing.
  const mode = preview ? (pose?.mode ?? null) : liveMode;
  const planetSession = useEditorStore((s) => s.planetSession);
  // A hand repair hands the row over too, with no modes in it: only its objects take presses.
  const sessionPose = useFramePose();
  const modes = sessionModeArt(planetSession, sessionPose === 'repair');
  const multiSelecting = useEditorStore((s) => s.multiSelectLatched);
  const liveSaving = useEditorStore((s) => blueprintSaving(s.blueprintStep));
  // A picture stands the save step where its pose says, raised over the rail as the live one is.
  const saving = preview ? pose?.blueprintSave === true && mode === 'blueprint' : liveSaving;
  const swap = useChromeSwap();
  const upright = useLayoutShape() === 'portrait';
  // The sheet belongs to the menu button and its rows differ across a session, so hiding or a session change puts it away.
  const menuKey = `${hidden}:${sessionPose}`;
  const [menu, setMenu] = useState({ key: menuKey, open: false });
  const menuOpen = menu.open && menu.key === menuKey;
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setMenu({ key: menuKey, open: false }), [menuKey]);
  const toggleMenu = useCallback(() => setMenu((m) => ({ key: menuKey, open: !(m.open && m.key === menuKey) })), [menuKey]);
  // The editor's one keyboard surface; it also publishes the held modifiers the pointer reads.
  // The notice an export asks when no surface of its own shows one, as the assistant's does; a picture shows none.
  const exportNotice = useExportNotice(!preview, 0, null);
  const commands = useShellCommands({ toggleMenu, exportNotice: preview ? null : exportNotice.request, pictured: preview, helpFactsAbove: loadHelpFactsAbove });
  useEditorShortcuts(commands);
  const veiled = useAway(hidden);

  return (
    <ShellCommandsContext.Provider value={commands}>
      <BandVars />
      <MapLayer hidden={hidden}>
        {/*
          Hiding the interface takes away everything the frame draws but the button that hid it; the
          conversations outside the frame (windows, toasts, the tour) and the dev-build notice stay.
          `visibility` keeps every surface as it was left and leaves fixed children on the window; the
          veil stands at its clusters' rung, since its fade makes a stacking context; upright, with the
          blueprint library unfolded or with its save dock standing, over the right-hand column, which a tall bar panel covers.
        */}
        <div
          data-testid="shell-frame-veil"
          {...veiled}
          style={{
            opacity: hidden ? 0 : 1, visibility: hidden ? 'hidden' : undefined,
            transition: cssMotion(hidden ? 'frame.veil' : 'frame.unveil', ['opacity', 'visibility']),
            position: 'relative', zIndex: upright || overColumn || saving ? z.uprightBar : z.panel,
          }}
        >
          {/* What the frame portals out of the veil (menus, questions) goes away with it. */}
          <AwayOwner away={hidden}>
            {/* One row per set of modes, so a planet session hands the row over the way a mode switch hands over the bar. */}
            <AnimatePresence initial={false}>
              <ModeRow key={sessionPose} modes={modes} mode={mode} swap={swap} dimmed={multiSelecting}
                onPick={(id) => pressCommand('mode.set', { mode: mode === id || id === null ? 'none' : id }, commands)} />
            </AnimatePresence>
            {SUPPORTS_ASSISTANT && (
              <AnimatePresence initial={false}>
                {sessionPose === 'map' && <AssistantBlock key="assistant" entranceRef={entranceRef} onToggle={toggleAssistant} />}
              </AnimatePresence>
            )}
            <AnimatePresence initial={false}>
              <CornerActions key={sessionPose === 'map' ? 'corner-actions' : 'planet-corner'} pose={sessionPose} swap={swap}
                menuOpen={menuOpen} toggleMenu={toggleMenu} menuButton={menuButton} />
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {sessionPose === 'planet' && <PlanetNameplate key="planet-nameplate" motionProps={swap} />}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {sessionPose === 'repair' && <RepairPlate key="repair-plate" motionProps={swap} />}
            </AnimatePresence>
            <ModeBar mode={mode} surface={terrainSurface(mode)} />
            <RestoreOffer busy={menuOpen || mode !== null} inSession={sessionPose === 'planet'} splashActive={splashActive} />
          </AwayOwner>
        </div>
        {/* Choosing another mode is the user moving on, so it mounts a failed rail afresh too. */}
        <SurfaceBoundary name="rail" resetKey={mode}>
          <Rail hidden={hidden} onHide={onHide} />
        </SurfaceBoundary>
        {/* A sibling of the rail rather than inside the veil, whose stacking context would scope the sheet's rung under the rail. */}
        <MenuSheet open={menuOpen} onDismiss={closeMenu} trigger={menuButton} />
      </MapLayer>
      {exportNotice.notice}
    </ShellCommandsContext.Provider>
  );
});

/**
 * The restore offer stands in the shelf band no mode fills, and gives way to the assistant's panel. A
 * mode, the menu, any window but What's new, or the assistant withdraws it; the tour holds it back
 * until the run ends, and nothing its Show me opens withdraws it. Its own component, so a
 * window opening or closing re-renders it and not the frame.
 */
function RestoreOffer({ busy, inSession, splashActive }: {
  /** A mode or the menu is open. */
  busy: boolean;
  inSession: boolean;
  splashActive: boolean;
}) {
  const preview = useUiPreview();
  const shown = useEditorStore((s) => restoreOfferShown(s, { inSession }));
  const engaged = useEditorStore((s) => shellEngagedIn(s, busy));
  useShellEngagedSource(preview ? null : engaged);
  const offer = useRestoreOffer(!preview);
  return (
    <AnimatePresence>
      {offer && shown && !preview && <RestoreShelf key="restore" state={offer.state} splashActive={splashActive} />}
    </AnimatePresence>
  );
}

/**
 * The chrome's band tenants that span an upright window keep the frame's side margin and stand under
 * its top row, where the plan opens the assistant's panel; on a wide window the greeting stands level
 * with the second row: published in chrome px, `units.ts:ZOOM` per
 * frame px at every scale, so they move with the frame through a UI-zoom glide without re-rendering.
 */
function BandVars() {
  const layout = useFrameLayout();
  const upright = layout?.shape === 'portrait';
  const toChrome = (px: number) => `${px * ZOOM}px`;
  useRootCssVars(!layout ? {} : upright
    ? {
      [UPRIGHT_EDGE_LEFT_VAR]: toChrome(layout.edgeLeft), [UPRIGHT_EDGE_RIGHT_VAR]: toChrome(layout.edgeRight),
      [UPRIGHT_TOP_VAR]: toChrome(layout.panel.top),
    }
    : { [WIDE_SECOND_ROW_VAR]: toChrome(layout.railTop) });
  return null;
}

/** The windows behind one boundary: any window opening or closing mounts a failed host afresh.
 *  Memoised: it takes no props, and a render of the shell around it (a resize, a dock move) would
 *  otherwise re-render every closed window. */
const WindowsHost = memo(function WindowsHost() {
  const modals = useEditorStore((s) => s.modals);
  return <SurfaceBoundary name="windows host" resetKey={modals}><Windows /></SurfaceBoundary>;
});

interface ShellProps {
  children: ReactNode;
  /** The boot splash still covers the app. */
  splashActive?: boolean;
}

/**
 * The screen's one shading darkens the map toward the bottom edge where a shelf meets it, and hangs off
 * screen with no mode chosen. It travels by `y` on the bar's clock, never a resize, and its clip keeps
 * what hangs below its own foot off a bottom dock. Its own component, so a change of mode re-renders
 * only it, not the shell around the planes.
 */
function ShellVignette({ vignetteRef, hidden, left, right, bottom }: {
  vignetteRef: RefObject<HTMLDivElement>; hidden: boolean; left: number; right: number; bottom: number;
}) {
  const mode = useEditorStore((s) => s.editMode.mode);
  // The vignette slides on the bottom bar's own clock, arriving or leaving with it.
  const shade = useBeat('mode.switch', mode === null ? 'vignette.leaving' : 'vignette.arriving');
  const away = mode === null || hidden;
  return (
    <motion.div
      ref={vignetteRef}
      aria-hidden
      data-testid="shell-vignette"
      style={{ position: 'fixed', top: 0, left, right, bottom, pointerEvents: 'none', zIndex: z.canvasControls, background: EDGE_VIGNETTE }}
      initial={false}
      animate={{ y: away ? VIGNETTE_DEPTH : 0, clipPath: bottom > 0 ? `inset(0px 0px ${away ? VIGNETTE_DEPTH : 0}px 0px)` : 'none' }}
      transition={shade}
    />
  );
}

/**
 * Whether the blueprint library unfolded across a wide window stands over the right-hand column and
 * the character's seat, so both stand under its band: from the unfold, and on a fold until the band
 * has travelled back down.
 */
function useLibraryOverColumn(): boolean {
  const wide = useLayoutShape() === 'landscape';
  const pose = useUiPreviewPose();
  const live = useEditorStore((s) => s.editMode.mode === 'blueprint' && explorerUnfolded(s.blueprintStep));
  // A picture covers the column only with the explorer its figure poses.
  const covers = (pose ? pose.mode === 'blueprint' && !!pose.blueprintExplorer : live) && wide;
  const reduced = useReducedMotionConfig() === true;
  return useTransient<true>(reduced ? 0 : seconds('blueprint.library.unfold') * 1000, { linger: covers || null }).value !== null;
}

export function Shell({ children, splashActive = false }: ShellProps) {
  const preview = useUiPreview();
  const sessionFrame = useFramePose() !== 'map';
  // Every way of hiding passes here; the store refuses while the interface may not be hidden.
  const hidden = useEditorStore(interfaceHidden);
  const toggleHidden = useCallback(() => pressCommand('view.interface_hidden', { on: !interfaceHidden(useEditorStore.getState()) }), []);
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
  const overColumn = useLibraryOverColumn();
  const connected = useAssistantConnected();
  const entranceRef = useRef<HTMLDivElement>(null);
  const openAssistant = useCallback(() => pressCommand('app.assistant', { on: true }), []);
  const closeAssistant = useCallback(() => pressCommand('app.assistant', { on: false }), []);
  // Decoration: under reduced motion the frame is simply there.
  const arriving = useMotionAllowed('frame.arrive');
  const arrive = useTransition('frame.arrive');
  useDockDriver();
  const planes = useDockPlanes();
  const frameZoom = useFrameZoom();
  useRootCssVars(FOCUS_VARS);
  useFocusSource();

  return (
    <ChromeMorph>
      {/* The docked panel stays outside the sliding frame plane; a picture mounts none. Under a bottom
          dock its plate stands from the moment the dock opens, so a turn that carries the panel in from
          its free place never shows the foot of the window empty. */}
      {!preview && SUPPORTS_ASSISTANT && assistantOpen && !hidden && planes.dockBottom > 0
        ? <div ref={planes.plateRef} aria-hidden style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: planes.dockBottom, zIndex: z.ground, background: PLATE, pointerEvents: 'none' }} />
        : null}
      {!preview && SUPPORTS_ASSISTANT && <DockedAssistant hidden={hidden} onClose={closeAssistant} />}
      <div ref={planes.mapRef} data-testid="shell-map-plane" style={planes.mapStyle}>{children}</div>
      <ShellVignette vignetteRef={planes.vignetteRef} hidden={hidden} left={planes.dockLeft} right={planes.dockRight} bottom={planes.dockBottom} />
      <ShapeEdgeFilter />
      {/* The frame arrives with the 3D fly-in, by opacity only: a transform would pull its fixed clusters off the window. */}
      <motion.div ref={planes.frameRef} data-testid="shell-frame-plane" style={planes.frameStyle} initial={arriving ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={arrive}>
        <ScaleProvider value={SCALE}>
          <SurfaceZoomProvider value={frameZoom}>
            <FrameLayoutProvider>
              <Frame splashActive={splashActive} hidden={hidden} onHide={toggleHidden} entranceRef={entranceRef}
                overColumn={overColumn} />
            </FrameLayoutProvider>
          </SurfaceZoomProvider>
        </ScaleProvider>
      </motion.div>
      {/* The one character stands outside the frame's zoom: she places herself from rects she measures. */}
      {!preview && SUPPORTS_ASSISTANT && (
        <CharacterHost
          entranceRef={entranceRef}
          open={assistantOpen}
          connected={connected}
          hidden={hidden || sessionFrame}
          size={ENTRANCE_CHAR_W}
          covered={overColumn}
          onOpen={openAssistant}
          // She is the toggle in both states: once open, the panel covers her block, so her own layer takes the press.
          onToggle={toggleAssistant}
        />
      )}
      {/* The acting surfaces stay with the live shell: a picture has no windows to open and no tour to run. */}
      {!preview && <WindowsHost />}
      {!preview && !sessionFrame && <Tour />}
    </ChromeMorph>
  );
}
