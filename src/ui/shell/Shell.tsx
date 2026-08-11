/*
 * Shell.tsx — the game-style interface: the frame that stands around the map.
 *
 * The five mode blocks pick what is being built and the bottom bar follows: the mode is the store's
 * own `editMode.mode`, so which bar is showing and what the map is armed with are one fact rather
 * than two. The assistant is a sixth block of the same family on a SECOND ROW under them, sharing
 * their left edge, and it is NOT a sixth mode: the five are mutually exclusive because each arms a
 * tool and the map can hold one, where pressing the assistant only opens its own panel. So it
 * stands beside whichever mode is selected rather than clearing it — the panel's own floor is
 * measured from the bar the current mode is showing, which is a measurement that only means
 * anything while a mode is still selected under it. The load / share / menu cluster is the
 * top-right corner and the three right-edge groups are `Rail`.
 *
 * THE CHROME IS LAID OUT IN FIXED CSS PIXELS (`units.ts`), not through the menu scale: a button is
 * one size at every window size and the map takes the extra room, which is what a game's frame does.
 * The whole frame sits under one `zoom` — the frame's own page zoom times the user's UI
 * zoom — so Ctrl +/- still resizes everything and nothing else has to know about it. The drawn art
 * keeps the design source's proportions through `units.ts:SCALE`, which is the fixed value the
 * shell provides to `usePx` in place of the viewport-derived one.
 *
 * The tour's machinery is `ui/chrome/tour/` and its content is `tour-steps.ts`: the overlay is
 * mounted here, and the steps' host action — which mode is selected — is applied here.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import type { BuildMode } from '../../core/model/edit-mode';
import { discardStoredSession } from '../../agent/session';
import { hasAutosave, readRestorableAutosave, type RestoredAutosave } from '../../io/autosave';
import { useT } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { TourDoneModal } from '../chrome/tour/TourDoneModal';
import { TourOverlay } from '../chrome/tour/TourOverlay';
import { tourTargetAttr, type TourStep, type TourTargetId } from '../chrome/tour/steps';
import { useFirstLaunchTour } from '../chrome/tour/use-tour';
import { useEditorShortcuts } from './use-editor-shortcuts';
import { useRegionBrush } from './use-region-brush';
import { ScaleProvider } from '../design/scale';
import { useFocusSource } from '../design/focus-source';
import { btnReset, cursors, font, pressable, z } from '../design/styles';
import { Assistant } from './assistant/Assistant';
import { useCharacterPose, type CharacterMotionProps } from './assistant/use-character-pose';
import { GenerateShelf } from './bars/GenerateShelf';
import { ObjectShelf } from './bars/ObjectShelf';
import { TerrainBar } from './bars/TerrainBar';
import { terrainSurface, type TerrainSurface } from './bars/terrain-cells';
import {
  ASSISTANT_BLOCK, ASSISTANT_ROW_TOP, MODES, MODE_PLATE, MODE_PLATE_ID, MODE_ROW_LEFT, MODE_ROW_TOP,
  TOP_RIGHT, TOP_RIGHT_TOP, blockCentre, topRightHeight, topRightSlack, type BlockArt, type FrameArt,
} from './frame';
import { LoadMeter } from './windows/LoadMeter';
import { MenuSheet } from './windows/MenuSheet';
import { cssMotion, useBeat, useMotion, useMotionAllowed } from './motion/use-motion';
import { Rail } from './Rail';
import { RestoreShelf } from './bars/RestoreShelf';
import { EDGE_VIGNETTE, FOCUS_HALO, FOCUS_RING, FOCUS_RING_FIELD, FOCUS_SHAPE_RADIUS, INK, MAP_EDGE_ALPHA, MAP_LABEL, MAP_SHAPE_EDGE, SHAPE_EDGE_FILTER, SHAPE_EDGE_ID, VIGNETTE_DEPTH, mapShape } from '../design/tokens';
import {
  captionShift, EDGE_RIGHT, MODE, MODE_SCALE, SCALE, TEXT, TOP_RIGHT_GAP,
} from './units';
import { SHELL_TOUR_STEPS } from './tour-steps';
import { useFrameZoom } from './use-frame-zoom';
import { useShellCommands } from './use-shell-commands';
import { Windows } from './windows/Windows';

/** Which top-right control a tour step points at. Only the two that DO something are named: the
 *  load readout is a readout. */
const TOP_RIGHT_TOUR: Partial<Record<string, TourTargetId>> = { share: 'share', menu: 'menu' };

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
 * (`frame.ts:topRightHeight`). They shared a box height before, which made three sizes out of three
 * drawings — a filled circle and a shape that is mostly a notch do not read alike at one height.
 *
 * The drawing is used as a SHAPE, not as a picture: the file gives the silhouette and the frame
 * gives it the column's cream and the hairline edge every drawing standing on the map wears
 * (`tokens.ts:mapShape` / `MAP_SHAPE_EDGE`). Two nested boxes, because the edge has to be applied
 * to a parent of the masked one.
 */
function Piece({ art, onPress, expanded, tourTarget }: {
  art: FrameArt & { src: string };
  onPress?: () => void;
  expanded?: boolean;
  tourTarget?: TourTargetId;
}) {
  const t = useT();
  const h = topRightHeight(art);
  const box: CSSProperties = { height: h, width: (art.w / art.h) * h, flex: 'none' };
  // Whatever slack the drawing carries under its own ink hangs BELOW the row's line, so the three
  // stand on that line by their ink and not by their boxes.
  const line: CSSProperties = { ...box, marginBottom: -topRightSlack(art) };
  const shape = (
    <span aria-hidden style={{ ...box, display: 'block', filter: MAP_SHAPE_EDGE }}>
      <span style={{ ...mapShape(art.src), display: 'block', width: '100%', height: '100%' }} />
    </span>
  );
  if (!onPress) return <span role="img" aria-label={t(art.labelKey)} style={line}>{shape}</span>;
  return (
    <motion.button
      type="button"
      {...pressable}
      {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
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
 * right wiped the splat across the drawings it crossed (at 58 css px a block and 89 the splat, it
 * covered all but the top of each cube on the way), and a move to the left hid it behind them.
 * Standing before the buttons in the row's own box it is behind all of them whichever way it goes,
 * which is also what it is a picture of.
 *
 * Positioned by a LENGTH rather than a centring translate: it travels, and Framer owns `transform`
 * on anything it moves, so a `translateX(-50%)` would be clobbered the instant it left (the jump
 * `styles.ts:pressable` warns about).
 */
function BlockPlate({ centre, animated }: {
  /** The centre of the block it belongs under, in css px from the window's left edge. Both rows
   *  start at `MODE_ROW_LEFT`, which is what makes this a length inside either of them. */
  centre: number;
  /** Whether this splat arrives and leaves with the mode row's own score. The assistant's does not:
   *  it belongs to one block that is not part of the switch. */
  animated?: boolean;
}) {
  const arrive = useBeat('mode.switch', 'plate.arriving');
  const leave = useBeat('mode.switch', 'plate.leaving');
  return (
    <motion.img
      data-testid={animated ? MODE_PLATE_ID : undefined}
      src={MODE_PLATE.src}
      alt=""
      draggable={false}
      {...(animated ? {
        initial: { opacity: 0, scale: 0.88 },
        animate: { opacity: 1, scale: 1, transition: arrive },
        exit: { opacity: 0, scale: 0.88, transition: leave },
      } : null)}
      style={{
        position: 'absolute', left: centre - MODE_ROW_LEFT - PLATE_W / 2,
        bottom: -MODE_PLATE.drop * MODE_SCALE,
        width: PLATE_W, height: MODE_PLATE.h * MODE_SCALE,
      }}
    />
  );
}

/**
 * One block of the top-left row.
 *
 * The block stands on the row's shared baseline — its box's bottom — so six drawings of six heights
 * read as one row. The selected drawing is bigger than the slot and the splat behind it bigger
 * again; both are centred on the slot and allowed to spill, which is what the design does.
 *
 * `expanded` is for the block that opens something rather than arming something: it takes the
 * aria attribute the assistant's panel needs, and its absence is what makes a block report itself
 * as pressed instead.
 *
 * ONE BLOCK NAMES ITSELF, AND IT IS THE CHOSEN ONE. The caption answers "what am I building", so it
 * belongs to the mode in force and to nothing else. A name that also came up under whatever the
 * pointer crossed put a word on the map five times on the way to the sixth block, and none of those
 * five was an answer to anything: these are five fixed pictures a visitor learns once. The item
 * cards go the other way for the opposite reason — a card is one of dozens in a scrolling row and
 * its name is the only thing telling it from its neighbour, so there hover is how the row is read.
 *
 * The caption stands on the MAP with nothing behind it, on the outline that replaces a plate
 * (`tokens.ts:MAP_LABEL`). It hangs BELOW the row's baseline and out of the flow, so the row's own
 * height never had to make room for it.
 *
 * A BLOCK IS A TOGGLE, NOT A RADIO. Pressing the mode already in force puts it away: the bar goes,
 * the plate goes, and the map is back at REST with nothing armed — the same state the editor opens
 * in. That is what makes rest a place a visitor can go on purpose rather than one they can only
 * leave, and it is what the assistant's own block has always done with its panel.
 *
 * The splat it stands on is NOT the block's: the row draws it (`BlockPlate`), so it can travel
 * behind the blocks between them.
 */
function RowBlock({ art, on, centre, expanded, tourTarget, pose, onPress }: {
  art: BlockArt;
  on: boolean;
  centre: number;
  expanded?: boolean;
  tourTarget?: TourTargetId;
  /** A block whose drawing has a state of its own to show. Only the character has one: the five
   *  modes are five fixed pictures, and a picture that moved without meaning anything is what the
   *  ambient tier exists to keep off them. It poses the DRAWING and never the block, because the
   *  block carries the caption and ambient motion may not run on type. */
  pose?: CharacterMotionProps;
  /** Called for either half of the toggle: the caller owns what "on" and "off" mean for it. */
  onPress: () => void;
}) {
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
      {...(pose ? pose.hover : {})}
      aria-label={t(art.labelKey)}
      {...(expanded === undefined ? { 'aria-pressed': on } : { 'aria-expanded': expanded })}
      onClick={onPress}
      style={{
        ...btnReset, position: 'relative', flex: 'none', overflow: 'visible',
        width: MODE.size, height: MODE.height, borderRadius: FOCUS_SHAPE_RADIUS,
        cursor: cursors.clickable,
      }}
    >
      <motion.img
        src={drawing.src}
        alt=""
        draggable={false}
        {...(pose ? { 'data-testid': 'shell-character', animate: pose.animate, transition: pose.transition } : {})}
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
            fontSize: MODE.label.size, fontWeight: MODE.label.weight,
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}
        >
          {t(art.labelKey)}
        </motion.span>
      ) : null}
    </motion.button>
  );
}

/**
 * The second row: the assistant's block, on its own because the character has a state and the five
 * modes do not.
 *
 * IT SUBSCRIBES HERE AND NOT IN THE FRAME. The character reads the agent session, which moves
 * constantly through a run — a card at a time, `thinking` on and off around each one — and the rest
 * of the shell has no stake in any of it.
 *
 * Its splat is not the row's above, so it does not share that one's name: it has nowhere to travel
 * and two elements under one name have no single place to be.
 */
function AssistantBlock() {
  const open = useEditorStore((s) => s.assistantOpen);
  const setOpen = useEditorStore((s) => s.setAssistantOpen);
  const pose = useCharacterPose(open);
  return (
    <div style={{ position: 'fixed', top: ASSISTANT_ROW_TOP, left: MODE_ROW_LEFT, zIndex: z.panel }}>
      {open ? <BlockPlate centre={blockCentre(0)} /> : null}
      <RowBlock
        art={ASSISTANT_BLOCK}
        on={open}
        expanded={open}
        centre={blockCentre(0)}
        tourTarget="assistant"
        pose={pose}
        onPress={() => setOpen(!open)}
      />
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
 * whole bottom of the interface was therefore drawn beneath that shading while it moved and jumped
 * out from under it the frame the animation landed, so the shading jumps at the end of the move
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
      : mode === 'generate' ? <GenerateShelf /> : null;
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

function Frame({ onRestoreSession, hidden, onHide }: {
  onRestoreSession: (save: RestoredAutosave) => void;
  /** The interface is away and only the button that put it away is left standing. */
  hidden: boolean;
  onHide: () => void;
}) {
  const mode = useEditorStore((s) => s.editMode.mode);
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const setModal = useEditorStore((s) => s.setModal);
  const surface = terrainSurface(mode);
  const selectedMode = MODES.findIndex((art) => art.id === mode);
  const [menuOpen, setMenuOpen] = useState(false);
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
    discardStoredSession();
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
          // its clusters claim is the z the context has to stand at (the same fix `ModeBar` carries).
          position: 'relative', zIndex: z.panel,
        }}
      >
      <div
        {...tourTargetAttr('modes')}
        style={{
          position: 'fixed', top: MODE_ROW_TOP, left: MODE_ROW_LEFT, zIndex: z.panel,
          display: 'flex', alignItems: 'flex-end', gap: MODE.gap,
        }}
      >
        {/* Before the blocks, so the splat is behind every one of them. It is ground: the drawing
            stands ON it, and a button's own hover scale makes that button a stacking context, so a
            splat drawn INSIDE one would rise over its neighbours at exactly the wrong moment. */}
        <AnimatePresence initial={false}>
          {selectedMode >= 0 ? (
            <BlockPlate key={selectedMode} centre={blockCentre(selectedMode)} animated />
          ) : null}
        </AnimatePresence>
        {MODES.map((art, i) => (
          <RowBlock
            key={art.id}
            art={art}
            on={mode === art.id}
            centre={blockCentre(i)}
            onPress={() => setEditMode({ mode: mode === art.id ? null : art.id })}
          />
        ))}
      </div>

      <AssistantBlock />

      <Assistant />

      <div
        style={{
          position: 'fixed', top: TOP_RIGHT_TOP, right: EDGE_RIGHT, zIndex: z.panel,
          // The three are different heights now, and what they share is the LINE they stand on,
          // which is the mode row's own.
          display: 'flex', alignItems: 'flex-end', gap: TOP_RIGHT_GAP,
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
          />
        )))}
      </div>

      <ModeBar mode={mode} surface={surface} />
      {/* The saved session's offer, in the shelf band a visitor who has chosen no mode leaves empty.
          The band is drawn because there is something to offer and gone the moment there is not, so
          it can never read as a sixth mode; choosing one withdraws the offer anyway, and the two are
          on screen together only for the moment the one is leaving as the other arrives.

          The assistant's own panel runs down the left side to the top of whatever bar is showing, so
          while it is open that room is not free. Opening it is NOT an answer — it arms nothing and
          leaves the map as it was — so the offer WAITS there rather than being withdrawn, and comes
          back when the panel is put away. A visitor who left the panel open last time therefore
          still gets the offer, one press later. */}
      <AnimatePresence>
        {candidate && !assistantOpen && (
          <RestoreShelf
            key="restore"
            state={candidate.state}
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
}

export function Shell({ children, onRestoreSession }: ShellProps) {
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const mode = useEditorStore((s) => s.editMode.mode);
  const portraitBlocked = useEditorStore((s) => s.portraitBlocked);
  const zoom = useFrameZoom();
  // The shading's two moments are the bottom bar's own (`choreography.ts`), so which one this is
  // depends on which way the bar is going. The score is what holds them together; nothing here
  // chooses a length.
  const shade = useBeat('mode.switch', mode === null ? 'vignette.leaving' : 'vignette.arriving');
  // A browser holding an autosave has used the editor before, so the first-launch offer does not
  // apply to it. The key's PRESENCE is the whole question here: only a map with content is ever
  // written, and this shell has nothing else to do with the save, so it never parses one.
  const [hadSave] = useState(hasAutosave);
  useFirstLaunchTour(portraitBlocked, hadSave);
  // NOT persisted, and not in the store: nothing outside the frame has a stake in it, and a browser
  // that opened with the interface already gone would be a browser that opened broken.
  const [hidden, setHidden] = useState(false);
  const toggleHidden = useCallback(() => setHidden((h) => !h), []);
  // Decoration, so reduced motion does not run it at all: the frame is simply there, which is what
  // "give me less motion" means for a thing that only had to appear.
  const arriving = useMotionAllowed('frame.arrive');
  const arrive = useMotion('frame.arrive');

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

  // The mode is part of the choreography: the bar a step describes belongs to a mode, and the run
  // ends by clearing it. Applied with a direct, synchronous state set — `onStepEnter` fires from the
  // overlay's layout effect and the measurement waits for the rAF after it, so anything deferred
  // would miss the step's own target.
  const handleTourStep = useCallback((step: TourStep) => {
    if (step.mode !== undefined) setEditMode({ mode: step.mode });
  }, [setEditMode]);

  // `zoom` scales every length in the subtree, `--shell-zoom` is what an expression reaching for a
  // viewport unit inside divides back out. The family is set HERE because nothing sets one on the
  // document: `fonts.css` declares the faces and every other component names the stack itself, so a
  // frame element that did not name it inherited the browser's own default, which is a serif.
  const frameStyle = {
    zoom, '--shell-zoom': String(zoom), fontSize: TEXT.label, fontFamily: font.family,
    // Same argument as the veil below it: the entrance's own opacity makes this a stacking context.
    position: 'relative', zIndex: z.panel,
  } as CSSProperties;
  return (
    <>
      {children}
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
        aria-hidden
        data-testid="shell-vignette"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none',
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
        style={frameStyle}
        initial={arriving ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={arrive}
      >
        <ScaleProvider value={SCALE}>
          <Frame onRestoreSession={onRestoreSession} hidden={hidden} onHide={toggleHidden} />
        </ScaleProvider>
      </motion.div>
      {/* Outside the frame's zoom: a window sizes itself through `useChromeScale`, which is the
          viewport-tracking curve the modals are designed against. */}
      <Windows />
      <TourOverlay steps={SHELL_TOUR_STEPS} onStepEnter={handleTourStep} />
      <TourDoneModal />
    </>
  );
}
