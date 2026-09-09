/*
 * Application shell around the map. Edit state drives the five mutually exclusive mode bars; the
 * assistant opens independently without changing the armed mode. Chrome uses fixed CSS dimensions
 * under one combined page/UI zoom. This component also hosts the tour and applies its requested mode
 * and view changes.
 */
import { useFrameReadableWeight } from './use-frame-zoom';
import {
  Suspense, lazy, useCallback, useEffect, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import type { BuildMode } from '../../core/model/edit-mode';
import { useAgentSession } from '../../agent/session/store';
import { hasAutosave, readRestorableAutosave, type RestoredAutosave } from '../../io/autosave';
import { offerRestoreDismiss } from '../../core/runtime/restore-offer';
import { useT } from '../../i18n/context';
import { useEditorStore, type ViewMode } from '../../state/store';
import { TourDoneModal } from '../chrome/tour/TourDoneModal';
import { TourOverlay } from '../chrome/tour/TourOverlay';
import { tourTargetAttr, type TourStep, type TourTargetId } from '../chrome/tour/steps';
import { helpTargetAttr } from '../chrome/modals/help/targets';
import type { HelpPageId } from '../chrome/modals/help/page-schema';
import { useFirstLaunchTour } from '../chrome/tour/use-tour';
import { useUiPreview, useUiPreviewPose } from '../primitives/ui-preview';
import { useEditorShortcuts } from './use-editor-shortcuts';
import { useRegionBrush } from './use-region-brush';
import { ScaleProvider, useDenseScript, useDevicePixelRatio, useViewportSize } from '../design/scale';
import { useAnimatedUiZoom } from '../design/ui-zoom-anim';
import { weightVars } from '../design/text-weight';
import { useFocusSource } from '../design/focus-source';
import { btnReset, cursors, font, pressable, z } from '../design/styles';
import { CharacterHost } from '../agent/character/CharacterHost';
import { CHARACTER_SEAT, PINNED_COLUMN_W, PINNED_DOCK_REF_W, frameZoomAt } from './panel-frame';
import { dockAside, useDockDriver, useDockStage } from './use-dock';
import { isConnected, useAgentPanelSettings } from '../agent/settings';
import { GenerateShelf } from './bars/GenerateShelf';
import { AnnotationBar } from './bars/AnnotationBar';
import { ObjectShelf } from './bars/ObjectShelf';
import { TerrainBar } from './bars/TerrainBar';
import { terrainSurface, type TerrainSurface } from './bars/terrain-cells';
import {
  ASSISTANT_BLOCK, ASSISTANT_INK, ASSISTANT_ROW_TOP, MODES, MODE_PLATE, MODE_PLATE_ID, MODE_ROW_LEFT,
  MODE_ROW_TOP, TOP_RIGHT, TOP_RIGHT_TOP, blockCentre, topRightHeight, topRightSlack,
  type BlockArt, type FrameArt,
} from './frame';
import { LoadMeter } from './windows/LoadMeter';
import { MenuSheet } from './windows/MenuSheet';
import { cssMotion, useBeat, useMotion, useMotionAllowed } from './motion/use-motion';
import { Rail } from './Rail';
import { FrameLayoutProvider, useFrameLayout } from './frame-layout';
import { RestoreShelf } from './bars/RestoreShelf';
import { BarText } from './bars/bar-atoms';
import { ACTIVE, EDGE_VIGNETTE, FOCUS_HALO, FOCUS_RING, FOCUS_RING_FIELD, FOCUS_SHAPE_RADIUS, INK, MAP_EDGE_ALPHA, MAP_LABEL, SHAPE_EDGE_FILTER, SHAPE_EDGE_ID, VIGNETTE_DEPTH, mapShape } from '../design/tokens';
import { ShapeEdge } from '../design/shape-edge';
import {
  captionShift, EDGE_RIGHT, MODE, MODE_SCALE, SCALE, TEXT, TOP_RIGHT_GAP, ZOOM,
} from './units';
import { SHELL_TOUR_STEPS } from './tour-steps';
import { tourDiagram } from './tour-diagrams';
import { useShellCommands } from './use-shell-commands';
import { Windows } from './windows/Windows';

/** Which top-right control a tour step points at. Only the two that DO something are named: the
 *  load readout is a readout. */
const TOP_RIGHT_TOUR: Partial<Record<string, TourTargetId>> = { share: 'share', menu: 'menu' };
/** The help page each top-right button teaches; the load disc marks its own. */
const TOP_RIGHT_HELP: Partial<Record<string, HelpPageId>> = { share: 'share', menu: 'frame' };
/** The help page each mode block teaches: the three terrain surfaces share one page. */
const MODE_HELP: Record<string, HelpPageId> = { object: 'objects', road: 'terrain', mountain: 'terrain', water: 'terrain', generate: 'generate' };

/** The corner a top-right control's focus ring takes, for a drawing that is not the rounded
 *  rectangle `FOCUS_SHAPE_RADIUS` assumes: the menu is a disc, and the load meter draws itself. */
const TOP_RIGHT_RADIUS: Partial<Record<string, number>> = { menu: 999 };

/**
 * Call `onEdit` the first time the visitor's own work reaches the map, while `armed`.
 *
 * It watches the UNDO STACK rather than the change events themselves: opening a map emits those too
 * (and a generate emits thousands), so an offer keyed on the events alone would be gone before it
 * was read. A stack that has grown is an edit someone made.
 */
function useFirstEdit(armed: boolean, onEdit: () => void): void {
  const eventBus = useEditorStore((s) => s.eventBus);
  const executor = useEditorStore((s) => s.commandExecutor);
  useEffect(() => {
    if (!armed || !eventBus || !executor) return undefined;
    const base = executor.getUndoStackSize();
    const check = () => { if (executor.getUndoStackSize() > base) onEdit(); };
    eventBus.on('cells-changed', check);
    eventBus.on('objects-changed', check);
    return () => {
      eventBus.off('cells-changed', check);
      eventBus.off('objects-changed', check);
    };
  }, [armed, eventBus, executor, onEdit]);
}


/**
 * The one definition of the edge every drawing on the map wears, mounted once for the whole shell.
 *
 * A CSS filter cannot express a dilation, so the edge is an SVG one and every consumer reaches it
 * through `tokens.ts:MAP_SHAPE_EDGE`, which is a reference to this id. It lives here rather than
 * beside a consumer because a `url(#...)` filter resolves against the DOCUMENT: one def, any number
 * of users, and nothing breaks when a user unmounts.
 *
 * `sRGB` interpolation because the default, linearRGB, would lighten the ink; a filter region wider
 * than the default -10%/120% because that default would clip the very edge this draws.
 */
function ShapeEdgeFilter() {
  const { blur, slope } = SHAPE_EDGE_FILTER;
  return (
    <svg aria-hidden width="0" height="0" style={{ position: 'absolute' }}>
      <filter
        id={SHAPE_EDGE_ID}
        x="-25%" y="-25%" width="150%" height="150%"
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur in="SourceAlpha" stdDeviation={blur} result="spread" />
        <feComponentTransfer in="spread" result="grown">
          <feFuncA type="linear" slope={slope} intercept="0" />
        </feComponentTransfer>
        {/* The alpha rides the FLOOD. Composited into a grown alpha that the ramp has already
            pushed to solid, so the ink's own opacity is the only thing left that can lighten the
            edge without softening its boundary back into a gradient. */}
        <feFlood floodColor={INK} floodOpacity={MAP_EDGE_ALPHA} result="ink" />
        <feComposite in="ink" in2="grown" operator="in" result="edge" />
        <feMerge>
          <feMergeNode in="edge" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </svg>
  );
}

/**
 * One drawn control of the top-right cluster: save-and-share, and the menu.
 *
 * Each is drawn at ITS OWN height, the one that puts its ink at the size a rail button reads
 * (`frame.ts:topRightHeight`). One shared box height makes three sizes out of three drawings — a
 * filled circle and a shape that is mostly a notch do not read alike at one height.
 *
 * The drawing is used as a SHAPE, not as a picture: the file gives the silhouette and the frame
 * gives it the column's cream and the hairline edge every drawing standing on the map wears
 * (`tokens.ts:mapShape` / `shape-edge.tsx:ShapeEdge`), which is why the masked span stands inside
 * the edge's own box.
 */
function Piece({ art, onPress, expanded, tourTarget, helpTarget }: {
  art: FrameArt & { src: string };
  onPress?: () => void;
  expanded?: boolean;
  tourTarget?: TourTargetId;
  helpTarget?: HelpPageId;
}) {
  const t = useT();
  const h = topRightHeight(art);
  const box: CSSProperties = { height: h, width: (art.w / art.h) * h, flex: 'none' };
  // Whatever slack the drawing carries under its own ink hangs BELOW the row's line, so the three
  // stand on that line by their ink and not by their boxes.
  const line: CSSProperties = { ...box, marginBottom: -topRightSlack(art) };
  const shape = (
    <ShapeEdge style={box}>
      <span style={{ ...mapShape(art.src), display: 'block', width: '100%', height: '100%' }} />
    </ShapeEdge>
  );
  if (!onPress) return <span role="img" aria-label={t(art.labelKey)} style={line}>{shape}</span>;
  return (
    <motion.button
      type="button"
      {...pressable}
      {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
      {...(helpTarget ? helpTargetAttr(helpTarget) : {})}
      aria-label={t(art.labelKey)}
      aria-expanded={expanded}
      onClick={onPress}
      style={{
        ...btnReset, ...line, cursor: cursors.clickable,
        borderRadius: TOP_RIGHT_RADIUS[art.id] ?? FOCUS_SHAPE_RADIUS,
      }}
    >
      {shape}
    </motion.button>
  );
}

/** The splat, as it lands: wider than the block it stands under and centred on it. */
const PLATE_W = MODE_PLATE.w * MODE_SCALE;

/**
 * The splat under the chosen block, on a layer of the ROW's rather than inside the block.
 *
 * IT IS GROUND, SO IT PASSES BEHIND. Drawn inside a block it would paint in that block's place in
 * the row, which is above every block to its left and below every block to its right: a move to the
 * right would wipe the splat across the drawings it crossed (58 css px a block against 89 the splat,
 * so all but the top of each cube on the way), and a move to the left would hide it behind them.
 * Standing before the buttons in the row's own box it is behind all of them whichever way it goes,
 * which is also what it is a picture of.
 *
 * Positioned by a LENGTH rather than a centring translate: it travels, and Framer owns `transform`
 * on anything it moves, so a `translateX(-50%)` would be clobbered the instant it left (the jump
 * `styles.ts:pressable` warns about).
 */
function BlockPlate({ centre }: {
  /** The centre of the block it belongs under, in css px from the window's left edge. The row starts
   *  at `MODE_ROW_LEFT`, which is what makes this a length inside it. */
  centre: number;
}) {
  const arrive = useBeat('mode.switch', 'plate.arriving');
  const leave = useBeat('mode.switch', 'plate.leaving');
  return (
    <motion.img
      data-testid={MODE_PLATE_ID}
      src={MODE_PLATE.src}
      alt=""
      draggable={false}
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1, transition: arrive }}
      exit={{ opacity: 0, scale: 0.88, transition: leave }}
      style={{
        position: 'absolute', left: centre - MODE_ROW_LEFT - PLATE_W / 2,
        bottom: -MODE_PLATE.drop * MODE_SCALE,
        width: PLATE_W, height: MODE_PLATE.h * MODE_SCALE,
      }}
    />
  );
}

/**
 * One top-left mode or assistant block. Drawings share a bottom baseline and may overflow their
 * slots. Active modes show a map-side caption and toggle back to rest when pressed again. `expanded`
 * gives panel triggers disclosure semantics; ordinary modes use pressed semantics. The row owns the
 * traveling selection plate.
 */
function RowBlock({ art, on, centre, expanded, tourTarget, helpTarget, slot, onPress }: {
  art: BlockArt;
  on: boolean;
  centre: number;
  expanded?: boolean;
  tourTarget?: TourTargetId;
  /** A block that draws something of its own where the row's art would stand, instead of the art.
   *  Only the assistant's does: its picture is the one live character, which stands in a layer of
   *  its own (`agent/character/CharacterHost`) and needs a BOX here rather than a drawing. */
  helpTarget?: HelpPageId;
  slot?: ReactNode;
  /** Called for either half of the toggle: the caller owns what "on" and "off" mean for it. */
  onPress: () => void;
}) {
  const weightAt = useFrameReadableWeight();
  const t = useT();
  const caption = useBeat('mode.switch', 'caption');
  const reduced = useReducedMotionConfig();
  const drawing = on ? art.selected : art;
  const centred: CSSProperties = { position: 'absolute', left: '50%', transform: 'translateX(-50%)' };
  return (
    <motion.button
      type="button"
      {...pressable}
      {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
      {...(helpTarget ? helpTargetAttr(helpTarget) : {})}
      aria-label={t(art.labelKey)}
      {...(expanded === undefined ? { 'aria-pressed': on } : { 'aria-expanded': expanded })}
      onClick={onPress}
      style={{
        ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
        width: MODE.size, height: MODE.height, borderRadius: FOCUS_SHAPE_RADIUS,
        cursor: cursors.clickable,
      }}
    >
      {slot ?? (
        <motion.img
          src={drawing.src}
          alt=""
          draggable={false}
          style={{
            // Centred by Framer's own `x` rather than by a transform string, because a posed drawing
            // writes its own transform and would drop the string the moment it did.
            position: 'absolute', left: '50%', bottom: 0, x: '-50%',
            // It turns and squashes about where it meets the row's baseline, which is where a figure
            // standing on the ground pivots.
            originX: 0.5, originY: 1,
            width: drawing.w * MODE_SCALE, height: drawing.h * MODE_SCALE,
          }}
        />
      )}
      {on ? (
        <motion.span
          // The name does not travel with the splat: it is a different word, so it comes up where
          // the splat lands. Opacity only, because the transform is already spoken for by the
          // caption's own clamp against the window edge.
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={caption}
          style={{
            ...centred, ...MAP_LABEL,
            transform: captionShift(centre), top: `calc(100% + ${MODE.label.gap}px)`,
            fontSize: MODE.label.size, fontWeight: weightAt(MODE.label.weight, MODE.label.size),
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}
        >
          {t(art.labelKey)}
        </motion.span>
      ) : null}
    </motion.button>
  );
}

/** The character's own box inside the assistant block, in css px: her seat, declared by the frame
 *  (`panel-frame.ts:CHARACTER_SEAT`) so the panel's own top-left corner can be anchored to the same
 *  box. The drawing itself is the seat less the pad the placement insets it by. */
const ENTRANCE_CHAR_W = CHARACTER_SEAT.w - CHARACTER_SEAT.pad * 2;
const ENTRANCE_SLOT: CSSProperties = {
  position: 'absolute',
  // A LENGTH, not a centring translate. This box is MEASURED — the character reads its viewport rect
  // and places herself from it — so a transform here or on anything above it moves the rect and the
  // character with it.
  left: '50%',
  marginLeft: -CHARACTER_SEAT.w / 2,
  bottom: -CHARACTER_SEAT.pad,
  width: CHARACTER_SEAT.w,
  height: CHARACTER_SEAT.h,
};

/** The painted region, shown at the character's shoulder: while one stands it is a hard boundary for
 *  every edit the assistant makes, and it has to be readable with the panel shut. */
function RegionBadge() {
  const t = useT();
  const cells = useEditorStore((s) => s.region.length);
  const selecting = useEditorStore((s) => s.selectingRegion);
  // While the marking screen is open the count lives on the screen itself; a second bubble at the
  // shoulder would shadow every stroke of the brush.
  if (cells === 0 || selecting) return null;
  return (
    <div
      data-testid="shell-assistant-region-badge"
      role="status"
      style={{
        position: 'fixed',
        left: ASSISTANT_INK.right - 6,
        top: ASSISTANT_INK.top - 6,
        height: 22,
        padding: '0 9px',
        borderRadius: 999,
        background: ACTIVE,
        display: 'flex',
        alignItems: 'center',
        zIndex: z.panel + 1,
        pointerEvents: 'none',
      }}
    >
      <BarText size={TEXT.small} color={INK} weight={900}>
        {t(cells === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: cells })}
      </BarText>
    </div>
  );
}

/**
 * The second row: the assistant's block, on its own because the character has a state and the five
 * modes do not.
 *
 * IT IS THE CHARACTER'S SEAT, and the block draws no picture of its own: the one live character
 * stands in this box in both states, and the panel unfolds from behind her (`agent/character/`), so
 * what the block contributes is the BOX and a label. Nothing here may take a transform — see
 * `ENTRANCE_SLOT`.
 *
 * THE PRESS IS HERS. Her own layer stands over this block and takes the pointer for her own drawing
 * (`CharacterHost`), which is what keeps one press working in both states: once the panel is open it
 * covers this block, so a press aimed at her would otherwise land on the plate. This button stays
 * standing underneath for the label, the focus ring and the tour's own target — the keyboard's way to
 * the same toggle.
 *
 * AND IT WEARS NO ARMED DRESS, which is the one way this block is not a mode block. A mode block's
 * splat and caption say "this is what the map is armed with", a fact nothing else on screen carries.
 * The panel says its own: while it is open it stands where this box is. So the splat had nothing to
 * add and did not even stay hidden — the panel is narrower than the splat is wide, and a wing of the
 * mode row's selected yellow stood out from under the panel's top corner for as long as the panel was
 * up, reading as a sixth mode nobody had chosen.
 */
function AssistantBlock({ entranceRef }: { entranceRef: RefObject<HTMLDivElement> }) {
  const open = useEditorStore((s) => s.assistantOpen);
  const setOpen = useEditorStore((s) => s.setAssistantOpen);
  // A pictured shell mounts no character layer (it positions itself from measured window rects,
  // which a zoomed picture breaks), so the block draws her still art in the box instead.
  const preview = useUiPreview();
  return (
    // DEAF WHILE THE PANEL IS OPEN, which is the block's own note above made true rather than assumed:
    // the panel stands where this box is and the character in her own layer is the press, so this one
    // has nothing left to answer. It is not enough that the panel COVERS it — the panel's plane and
    // this block share a rung and the frame paints last, so the panel's dock tab (which hangs off the
    // plate's edge, straight across this box) had half of itself answered by the block underneath.
    // The label, the focus ring and the tour target are unaffected: a pointer rule is not a keyboard
    // one, and the badge beside it is already deaf.
    <div style={{
      position: 'fixed', top: ASSISTANT_ROW_TOP, left: MODE_ROW_LEFT, zIndex: z.panel,
      pointerEvents: open ? 'none' : 'auto',
    }}
    >
      <RowBlock
        art={ASSISTANT_BLOCK}
        on={false}
        expanded={open}
        centre={blockCentre(0)}
        tourTarget="assistant"
        helpTarget="agent-setup"
        slot={preview ? undefined : <div ref={entranceRef} data-testid="entrance-plate-anchor" style={ENTRANCE_SLOT} />}
        onPress={() => setOpen(!open)}
      />
      <RegionBadge />
    </div>
  );
}

/**
 * The assistant's panel, and the app's ONE lazy chunk for it: the tool layer and the provider SDKs
 * are behind this import and nowhere the first load can see (`__tests__/ui/eager-bundle.test.ts`).
 *
 * MOUNTED ONCE OPENED, AND THEN KEPT. The column owns the runner, which owns the running job's
 * abort handle; unmounting it with the panel would leave a job nobody can stop and a second one
 * starting over the same log the next time an order is sent (`agent/PanelColumn.tsx`'s header).
 */
const PanelColumn = lazy(() => import('../agent/PanelColumn'));

/**
 * THE PANEL STANDS OUTSIDE THE FRAME'S PLANE, and that is what lets it be the ground.
 *
 * Docked, the panel is the desk the whole interface is lying on: it holds the window's own left edge
 * while the frame's plane and the map's slide off it. A panel inside the plane would travel with it,
 * so it lives here instead — under a wrapper that is BARE (the frame's zoom, its type and its weight
 * answers, and nothing else). No `contain` and no z of its own: the column's own fixed wrapper then
 * resolves against the window and claims its own rung, which is how it can be `z.ground` docked and
 * standing chrome free.
 *
 * IT GOES AWAY WITH THE INTERFACE ALL THE SAME. The frame's veil cannot reach it from out here, so
 * the column wears the same two declared motions itself (`hidden`, threaded down).
 */
/** One plane's zoom and the answers derived from it: the same writes the plane's own `style` prop
 *  makes when React renders it, made without the render — the slide's frames go through here
 *  (`use-dock.ts:dockAside`), and whichever party wrote last wrote the same function of the same
 *  live fraction. */
function writeFrameZoom(el: HTMLElement, zoom: number, dpr: number, dense: boolean): void {
  el.style.zoom = String(zoom);
  el.style.setProperty('--shell-zoom', String(zoom));
  for (const [k, v] of Object.entries(weightVars(zoom, dpr, dense))) {
    el.style.setProperty(k, String(v));
  }
}

function Assistant({ hidden }: { hidden: boolean }) {
  const open = useEditorStore((s) => s.assistantOpen);
  const [everOpened, setEverOpened] = useState(open);
  // The zoom is computed from the LIVE fraction rather than read from the fit's hooks: docked, the
  // desk is drawn at the fit the slide is changing, so a render mid-flight writes the same zoom the
  // per-frame subscriber below is writing rather than the one the last crossing carried.
  const { aside } = useDockStage();
  const { w: vw, h: vh } = useViewportSize();
  const uiZoom = useAnimatedUiZoom();
  const zoom = frameZoomAt(aside, vw, vh, uiZoom);
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  const wrapRef = useRef<HTMLDivElement>(null);
  // The desk rides the slide's own frames: the fit moves on every one of them, and a desk drawn at a
  // stale fit meets the sheet's edge off the seam.
  useEffect(() => dockAside.on('change', (v) => {
    const el = wrapRef.current;
    if (!el) return;
    writeFrameZoom(el, frameZoomAt(v, window.innerWidth, window.innerHeight, uiZoom), dpr, dense);
  }), [uiZoom, dpr, dense]);
  useEffect(() => { if (open) setEverOpened(true); }, [open]);
  if (!everOpened) return null;
  return (
    <div
      ref={wrapRef}
      style={{
        zoom, '--shell-zoom': String(zoom), fontSize: TEXT.label, fontFamily: font.family,
        ...weightVars(zoom, dpr, dense),
      } as CSSProperties}
    >
      <ScaleProvider value={SCALE}>
        <Suspense fallback={null}>
          <PanelColumn open={open} hosted veiled={hidden} />
        </Suspense>
      </ScaleProvider>
    </div>
  );
}

/**
 * The bottom bar, and the handover from one mode's to the next's.
 *
 * ONE PRESENCE FOR ALL THREE BARS, keyed by the mode: the leaving bar and the arriving one are on
 * screen together for the length of the handover, which is what makes it a handover rather than a
 * gap. The two beats are the score's, so the order lives with the plate's rather than beside it.
 *
 * The wrapper takes no transform. Every bar positions itself against the window, and a wrapper that
 * took one would become their containing block and drag all three off their corners; opacity leaves
 * the layout alone, and it reaches a fixed child the same as any other descendant.
 *
 * IT DOES TAKE A LAYER, and it has to. An opacity under 1 makes an element a stacking context, so
 * for as long as the handover runs the bars' own `z.panel` is scoped INSIDE this wrapper, which
 * stands at z 0 among its siblings — under the screen's bottom vignette at `z.canvasControls`. The
 * whole bottom of the interface would therefore be drawn beneath that shading while it moves and
 * jump out from under it the frame the animation lands, so the shading jumps at the end of the move
 * (measured: the shelf's plate reads 61,56,50 mid-handover against 67,65,61 settled, exactly
 * `DARK_PLATE` with and without the vignette over it). Standing the wrapper at the z its bars claim
 * puts the context at the same height they would have reached on their own.
 */
function ModeBar({ mode, surface }: { mode: BuildMode; surface: TerrainSurface | null }) {
  const leaving = useBeat('mode.switch', 'bar.leaving');
  const arriving = useBeat('mode.switch', 'bar.arriving');
  // A bar asked to arrive with no travel must not be painted at its starting value first: measured
  // in the browser, that one frame is a bar that is present and invisible, which is the hole
  // dropping the wait was meant to close.
  const reduced = useReducedMotionConfig();
  const bar = surface ? <TerrainBar surface={surface} />
    : mode === 'object' ? <ObjectShelf />
      : mode === 'generate' ? <GenerateShelf />
        : mode === 'annotate' ? <AnnotationBar /> : null;
  return (
    <AnimatePresence>
      {bar ? (
        <motion.div
          key={mode}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1, transition: arriving }}
          exit={{ opacity: 0, transition: leaving }}
          style={{ position: 'relative', zIndex: z.panel }}
        >
          {bar}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Frame({ onRestoreSession, splashActive, hidden, onHide, entranceRef }: {
  onRestoreSession: (save: RestoredAutosave) => void;
  /** The character's entrance box, held by `Shell` because the character's own layer stands outside
   *  this frame's zoom (`agent/character/CharacterHost`) while the box it measures is inside it. */
  entranceRef: RefObject<HTMLDivElement>;
  /** The boot splash still covers the app: the frame is drawn behind it, so nothing here has been
   *  seen yet and the offer's countdown must not be spending itself. */
  splashActive: boolean;
  /** The interface is away and only the button that put it away is left standing. */
  hidden: boolean;
  onHide: () => void;
}) {
  const preview = useUiPreview();
  const pose = useUiPreviewPose();
  const liveMode = useEditorStore((s) => s.editMode.mode);
  // A picture holds the mode its figure poses (or rest), not whatever the live editor is doing:
  // a figure's claim about the selected icon and its toolbar must not depend on the reader's state.
  const mode = preview ? (pose?.mode ?? null) : liveMode;
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const setModal = useEditorStore((s) => s.setModal);
  const surface = terrainSurface(mode);
  const selectedMode = MODES.findIndex((art) => art.id === mode);
  const [menuOpen, setMenuOpen] = useState(false);
  const layout = useFrameLayout();
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  // The region brush is a state machine on the pointer channel, not a panel: it has to be mounted
  // wherever the button that arms it lives, or `selectingRegion` turns on and no stroke is collected.
  // Its own undo/redo goes to the shortcut context: while a region is being painted, Ctrl+Z pops
  // that stroke rather than a map edit.
  const { regionUndo, regionRedo } = useRegionBrush(selectingRegion);
  // Opening the windows is starting this session, so the key does what the button does and the
  // effect below retires the restore offer either way. No second rule for the keyboard.
  const toggleMenu = useCallback(() => setMenuOpen((o) => !o), []);
  // THE KEYBOARD. `useEditorShortcuts` is the editor's one keyboard surface, and it publishes the
  // HELD modifiers (constrain / multi-select / break-handle / pan-drag) to the pointer machine as
  // well as binding the discrete commands. A frame that does not mount it has no shortcuts at all,
  // and, less visibly, no Shift-to-constrain and no Space-to-pan.
  useEditorShortcuts(useShellCommands({ toggleMenu, regionUndo, regionRedo }));

  // Read ONCE, at mount: the offer is about the session this browser arrived with, and a save
  // written later in this session is this session's own work, never something to offer back.
  const [candidate, setCandidate] = useState<RestoredAutosave | null>(readRestorableAutosave);
  const dismissRestore = useCallback(() => {
    useAgentSession.getState().clearSession();
    setCandidate(null);
  }, []);
  // Opening the windows is starting this session: whoever reaches for New, Import or Settings has
  // stopped considering the offer.
  useEffect(() => { if (menuOpen && candidate) dismissRestore(); }, [menuOpen, candidate, dismissRestore]);
  // So is choosing a mode: the five blocks arm a tool, which is a decision to build on THIS map and
  // so an answer to whether the last one should come back. It is also what puts a bar in the corner
  // the offer stands in, so the card is gone before anything can cover it.
  useEffect(() => { if (mode !== null && candidate) dismissRestore(); }, [mode, candidate, dismissRestore]);
  useFirstEdit(candidate !== null, dismissRestore);
  // And opening the assistant is the same kind of decision as opening the menu or choosing a mode:
  // reaching for it is a choice about what to do next, so it answers the offer the same way rather
  // than merely covering it. Without this, the card was WITHHELD while the panel stood (the render
  // condition below) but never actually dismissed, so closing the panel brought it straight back.
  useEffect(() => { if (assistantOpen && candidate) dismissRestore(); }, [assistantOpen, candidate, dismissRestore]);
  // And so is opening any window at all. Most are reached through the menu, which already answers,
  // but the save-and-share window has its own button on the bar, and a visitor who is exporting
  // this map has stopped considering the last one just as surely.
  const anyWindowOpen = useEditorStore((s) => Object.values(s.modals).some(Boolean));
  useEffect(() => { if (anyWindowOpen && candidate) dismissRestore(); }, [anyWindowOpen, candidate, dismissRestore]);
  // And the same dismissal, offered to the one surface that stands over the map beside this card:
  // the arrival notice's OK is a hand saying where it is, which answers this offer too
  // (`core/runtime/restore-offer`), so the notice never has to ask whether the offer is up.
  useEffect(
    () => (candidate ? offerRestoreDismiss(dismissRestore) : undefined),
    [candidate, dismissRestore],
  );
  // The sheet belongs to the menu button, and the button has just gone. Left open it would be the
  // one panel standing over a map that was cleared to be looked at.
  useEffect(() => { if (hidden) setMenuOpen(false); }, [hidden]);

  return (
    <>
      {/*
        WHAT "THE INTERFACE" IS, when it is put away: everything the frame draws. The mode row and
        its captions, the assistant and its panel, the corner cluster, the menu sheet that hangs off
        it, the bottom bar, the restore offer. The right-hand column goes too, inside `Rail`, except
        the one button that is the way back.

        What does NOT go is anything that is a conversation rather than chrome — a modal, a toast,
        the tour — since those stand outside this frame and hiding one would strand whoever is in
        the middle of it. Nor the dev-build watermark, which exists to be unmissable: a control that
        could erase it would be a control that hides which build this is.

        `visibility` and not an unmount, so the layer stack, the open shelf and the assistant's
        panel are all exactly as they were left. It takes the whole subtree out of hit-testing and
        out of the accessibility tree with it, and it is not a transform, so the fixed children
        below still position against the window.
      */}
      <div
        data-testid="shell-frame-veil"
        style={{
          opacity: hidden ? 0 : 1,
          visibility: hidden ? 'hidden' : 'visible',
          // A CSS transition rather than Framer: `animations.css` collapses every one of them under
          // the reduced-motion attribute, so a visitor who asked for less motion gets the interface
          // at once rather than slowly. `visibility` rides the same clock because it is DISCRETE and
          // interpolates as visible until the end, which is what takes the frame out of hit-testing
          // and out of the accessibility tree only once it has finished leaving.
          transition: cssMotion(hidden ? 'frame.veil' : 'frame.unveil', 'opacity', 'visibility'),
          // An opacity under 1 makes this a stacking context, and at z 0 among its siblings the
          // whole frame would pass UNDER the screen's own shading for the length of the fade. The z
          // its clusters claim is the z the context has to stand at (`ModeBar` stands at its bars'
          // z for the same reason).
          position: 'relative', zIndex: z.panel,
        }}
      >
      <div
        {...tourTargetAttr('modes')}
        style={{
          position: 'fixed', top: MODE_ROW_TOP, left: MODE_ROW_LEFT, zIndex: z.panel,
          display: 'flex', alignItems: 'flex-end', gap: MODE.gap, pointerEvents: 'auto',
        }}
      >
        {/* Before the blocks, so the splat is behind every one of them. It is ground: the drawing
            stands ON it, and a button's own hover scale makes that button a stacking context, so a
            splat drawn INSIDE one would rise over its neighbours at exactly the wrong moment. */}
        <AnimatePresence initial={false}>
          {selectedMode >= 0 ? (
            <BlockPlate key={selectedMode} centre={blockCentre(selectedMode)} />
          ) : null}
        </AnimatePresence>
        {MODES.map((art, i) => (
          <RowBlock
            key={art.id}
            art={art}
            on={mode === art.id}
            centre={blockCentre(i)}
            helpTarget={MODE_HELP[art.id]}
            onPress={() => setEditMode({ mode: mode === art.id ? null : art.id })}
          />
        ))}
      </div>

      <AssistantBlock entranceRef={entranceRef} />

      <div
        data-testid="shell-corner-actions"
        style={{
          position: 'fixed', top: layout?.cornerTop ?? TOP_RIGHT_TOP, right: layout?.edgeRight ?? EDGE_RIGHT, zIndex: z.panel,
          transition: cssMotion('frame.layout.adapt', 'top'),
          // The three are different heights, and what they share is the LINE they stand on,
          // which is the mode row's own.
          display: 'flex', alignItems: 'flex-end', gap: TOP_RIGHT_GAP, pointerEvents: 'auto',
        }}
      >
        {/* A member with no drawing of its own is one this shell draws: today that is the load disc,
            whose shape is the game's rather than the design source's. */}
        {TOP_RIGHT.map((art) => (art.src === undefined ? (
          <LoadMeter key={art.id} art={art} />
        ) : (
          <Piece
            key={art.id}
            art={{ ...art, src: art.src }}
            onPress={
              art.id === 'menu' ? () => setMenuOpen((o) => !o)
                : art.id === 'share' ? () => setModal('share', true)
                  : undefined
            }
            expanded={art.id === 'menu' ? menuOpen : undefined}
            tourTarget={TOP_RIGHT_TOUR[art.id]}
            helpTarget={TOP_RIGHT_HELP[art.id]}
          />
        )))}
      </div>

      <ModeBar mode={mode} surface={surface} />
      {/* The saved session's offer, in the shelf band a visitor who has chosen no mode leaves empty.
          The band is drawn because there is something to offer and gone the moment there is not, so
          it can never read as a sixth mode; choosing one withdraws the offer anyway, and the two are
          on screen together only for the moment the one is leaving as the other arrives.

          The assistant's own panel runs down the left side to the top of whatever bar is showing, so
          while it is open that room is not free — the offer would sit under it. `assistantOpen`
          both hides the card here AND, in the effect above, dismisses it for good: engaging the
          assistant is a decision about what to do next, same as opening the menu or a mode, so the
          card must not reappear once the panel is put away. */}
      <AnimatePresence>
        {candidate && !assistantOpen && !preview && (
          <RestoreShelf
            key="restore"
            state={candidate.state}
            splashActive={splashActive}
            onRestore={() => { onRestoreSession(candidate); setCandidate(null); }}
            onDismiss={dismissRestore}
          />
        )}
      </AnimatePresence>
      </div>
      <Rail hidden={hidden} onHide={onHide} />
      {/* A SIBLING OF THE COLUMN, not a child of the veil, and it has to be: the veil's own opacity
          makes it a stacking context, so the sheet's rung was being scoped to the veil's and the
          column standing outside painted over the menu its own button had just opened. It needs
          none of the veil anyway — hiding the interface closes it. */}
      <MenuSheet open={menuOpen} onDismiss={closeMenu} />
    </>
  );
}

export interface ShellProps {
  children: ReactNode;
  /** Resume the offered autosave. The offer is this shell's; the sequencing behind it is App's. */
  onRestoreSession: (save: RestoredAutosave) => void;
  /** The boot splash still covers the app. Absent, nothing does. */
  splashActive?: boolean;
}

export function Shell({ children, onRestoreSession, splashActive = false }: ShellProps) {
  const preview = useUiPreview();
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const mode = useEditorStore((s) => s.editMode.mode);
  const portraitBlocked = useEditorStore((s) => s.portraitBlocked);
  // The shading's two moments are the bottom bar's own (`choreography.ts`), so which one this is
  // depends on which way the bar is going. The score is what holds them together; nothing here
  // chooses a length.
  const shade = useBeat('mode.switch', mode === null ? 'vignette.leaving' : 'vignette.arriving');
  // A browser holding an autosave has used the editor before, so the first-launch offer does not
  // apply to it. The key's PRESENCE is the whole question here: only a map with content is ever
  // written, and this shell has nothing else to do with the save, so it never parses one.
  const [hadSave] = useState(hasAutosave);
  // A pictured shell never opens the first-launch offer: `hadSave` true is the hook's own
  // no-op path, and a preview claims it.
  useFirstLaunchTour(portraitBlocked, hadSave || preview);
  // NOT persisted, and not in the store: nothing outside the frame has a stake in it, and a browser
  // that opened with the interface already gone would be a browser that opened broken.
  const [hidden, setHidden] = useState(false);
  const toggleHidden = useCallback(() => setHidden((h) => !h), []);
  // The character's two facts, read here because its layer stands outside the frame below: whether
  // the panel is its current home, and whether there is a provider to talk to at all.
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
  const connected = useAgentPanelSettings(isConnected);
  const entranceRef = useRef<HTMLDivElement>(null);
  // The chip at the parked character's shoulder is the way back into a job that is still running
  // with the panel shut, so it opens the panel exactly as her own block does.
  const openAssistant = useCallback(() => useEditorStore.getState().setAssistantOpen(true), []);
  // SHE IS THE TOGGLE, in both states. The panel's top-left corner is her own seat, so once it is
  // open the panel covers the block underneath her — a press aimed at her would land on the plate,
  // and the only way back out would be the keyboard. Her own layer takes the press instead, and the
  // block below keeps the label and the focus ring for a keyboard.
  const toggleAssistant = useCallback(() => {
    const store = useEditorStore.getState();
    store.setAssistantOpen(!store.assistantOpen);
  }, []);
  // Decoration, so reduced motion does not run it at all: the frame is simply there, which is what
  // "give me less motion" means for a thing that only had to appear.
  const arriving = useMotionAllowed('frame.arrive');
  const arrive = useMotion('frame.arrive');
  // WHETHER THE SHEET HAS MOVED ASIDE, which is a fact about this whole frame rather than about the
  // panel: the interface is one sheet of paper lying on the assistant's docked panel, and docking
  // slides it off. The shell is where the sequence that decides it is driven, and there is exactly
  // one driver (`use-dock.ts`).
  useDockDriver();
  const { aside, side: dockSide } = useDockStage();

  // What `animations.css` draws a keyboard focus ring in: its colour, the pale halo outside it that
  // carries it over a dark island, and the ring a TEXT FIELD wears, which here is none — a caret
  // says where the keyboard is and nothing needs to say it twice. A stylesheet cannot read a token
  // module, so the three custom properties are the bridge, and this is the one place they are named.
  // On the DOCUMENT rather than on the frame below, because the windows this shell opens stand
  // outside the frame and several of them are drawn in these same tokens.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--focus-ring', FOCUS_RING);
    root.style.setProperty('--focus-halo', FOCUS_HALO);
    root.style.setProperty('--focus-ring-field', FOCUS_RING_FIELD);
    return () => {
      root.style.removeProperty('--focus-ring');
      root.style.removeProperty('--focus-halo');
      root.style.removeProperty('--focus-ring-field');
    };
  }, []);

  // And whether that ring is drawn at all: it marks where the KEYBOARD is, so a focus a pointer
  // placed wears none.
  useFocusSource();

  /*
   * WHERE THE WORKSPACE'S SIDE EDGES ARE, published for the surfaces that stand OUTSIDE this frame.
   *
   * ONE PROPERTY PER EDGE, because the dock stands at one of two and a surface cannot know which: at
   * any moment exactly one of the pair is the dock's width and the other is zero, so a centred surface
   * takes half the difference and an inset one takes the edge it is on. Naming the edges rather than
   * signing one number is what keeps a css expression readable at the call site.
   *
   * TWO UNITS FOR EACH, because a chrome surface is not one thing: a modal's CARD and a toast carry
   * the chrome `zoom` themselves, while a modal's BACKDROP does not. So the width is published in the
   * chrome's own units (`--pin-dock-left` / `--pin-dock-right`, where it is `PINNED_DOCK_REF_W` at
   * every window, since chrome and dock ride one fit) and in real css px (the `-px` pair). A surface
   * that reads the wrong one lands off by exactly the fit.
   *
   * A BACKDROP STILL COVERS THE WHOLE WINDOW: the dock is part of what a modal takes over, and the
   * overlay lock has to reach it. What the offset moves is where the card is CENTRED, so a modal
   * stands over the work rather than half over the panel.
   */
  // The frame's zoom and the chrome scale, computed from the LIVE fraction rather than read from the
  // fit's hooks: the slide moves the fit, `aside` above is a live read, and a render that lands
  // mid-flight must write the same styles the per-frame subscriber below is writing. The hooks'
  // context updates only when the fraction crosses an end, so the two readings agree exactly there.
  const { w: vw, h: vh } = useViewportSize();
  const uiZoomAnim = useAnimatedUiZoom();
  const zoom = frameZoomAt(aside, vw, vh, uiZoomAnim);
  const chrome = zoom / ZOOM;
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  const dockRef = aside * PINNED_DOCK_REF_W;
  const dockPx = dockRef * chrome;
  /** The dock's width on the edge it stands at, and zero on the other. */
  const near = (at: 'left' | 'right', v: number) => (dockSide === at ? v : 0);
  /** How far the sheet's own near edge stands from the window's, in real css px. */
  const dockLeft = near('left', dockPx);
  const dockRight = near('right', dockPx);
  /** The sheet is between its two places: neither lying flat on the desk nor fully off it. */
  const sliding = aside > 0 && aside < 1;
  /**
   * HALF THE DOCK, WHICH IS HOW FAR THE MAP ITSELF HAS TO GO.
   *
   * The map is drawn centred in its own box, so a box that loses the dock's width from ONE edge moves
   * its centre by HALF that width — and the centre is what a viewer is watching. A plane that
   * travelled the sheet's whole distance therefore arrived with the world half a dock too far along,
   * and the settle's resize put it right in a single frame: the island visibly leapt 208px at 1440
   * css px, on both sides and at both ends of a change of side.
   *
   * So the plane travels this, and its VISIBLE EDGE is carried the rest of the way by a clip — which
   * is the whole reason the two are split. `clip-path` does not touch the box, so the canvas inside
   * keeps its size and the renderer keeps its buffer; the sheet's edge lands on the dock's seam while
   * the drawing lands on the new centre, and the resize at the end moves nothing on screen.
   */
  const mapTravel = dockPx / 2;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--pin-dock-left', `${near('left', dockRef)}px`);
    root.style.setProperty('--pin-dock-right', `${near('right', dockRef)}px`);
    root.style.setProperty('--pin-dock-left-px', `${dockLeft}px`);
    root.style.setProperty('--pin-dock-right-px', `${dockRight}px`);
    return () => {
      root.style.removeProperty('--pin-dock-left');
      root.style.removeProperty('--pin-dock-right');
      root.style.removeProperty('--pin-dock-left-px');
      root.style.removeProperty('--pin-dock-right-px');
    };
    // `near` is the side read three lines up; the side itself is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockRef, dockLeft, dockRight, dockSide]);

  /*
   * THE SLIDE'S FRAMES ARE WRITTEN HERE, PAST REACT (the argument is `use-dock.ts`'s header: a
   * fraction that reached these surfaces as a render cost 9-13ms of main thread per frame and the
   * sheet froze and leapt wherever a frame ran over budget, while the panel's compositor-carried
   * beats played on). One subscriber for the four surfaces the fraction moves, writing the SAME
   * arithmetic the render above writes at the ends: the frame plane's inset and its fit, the map
   * plane's two tracks, the shading's edges, and the per-edge widths published for the chrome
   * outside. The endpoint write is the settled form itself — insets in, transform and clip out,
   * the deafness lifted — because landing is not a render and nothing else would swap them back.
   */
  const framePlaneRef = useRef<HTMLDivElement>(null);
  const mapPlaneRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  useEffect(() => dockAside.on('change', (v) => {
    const frame = framePlaneRef.current;
    const map = mapPlaneRef.current;
    const vig = vignetteRef.current;
    if (!frame || !map || !vig) return;
    const zoomNow = frameZoomAt(v, window.innerWidth, window.innerHeight, uiZoomAnim);
    const refW = v * PINNED_DOCK_REF_W;
    const px = refW * (zoomNow / ZOOM);
    const atLeft = dockSide === 'left';
    const inset = `${v * PINNED_COLUMN_W}px`;
    frame.style.left = atLeft ? inset : '0px';
    frame.style.right = atLeft ? '0px' : inset;
    writeFrameZoom(frame, zoomNow, dpr, dense);
    const travel = px / 2;
    const between = v > 0 && v < 1;
    map.style.left = !between && atLeft ? `${px}px` : '0px';
    map.style.right = !between && !atLeft ? `${px}px` : '0px';
    map.style.transform = between ? `translateX(${atLeft ? travel : -travel}px)` : '';
    map.style.clipPath = between ? `inset(0 ${travel}px 0 ${travel}px)` : '';
    map.style.pointerEvents = between ? 'none' : '';
    vig.style.left = atLeft ? `${px}px` : '0px';
    vig.style.right = atLeft ? '0px' : `${px}px`;
    const root = document.documentElement.style;
    root.setProperty('--pin-dock-left', `${atLeft ? refW : 0}px`);
    root.setProperty('--pin-dock-right', `${atLeft ? 0 : refW}px`);
    root.setProperty('--pin-dock-left-px', `${atLeft ? px : 0}px`);
    root.setProperty('--pin-dock-right-px', `${atLeft ? 0 : px}px`);
  }), [dockSide, uiZoomAnim, dpr, dense]);

  // The mode is part of the choreography: the bar a step describes belongs to a mode, and the run
  // ends by clearing it. Applied with a direct, synchronous state set — `onStepEnter` fires from the
  // overlay's layout effect and the measurement waits for the rAF after it, so anything deferred
  // would miss the step's own target. The map VIEW is the second such action, and the one thing a
  // run has to give back: `viewMode` is persisted, so a visitor who skipped mid-3D would otherwise
  // find the editor opening in a view they never chose. Restored on every way out of a run
  // (finished, skipped, Escape), which is what this reads `tourRunning` for rather than hanging off
  // one of them.
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const borrowedView = useRef<ViewMode | null>(null);
  useEffect(() => {
    if (tourRunning) {
      borrowedView.current = useEditorStore.getState().viewMode;
      return;
    }
    const opened = borrowedView.current;
    borrowedView.current = null;
    if (opened && useEditorStore.getState().viewMode !== opened) setViewMode(opened);
  }, [tourRunning, setViewMode]);

  const handleTourStep = useCallback((step: TourStep) => {
    if (step.mode !== undefined) setEditMode({ mode: step.mode });
    if (step.view !== undefined) setViewMode(step.view);
  }, [setEditMode, setViewMode]);

  // `zoom` scales every length in the subtree, `--shell-zoom` is what an expression reaching for a
  // viewport unit inside divides back out. The family is set HERE because nothing sets one on the
  // document: `fonts.css` declares the faces and every other component names the stack itself, so a
  // frame element that did not name it inherited the browser's own default, which is a serif.
  /*
   * `contain: layout` makes this inset frame the containing block for fixed chrome without promoting
   * all text to a transformed compositing layer. Dock motion comes from the shared fraction; the
   * plane itself is pointer-transparent and each interactive cluster opts back in.
   */
  const frameStyle = {
    zoom, '--shell-zoom': String(zoom), fontSize: TEXT.label, fontFamily: font.family,
    // The frame's own weight answers, resolved at ITS zoom — `ZOOM` times the fit the chrome rides,
    // so the same authored size lands 1.25x larger here and the frame keeps a weight a modal drops.
    ...weightVars(zoom, dpr, dense),
    position: 'fixed', top: 0, bottom: 0,
    left: near('left', aside * PINNED_COLUMN_W), right: near('right', aside * PINNED_COLUMN_W),
    contain: 'layout',
    pointerEvents: 'none',
    // Same argument as the veil below it: the entrance's own opacity makes this a stacking context.
    zIndex: z.panel,
  } as CSSProperties;
  return (
    <>
      {/* The docked panel stays outside the sliding frame plane. */}
      <Assistant hidden={hidden} />
      {/* The map plane transforms and clips during docking, then settles to an inset. This avoids
          resizing renderer buffers on every animation frame. Pointer input stays disabled in transit
          because view projections update when the containing box settles. */}
      <div
        ref={mapPlaneRef}
        data-testid="shell-map-plane"
        style={{
          position: 'fixed', top: 0, bottom: 0,
          left: sliding ? 0 : dockLeft,
          right: sliding ? 0 : dockRight,
          // The travel takes the dock's own side: a dock at the left pushes the sheet right and one at
          // the right pushes it left, which is the same distance with the sign the side gives it. The
          // clip is the same distance on BOTH edges either way — the near edge is carried onto the
          // seam and the far one back off the window it was pushed past.
          ...(sliding
            ? {
              transform: `translateX(${dockSide === 'left' ? mapTravel : -mapTravel}px)`,
              clipPath: `inset(0 ${mapTravel}px 0 ${mapTravel}px)`,
              pointerEvents: 'none',
            }
            : null),
          contain: 'layout',
          zIndex: z.paper,
        }}
      >
        {children}
      </div>
      {/* The one piece of shading in the interface, and it belongs to the SCREEN rather than to any
          control: the map darkens toward the edges the chrome stands on. Over the canvas, under the
          frame, and out of the pointer's way. It is a page element, so it cannot reach an exported
          image — an export renders the map scene, never the document.

          An edge is shaded because something stands there, and only the BOTTOM has a real seam:
          a full-width shelf meeting the map. With no mode chosen there is no shelf either, so the
          pane hangs past the fold by the vignette's own depth and takes the shading off screen
          entirely.

          IT SLIDES, AND IT SLIDES ON THE BAR'S CLOCK. Arriving and leaving in one frame, the
          shading read as the bottom of the screen changing colour on its own, a beat away from the
          shelf that is the reason for it. `y` rather than `bottom`, so the pane keeps the
          viewport's height and travels by transform: an animated `bottom` is a resize every frame,
          on a full-screen element, for a move nothing measures. */}
      <motion.div
        ref={vignetteRef}
        aria-hidden
        data-testid="shell-vignette"
        style={{
          // The shading belongs to the WORKSPACE'S edges, so it starts where the frame's plane does:
          // docked, the panel is what stands at one side of the window and the seam is at the edge of
          // it that faces the work.
          position: 'fixed', top: 0, left: dockLeft, right: dockRight, bottom: 0, pointerEvents: 'none',
          zIndex: z.canvasControls, background: EDGE_VIGNETTE,
        }}
        // Mounted where it belongs rather than sliding in on arrival: the frame opens at rest, and
        // an entrance nobody asked for is the first thing a visitor sees.
        initial={false}
        animate={{ y: mode === null || hidden ? VIGNETTE_DEPTH : 0 }}
        transition={shade}
      />
      <ShapeEdgeFilter />
      {/* THE FRAME ARRIVES. It comes up over the same 800 ms the 3D scene flies the island
          in over, so the map arrives and the interface arrives around it.

          Presence only, and that is forced rather than chosen: every cluster inside is a FIXED
          element, and a transform or a filter here would become their containing block and pull all
          of them off the window's corners. */}
      <motion.div
        ref={framePlaneRef}
        style={frameStyle}
        initial={arriving ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={arrive}
      >
        <ScaleProvider value={SCALE}>
        <FrameLayoutProvider>
          <Frame
            onRestoreSession={onRestoreSession}
            splashActive={splashActive}
            hidden={hidden}
            onHide={toggleHidden}
            entranceRef={entranceRef}
          />
        </FrameLayoutProvider>
        </ScaleProvider>
      </motion.div>
      {/* THE ONE CHARACTER, and it stands outside the frame's zoom on purpose: it positions itself
          `fixed` from slots it MEASURES, and a zoomed subtree resolves a fixed element's own
          coordinates in zoomed space while a measured rect is in the window's (see
          `agent/character/CharacterHost`). It goes away with the frame all the same — it is part of
          the interface, not of the map. */}
      {!preview && (
        <CharacterHost
          entranceRef={entranceRef}
          open={assistantOpen}
          connected={connected}
          hidden={hidden}
          size={ENTRANCE_CHAR_W}
          onOpen={openAssistant}
          onToggle={toggleAssistant}
        />
      )}
      {/* Outside the frame's zoom: a window sizes itself through `useChromeScale`, which carries the
          same window fit as the frame without the frame's own page zoom. */}
      {/* The acting surfaces stay with the LIVE shell: a pictured one has no windows to open, no
          tour to run, and no second copy of either belongs in the document. */}
      {!preview && <Windows />}
      {!preview && <TourOverlay steps={SHELL_TOUR_STEPS} onStepEnter={handleTourStep} diagram={tourDiagram} />}
      {!preview && <TourDoneModal />}
    </>
  );
}
