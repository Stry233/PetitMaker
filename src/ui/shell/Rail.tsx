/*
 * Rail.tsx — the right edge: three separate groups.
 *
 * They are not one column. Each answers a different question, so each stands apart: the layer
 * stepper under the top-right cluster, undo and redo on the screen's middle line where a hand
 * rests, the view kit hanging above the bottom corner. What makes a group a group is PROXIMITY —
 * its buttons sit a few pixels apart and the next group is a screen away — because the drawing has
 * no outline to draw a box with. Nothing here has a border or casts a shadow: every edge in the
 * design source is a filled shape, so a plate is a fill and a corner radius. What it does wear is
 * the hairline every drawing standing on the map wears, as the spread-only ring a radius box can
 * carry (`tokens.ts:plateShapeEdge`) — an outline of its own silhouette, no blur, no direction.
 *
 * The buttons are the design's own round cream plates with its glyphs on them; the layer stepper is
 * the one dark plate the drawing has, which is what it puts the layer control on.
 *
 * WHERE THEY STAND IS ONE DECISION, NOT FOUR, and `frame.ts:planRail` is where it is made. The
 * column runs from under the top-right cluster (`RAIL_TOP`) to just above the bottom shelf's plate
 * (`RAIL_FLOOR`); the layer control hangs from the top of that run, the view kit from the bottom,
 * and the history pair takes the middle of what is left. So the three separations come out near
 * enough equal by themselves, and moving one end cannot quietly collapse the grouping at the other:
 * hung off the window's bottom edge by a number of its own, the kit ends up standing on the item
 * shelf.
 *
 * The kit hangs by its TOP, so the 2D/3D switch keeps one screen position and only the buttons 3D
 * adds reach further down; the hang is measured for the taller of the two, which is what keeps the
 * 3D row off the shelf. On a window too short for the seven in one file the kit runs in two, since a
 * button off the bottom of the screen is worse than a kit that is a pad rather than a file, and on
 * one too short for THAT the pair folds into a 2x1 row beside it. Both are the same decision in the
 * same plan (`frame.ts:RAIL_FOLDS`) and both TRAVEL to the new arrangement rather than snapping into it.
 *
 * A BUTTON GIVES ITS NAME WHEN THE POINTER RESTS ON IT: the round plate opens into a pill carrying
 * the word, leftward toward the map, so nothing a person is aiming at moves. EVERY arrangement
 * offers it, the folded ones included — folding is the shape most windows put these groups in (a
 * 900 css px window already runs the kit in two files), so a pill withheld there is a pill most
 * visitors never see. A right-file pill passes over its left neighbour while it is open, and that
 * costs no press: the pill exists only while the pointer is inside its own button's square, so by
 * the time the pointer reaches where the word was, the hover that showed it has ended and the
 * neighbour is answering for itself. Four of the kit's buttons also repeat while HELD — the two
 * zooms and the two turns, which are steppers — and the three that do not are the three where a
 * held press has no meaning.
 *
 * ONE OF THE KIT'S BUTTONS PUTS THE WHOLE INTERFACE AWAY, and it is the one thing left on screen
 * when it has (`ViewKit`).
 *
 * THE OPEN LAYER STACK IS THE FOURTH THING THE PLAN PLACES, and it is why the pair has a second
 * place at all: where the lane can hold the plate, the pair drops to the lowest the column allows
 * and the plate stands over the room it left. Where it cannot, the plate steps out of the lane
 * instead and the pair does not move — the plan works that out per window, and this file only reads
 * the answer.
 */
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode,
} from 'react';
import { AnimatePresence, motion, type TargetAndTransition } from 'framer-motion';
import { getActiveView } from '../../canvas/active-view';
import { tourTargetAttr, type TourTargetId } from '../chrome/tour/steps';
import { ELEVATION_MAX } from '../../core/model/constants';
import { useT } from '../../i18n/context';
import { host } from '../../kit/host';
import { useEditorStore } from '../../state/store';
import { IconFit } from './glyph-icons';
import { layerName } from './layer-name';
import { btnReset, cursors, pressable, pressOnly, z } from '../design/styles';
import { usePressRepeat } from '../hooks/use-press-repeat';
import { useUiZooming } from '../design/ui-zoom-anim';
import {
  apparentSize, FIT_BOX, FIT_INK, FIT_TRIM, GLYPHS, HISTORY_BUTTONS, KIT_BUTTONS, LAYER_STEP_RIGHT,
  planRail, railCell, RAIL_TOP, readoutPressLane, type LayerMode, type RailCell, type RailPlan,
} from './frame';
import { GlyphIcon } from './GlyphIcon';
import { LayerPanel, plateDepth } from './windows/LayerPanel';
import { CSS_CURVES } from './motion/curves';
import { MOTIONS } from './motion/registry';
import { cssMotion, useMotion } from './motion/use-motion';
import { useDockStage } from './use-dock';
import { ACTIVE, DARK_PLATE, INK, MAP_LABEL, PLATE, PLATE_INK, plateShapeEdge } from '../design/tokens';
import { PANEL_RIGHT } from './panel-frame';
import { useFrameZoom, useZoomedLayoutTransform } from './use-frame-zoom';
import { useViewportHeight } from './use-viewport';
import { EDGE_RIGHT, RAIL, TEXT } from './units';

import layersPolygon from '../../assets/shell/rail/layers/polygon.svg';

/**
 * How a thing of the column leaves and comes back when the interface is put aside.
 *
 * The SAME clock the rest of the frame fades on (`Shell.tsx`), so the column does not snap out while
 * everything else dissolves. `visibility` rides it because it is discrete and interpolates as
 * visible until the end, which takes the button out of hit-testing only once it has gone.
 *
 * The properties are the CALLER'S, because one property may have only one clock: a button whose
 * own opacity Framer animates (the turns, which arrive and leave with the view) declares the veil
 * on `visibility` and lets its drawing carry the fade.
 */
const veilTransition = (hidden: boolean, ...properties: string[]) =>
  cssMotion(hidden ? 'frame.veil' : 'frame.unveil', ...properties);

/** How the pair travels between its two places. */
const YIELD_MOTION = MOTIONS['rail.history.yield'];
const YIELD_TRANSITION = `top ${YIELD_MOTION.duration}s ${CSS_CURVES[YIELD_MOTION.curve]}`;

/** The fit-to-view icon at the same apparent size as the drawn glyphs beside it, less its own
 *  correction (`FIT_TRIM`). Its ink is already centred in its own box, so it needs the scale and
 *  not the shift. */
function FitIcon() {
  const box = FIT_BOX * FIT_TRIM * (RAIL.glyph / apparentSize(FIT_INK));
  return <span style={{ display: 'flex', width: box, height: box, flex: 'none' }}><IconFit size={box} /></span>;
}

/** A group: a column against the right edge, its members close enough to read as one thing. */
const group: CSSProperties = {
  position: 'fixed',
  right: EDGE_RIGHT,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: RAIL.gap,
  // Above the bottom shelves: a shelf is as wide as the window and these three groups are the way
  // out of whatever it is showing, so they must never be the thing it covers.
  zIndex: z.column,
  // A GROUP IS ITS BUTTONS AND THE AIR BETWEEN THEM, AND THE AIR IS NOT ITS TO CLAIM. A group's box
  // is a grid wide enough for its files, so at two files an odd count leaves a whole empty cell, and
  // the box is about twice a button either way. Standing at `z.column` it took every press that
  // landed in that emptiness: the gaps between the buttons swallowed clicks meant for the map, and
  // at uiZoom 1.8 on a 1280x800 window the kit's own box reached x 930 while the assistant panel's
  // send button sat at 889..970, so `elementFromPoint` at the send's centre answered this group and
  // the composer could not be sent. Deaf here and `inGroup` on each control, which is the same split
  // the plate below already uses for its own drawing.
  pointerEvents: 'none',
};

/** What a control inside a group re-claims, the air around it having given it up. */
const inGroup: CSSProperties = { pointerEvents: 'auto' };

/** How much bigger a button draws itself while the pointer is on it, taken from the hover every
 *  other button in the app answers with (`styles.ts:pressable`) rather than restated, so the rail
 *  acknowledges a pointer by the same amount the modals and the mode blocks do. */
const HOVER_SCALE = pressable.whileHover.scale;

/**
 * One round button, on the plate the drawing gives it.
 *
 * THE PLATE IS NOT THE BUTTON, and the split is what lets the button answer a pointer twice without
 * the two answers fouling each other. The BUTTON is the boundary: a 44 px square that nothing ever
 * transforms or resizes, which is the only box a hover can be judged against safely — a box that
 * grows under a standing pointer moves the edge the pointer is being tested against and fires the
 * event that then moves it back, pumping the hover on and off. The PLATE is
 * the drawing: an absolutely positioned shape that opens into a pill to give the button's name and
 * grows a little to acknowledge the pointer, `pointerEvents: 'none'` so neither of those reaches
 * hit-testing. It grows over the map, which is the only direction that costs nothing: a button
 * introducing itself cannot push its neighbours along or move the column it stands in.
 *
 * The pill is therefore a LABEL AND NOT A TARGET, which is also true of it in use: it is only ever
 * on screen while the pointer is inside the square, so there is no moment in which a person could
 * be aiming at it.
 *
 * BOTH THINGS THE PLATE DOES ARE ONE MOVEMENT (`rail.name.reach`), on one element and one clock,
 * and that is what keeps them from fouling each other. There is ONE cream shape here — the pill's
 * body IS the round button's — so a growth that reads as the button getting bigger unavoidably
 * multiplies the pill's width as well; drawing the two as separate shapes would put a second
 * hairline through the middle of the pill, which is a worse thing to look at than the arithmetic.
 * What that arithmetic costs is only visible if the two arrive out of phase, so they share one
 * spring: measured across the opening in the browser, the name reaches 0.3 page px past where it
 * settles, for one frame, on a pill 174 wide.
 *
 * WHICH WAY IT GROWS IS POSITIONAL (`grow`). These hang off the window's right edge, so growing
 * left is growing into the map; the one control that stands at the left of its own row grows the
 * other way. The plate is anchored at the end the glyph is at, so the glyph never moves and the
 * name comes out from under it.
 *
 * HOW WIDE IT OPENS IS MEASURED, never chosen: the name is laid out in the pill and its own width
 * is what the plate opens to, so Russian and Thai get the room they need and Chinese does not carry
 * an allowance for them. A collapsed plate simply CLIPS the name, which is what makes it slide out
 * rather than fade in.
 */
function RailButton({ label, onPress, disabled, on, arrival, files, grow, repeat, cell, veiled, dim, tourTarget, children }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** In force: the drawing marks a held state by filling the same plate yellow. */
  on?: boolean;
  /** For a button its group only offers sometimes: how it comes and goes. Each target carries its
   *  own transition rather than replacing the button's, so the press feedback is untouched. */
  arrival?: { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition };
  /**
   * How many files the group this button stands in is running in.
   *
   * Given, the button TRAVELS to its new place rather than being redrawn there, and what counts as
   * a new place is this number together with the button's own cell: the group's shape decides where
   * column one is (a group grows leftward from the window's edge) and the cell decides which cell
   * of it this button has. Both move, and separately — a window folding the kit changes the files,
   * a view switch changes which button is the odd one out and moves that one alone.
   *
   * It is `layoutDependency` and not a bare `layout` because both groups re-render for reasons that
   * are not a reflow — an undo becoming available, a hover, every frame of a UI-zoom tween — and a
   * button that measured itself on those would animate the frame's own scaling.
   */
  files?: number;
  /** Which way the plate opens to give the button's name: into the map, away from the edge the
   *  button's group hangs on. In a folded group a right-file pill opens over its left neighbour and
   *  paints above it — `railCell` fills each row left to right, so the neighbour is always the
   *  earlier positioned sibling — and the cover is only ever paint, since the pill closes with the
   *  hover that opened it before the pointer can arrive where the word was. */
  grow: 'left' | 'right';
  /** Milliseconds between repeats while the button is held. Only for a STEPPER, whose action means
   *  something again each time it is done. */
  repeat?: number;
  /** Which cell of its group's grid this button stands in (`frame.ts:railCell`). */
  cell?: RailCell;
  /** Drawn and taken out of reach: the interface is hidden and this is not the way back. */
  veiled?: boolean;
  /** Standing on a bare map with nothing else around it, so it holds back until it is reached for. */
  dim?: boolean;
  /** The tour points at this button. It is the plate that is marked, not the group: a spotlight
   *  covering the whole kit would light six controls to explain one. */
  tourTarget?: TourTargetId;
  children: ReactNode;
}) {
  const reflow = useMotion('rail.group.reflow');
  const reach = useMotion('rail.name.reach');
  const zoomed = useZoomedLayoutTransform();
  const [hovered, setHovered] = useState(false);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [nameW, setNameW] = useState(0);
  // `scrollWidth` is the name's LAYOUT width, so the clip that hides it while the plate is closed
  // does not change the number. Re-measured on the word itself, which is what a language change is.
  useLayoutEffect(() => {
    const w = nameRef.current?.scrollWidth ?? 0;
    setNameW((was) => (Math.abs(was - w) < 0.5 ? was : w));
  }, [label]);

  const held = usePressRepeat({ action: onPress, intervalMs: repeat ?? 0 });
  // The pointer is on it. A DISABLED button is named explicitly rather than left to the browser:
  // no pointer event is delivered to one, so `hovered` cannot turn on, but a button that goes
  // disabled while the pointer rests on it (undo, running out of stack) gets no leave either.
  const reached = hovered && !disabled;
  const open = reached;
  const plateW = RAIL.button + (open ? nameW + RAIL.namePad : 0);
  // The end the plate is pinned to, and so the end everything it does happens away from: the pill
  // opens from it, the growth spreads from it, the press pulls back toward it. Anywhere else and
  // the glyph the pointer is on would be the thing that moves.
  const anchor = grow === 'left' ? 'right center' : 'left center';
  /** The whole of where this button stands: the group's shape and its cell of it. A layout
   *  animation answers to this and to nothing else. */
  const place = files === undefined ? undefined : `${files}:${cell?.column ?? 1}:${cell?.row ?? 1}`;
  const name = (
    <span
      ref={nameRef}
      style={{
        flex: 'none', whiteSpace: 'nowrap', color: on ? INK : PLATE_INK,
        fontSize: TEXT.tab, fontWeight: 800, lineHeight: 1,
        [grow === 'left' ? 'paddingLeft' : 'paddingRight']: RAIL.namePad,
      }}
    >
      {label}
    </span>
  );
  return (
    <motion.button
      type="button"
      {...(disabled ? {} : pressOnly)}
      {...arrival}
      {...(place === undefined ? {} : {
        layout: true,
        layoutDependency: place,
        transformTemplate: zoomed,
        transition: { ...pressable.transition, layout: reflow },
      })}
      {...(repeat === undefined || disabled ? { onClick: onPress } : held)}
      {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
      aria-label={label}
      // No `title`: the pill is this button's name, and a native tooltip arriving over it a second
      // later is the same word said twice in two type faces.
      disabled={disabled}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => { setHovered(false); if (repeat !== undefined && !disabled) held.onPointerLeave(); }}
      style={{
        ...btnReset,
        ...inGroup,
        position: 'relative',
        gridColumnStart: cell?.column,
        gridRowStart: cell?.row,
        width: RAIL.button, height: RAIL.button, borderRadius: 999,
        color: INK, flex: 'none',
        // ONE PROPERTY, ONE CLOCK. A button its group only offers sometimes fades itself through
        // Framer (`arrival`), which writes an opacity per frame, so a CSS transition on opacity
        // here is a second clock chasing every one of those writes: the turns blinked arriving and
        // popped off screen still half drawn leaving. The fade is on the DRAWING below; what stays
        // here is `visibility`, which is discrete, which Framer never touches, and which is the
        // half of the veil that takes a button out of hit-testing.
        visibility: veiled ? 'hidden' : 'visible',
        transition: veilTransition(!!veiled, 'visibility'),
        cursor: disabled ? cursors.blocked : cursors.clickable,
        transformOrigin: anchor,
      }}
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ width: plateW, scale: reached ? HOVER_SCALE : 1 }}
        transition={reach}
        style={{
          position: 'absolute', top: 0, [grow === 'left' ? 'right' : 'left']: 0,
          height: RAIL.button, borderRadius: 999, overflow: 'hidden',
          background: on ? ACTIVE : PLATE,
          display: 'flex', alignItems: 'center',
          // The button's whole ink, so the veil and the two dimmings are drawn here rather than on
          // the element (see its style above): a fade of the drawing is a fade of the button.
          opacity: veiled ? 0 : disabled ? 0.4 : dim && !hovered ? 0.45 : 1,
          transition: veilTransition(!!veiled, 'opacity'),
          // The drawing takes no pointer events, so the square underneath it is the whole of what
          // hit-testing sees whatever this shape is doing.
          pointerEvents: 'none',
          transformOrigin: anchor,
          // Anchored at the glyph's end, so what a closed plate clips off is the name and never the
          // drawing.
          justifyContent: grow === 'left' ? 'flex-end' : 'flex-start',
          // The hairline every drawing standing on the map wears, as the ring a radius box can
          // carry (`tokens.ts:plateShapeEdge`): a plate is a fill with no border, so this is what
          // keeps its shape against a bright sea. Not the dilation filter: WebKit smears that
          // filter's edge along the pill's path while the width animates, and draws it soft at any
          // density besides.
          boxShadow: plateShapeEdge(),
        }}
      >
        {grow === 'left' ? name : null}
        <span
          style={{
            width: RAIL.button, height: RAIL.button, flex: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {children}
        </span>
        {grow === 'right' ? name : null}
      </motion.span>
    </motion.button>
  );
}

/**
 * One step of the layer control: the top or the bottom half of the plate's single drawing.
 *
 * The design source draws both arrows as ONE shape, so each button shows its own half of that
 * drawing through a window. Halving it is exact — the two blobs meet at the drawing's midline — and
 * it is what lets a spent step dim on its own while the pair stays one picture.
 */
function LayerStep({ label, half, disabled, onPress }: {
  label: string;
  half: 'top' | 'bottom';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <motion.button
      type="button"
      {...(disabled ? {} : pressable)}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onPress}
      style={{
        ...btnReset, ...inGroup, flex: 1, width: '100%', position: 'relative', overflow: 'hidden',
        // Its own half of the plate's pill, so a focus ring follows the dome the eye sees rather
        // than boxing half a capsule. The pill's cap is a semicircle of half its width.
        borderRadius: half === 'top'
          ? `${RAIL.layer.w / 2}px ${RAIL.layer.w / 2}px 0 0`
          : `0 0 ${RAIL.layer.w / 2}px ${RAIL.layer.w / 2}px`,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? cursors.blocked : cursors.clickable,
      }}
    >
      <img
        src={layersPolygon}
        alt=""
        draggable={false}
        style={{
          position: 'absolute', left: '50%', height: RAIL.layer.glyph,
          // Measured from the plate's own edge, not the half's, so the drawing crosses the seam
          // between the two buttons exactly where its two blobs part.
          [half === 'top' ? 'top' : 'bottom']: (RAIL.layer.h - RAIL.layer.glyph) / 2,
          transform: 'translateX(-50%)',
        }}
      />
    </motion.button>
  );
}

/**
 * The layer control: which floor the brushes build on, and a step either side of it.
 *
 * The count stands to the LEFT of the plate and OUTSIDE it, on the map, which is unusual enough to
 * be worth saying: the design source draws a tall dark pill holding nothing but the two arrows, and
 * hangs the figure off its left edge in cream. So the plate is as narrow as the arrows need and the
 * number is free to be as long as a translation makes it.
 *
 * The count is also the way IN: the whole stack hangs off it (`LayerPanel`), which is what the
 * prototype asks for. So the two arrows step the build floor and the figure beside them opens
 * everything else about it.
 *
 * IT IS THE SMALLEST OF THREE SIZES AND IT IS THE ONE WITH NO ARROWS OF ITS OWN. The other two carry
 * a left and a right arrow at their head, which walk the ladder (`frame.ts:LAYER_MODES`). This one
 * cannot: the plate is a 28 px stadium already holding the two steps that are its whole job, and a
 * third control on it would be a third control on a control that has room for two. What it has
 * instead is the count, which is the way up and was already the way up. The pill's own arrows point
 * UP and DOWN and step the build floor; the head's point LEFT and RIGHT and change the size, so the
 * two pairs are never the same pair in a different place.
 *
 * The plate is CENTRED on the buttons below it rather than squared with their right edge
 * (`frame.ts:LAYER_STEP_RIGHT`), since it is narrower than they are and what a person reads down a
 * column of filled shapes is their middles.
 *
 * OPEN, THE PANEL IS THE CONTROL. The count and its steps are not drawn beside it — the panel says
 * which floor is active and every floor is a row you can press, so the collapsed pair would be a
 * second way to say one thing. The two groups below are placed from `RAIL_TOP` and the control's
 * DECLARED height, never from what is rendered here, so nothing in the column moves when this
 * swaps.
 *
 * AND WHERE THE ASSISTANT'S COLUMN REACHES IT, THE WORD KEEPS ONLY THE PART OF ITSELF THAT IS CLEAR
 * OF IT (`frame.ts:readoutPressLane`). The word grows leftward and the column rightward, so at a high
 * UI zoom the two meet; the press then belongs to whatever is standing under the pointer, which over
 * the panel is the panel. The count's own box is measured rather than derived, because its width is
 * its word's and a translation decides that.
 */
function LayerControl({ panelOpen, onOpen, veiled }: { panelOpen: boolean; onOpen: () => void; veiled: boolean }) {
  const t = useT();
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const displayLayer = useEditorStore((s) => s.displayLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const { place } = useDockStage();
  const shown = displayLayer ?? activeLayer;
  const step = (d: number) => setActiveLayer(Math.min(ELEVATION_MAX, Math.max(0, activeLayer + d)));
  const zoom = useFrameZoom();
  const countRef = useRef<HTMLButtonElement>(null);
  const [lane, setLane] = useState<number | null>(null);
  const word = layerName(t, shown);
  useLayoutEffect(() => {
    const measure = () => {
      const el = countRef.current;
      if (!el) { setLane(null); return; }
      const box = el.getBoundingClientRect();
      setLane(readoutPressLane(
        { left: box.left / zoom, width: box.width / zoom },
        // A DOCKED panel is at the other end of the window and the two can never meet, so the lane
        // is the word's own; free, it stands where this measurement is against.
        place === 'free' ? PANEL_RIGHT : null,
      ));
    };
    measure();
    // The lane is the room between two edges of the WINDOW, so a resize moves it with neither the
    // word nor the zoom changing.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [place, zoom, word, panelOpen]);
  return (
    <div style={{
      ...group, top: RAIL_TOP, right: LAYER_STEP_RIGHT, flexDirection: 'row', gap: RAIL.layer.gap,
      opacity: veiled ? 0 : 1,
      visibility: veiled ? 'hidden' : 'visible',
      transition: veilTransition(veiled),
    }}
    >
      {panelOpen ? null : (
        <>
          <motion.button
            ref={countRef}
            type="button"
            {...pressable}
            aria-label={t('layer.title')}
            aria-expanded={false}
            onClick={onOpen}
            // A stadium, which is the yellow pill this count wears once the panel is open: focus
            // shows the shape the press produces.
            style={{
              ...btnReset, ...inGroup, display: 'flex', borderRadius: 999, cursor: cursors.clickable,
              // Where a panel stands under part of the word the box itself goes deaf and the lane
              // below re-claims what is clear of it. The lane is a CHILD, so a press on it still
              // reaches this button's own `onClick`.
              ...(lane === null ? null : { position: 'relative', pointerEvents: 'none' }),
            }}
          >
            <span
              data-testid="shell-layer-readout"
              role="status"
              style={{
                ...MAP_LABEL,
                fontSize: TEXT.readout, fontWeight: 900, lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {word}
            </span>
            {lane !== null && lane > 0 && (
              <span
                data-testid="shell-layer-readout-press"
                aria-hidden
                // Never wider than the word itself: the air between the word and the panel is the
                // map's, exactly as the air inside a rail group is (`group`).
                style={{
                  position: 'absolute', top: 0, bottom: 0, right: 0, width: `min(100%, ${lane}px)`,
                  pointerEvents: 'auto', cursor: cursors.clickable,
                }}
              />
            )}
          </motion.button>
          <div
            style={{
              width: RAIL.layer.w, height: RAIL.layer.h, flex: 'none',
              display: 'flex', flexDirection: 'column',
              // No clip here: each step already clips its own half of the drawing, and a clip on
              // the plate would take a focused step's ring with it.
              background: DARK_PLATE, borderRadius: 999,
            }}
          >
            <LayerStep
              label={t('a11y.add_layer')}
              half="top"
              disabled={activeLayer >= ELEVATION_MAX}
              onPress={() => step(1)}
            />
            <LayerStep
              label={t('a11y.remove_layer')}
              half="bottom"
              disabled={activeLayer <= 0}
              onPress={() => step(-1)}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Undo and redo: two buttons, one pair, standing lower while the layer stack is over their lane and
 * side by side on a window too short for a file of them.
 *
 * IT FOLDS THE WAY THE KIT DOES, by the same rule and in the same plan (`frame.ts:RAIL_FOLDS`). Two
 * buttons is a small saving, so it is the second thing the column gives up rather than the first,
 * and a 2x1 row is the whole of its folding.
 *
 * THE TRAVEL IS SUPPRESSED WHILE THE UI SCALE MOVES. `top` is a computed length: every step of a
 * Ctrl +/- tween gives it a new number, and a transition on it plays that recomputation as though
 * the pair had been asked to move: undo and redo lag behind the rest of the frame and slide into
 * place after it, on a gesture that is not about them at all. The signal
 * is the one `scale.tsx` already drops its pixel rounding on (`useUiZooming`), and this is the same
 * class of problem: a thing that is right per frame and wrong across a scale change.
 */
function HistoryGroup({ top, files, veiled }: { top: number; files: number; veiled: boolean }) {
  const t = useT();
  const zooming = useUiZooming();
  const eventBus = useEditorStore((s) => s.eventBus);
  const [{ canUndo, canRedo }, setHistory] = useState({ canUndo: false, canRedo: false });
  useEffect(() => {
    const onHistory = (e: { canUndo: boolean; canRedo: boolean }) => setHistory({ canUndo: e.canUndo, canRedo: e.canRedo });
    eventBus.on('history-changed', onHistory);
    return () => eventBus.off('history-changed', onHistory);
  }, [eventBus]);
  return (
    <div
      data-testid="shell-rail-history"
      style={{
        ...group,
        top,
        // A grid, as the kit is, so the two fold into one row by the same property in the same
        // shape. At one file it is what the flex column was.
        display: 'grid',
        gridTemplateColumns: `repeat(${files}, ${RAIL.button}px)`,
        opacity: veiled ? 0 : 1,
        visibility: veiled ? 'hidden' : 'visible',
        // A plain CSS transition; `animations.css` collapses it under the reduced-motion attribute,
        // so the pair still arrives at the place the panel left it and simply does not travel there.
        // The veil is on the same declaration because an element has ONE `transition`, and a second
        // one written here would silently drop the travel this group is placed by.
        transition: [zooming ? '' : YIELD_TRANSITION, veilTransition(veiled)].filter(Boolean).join(', '),
      }}
    >
      <RailButton
        label={t('a11y.undo')}
        disabled={!canUndo}
        files={files}
        cell={railCell(0, HISTORY_BUTTONS, files)}
        grow="left"
        veiled={veiled}
        onPress={() => useEditorStore.getState().commandExecutor?.undo()}
      >
        <GlyphIcon glyph={GLYPHS.undo} size={RAIL.glyph} />
      </RailButton>
      <RailButton
        label={t('a11y.redo')}
        disabled={!canRedo}
        files={files}
        cell={railCell(1, HISTORY_BUTTONS, files)}
        grow="left"
        veiled={veiled}
        onPress={() => useEditorStore.getState().commandExecutor?.redo()}
      >
        <GlyphIcon glyph={GLYPHS.undo} size={RAIL.glyph} flip />
      </RailButton>
    </div>
  );
}

/** How far the camera turns per press of a yaw button, in the units `camera.orbit` takes (screen px
 *  of drag), which is the only turn verb both views answer to. */
const YAW_STEP = 60;

/**
 * Milliseconds between repeats while a STEPPER is held, and the wait before the first one.
 *
 * WHICH BUTTONS TAKE IT is decided by what they do, not by where they are. Zooming and turning are
 * steppers: each press moves the camera by a fixed amount and the same press again moves it again,
 * so holding is the short way of asking for several. The 2D/3D switch, fit-to-view and the hide
 * toggle take nothing — a held toggle flips back and forth and a held fit does what one press
 * already did, and an affordance that answers on some buttons of a row and not others teaches that
 * the row cannot be relied on. Here the three that decline are the three where a hold has no
 * meaning at all, which is the only reason a mixed row is legible.
 */
const STEP_REPEAT = 90;

/**
 * The two turns: which way each one's arrow points, and what each one is CALLED.
 *
 * A NAME THAT DOES NOT TELL THE PAIR APART IS NOT A NAME. These two differ in nothing but
 * direction, so they are the pair the pill exists for.
 *
 * Named from the VISITOR'S SIDE, which is the only side they can check. `camera.orbit` takes screen
 * px of drag, so a press here is the drag it names: `dir: 1` is a drag to the right, and what a
 * drag to the right does is carry the island the way the hand went. "Clockwise" would describe the
 * same turn from above, correctly, and ask a visitor to hold a camera path they cannot see and then
 * decide whether it is the camera or the island going round.
 */
const YAW_TURNS = [
  { dir: -1, flip: true, labelKey: 'a11y.rotate_left' },
  { dir: 1, flip: false, labelKey: 'a11y.rotate_right' },
] as const;

/** How far under its own size a yaw button starts and ends. The registry's amplitude is how far it
 *  travels, and this shape is that travel spent on a scale. */
const YAW_FROM = 1 - MOTIONS['rail.yaw.offer'].amplitude;

/** A yaw button coming and going, on one motion in both directions: it is one fact either way. The
 *  transition rides each target rather than the element, so the press feedback keeps its own. */
const yawArrival = (offer: Record<string, unknown>) => ({
  initial: { opacity: 0, scale: YAW_FROM },
  animate: { opacity: 1, scale: 1, transition: offer },
  exit: { opacity: 0, scale: YAW_FROM, transition: offer },
});

/**
 * The view kit: which view is showing, the camera nudges that belong to it, and the way to put the
 * whole interface away.
 *
 * THE HIDE TOGGLE IS ONE OF THE KIT'S BUTTONS, in the place the design source's own column gives it
 * (between the view switch and the camera nudges). It is a question about what you are looking at,
 * which is what this group answers, and it takes the group's size, plate, name pill and fold like
 * every other button in it.
 *
 * AND IT IS THE ONE THING LEFT STANDING when the interface is away. Everything else in the frame
 * goes, including the six buttons around it; this stays exactly where it was, so the way back is
 * the press that was the way out, in the place it was made. Dimmed until it is reached for, since
 * the point of hiding is an unobstructed map and a bright plate on bare sea is a thing standing in
 * front of it. A remnant is better than a key nobody was told about and better than "press
 * anything", which would make the hidden state unusable for the panning and looking it is for.
 */
function ViewKit({ plan, hidden, onHide }: { plan: RailPlan; hidden: boolean; onHide: () => void }) {
  const t = useT();
  const offer = useMotion('rail.yaw.offer');
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  // What the kit is SHOWING, which is not what it is planned for: the plan reserves room for the
  // full complement so nothing moves across a view switch, but the row that ends up short is the
  // one drawn, so the fill direction is answered against the buttons actually on screen.
  const shown = KIT_BUTTONS - (viewMode === '3d' ? 0 : YAW_TURNS.length);
  const cell = (i: number) => railCell(i, shown, plan.kitFiles);
  return (
    <div
      style={{
        ...group,
        top: plan.kitTop,
        // A GRID, filled row by row, which is one file when the column has room for one. Two files
        // of three would split the zoom pair and the yaw pair down the middle if it filled by file;
        // filled by row, each pair stays on its own line and the yaw arrows keep their two sides.
        // Every cell is NAMED (`frame.ts:railCell`) rather than flowed, so a pair on its way out
        // cannot re-place the row it is leaving from.
        display: 'grid',
        gridTemplateColumns: `repeat(${plan.kitFiles}, ${RAIL.button}px)`,
      }}
    >
      {/* The drawing marks the 3D view by filling this plate yellow, so the toggle is one button in
          two states rather than a pair of switches. */}
      <RailButton
        label={t('a11y.toggle_view')}
        on={viewMode === '3d'}
        files={plan.kitFiles}
        cell={cell(0)}
        grow="left"
        veiled={hidden}
        tourTarget="view3d"
        onPress={() => setViewMode(viewMode === '3d' ? '2d' : '3d')}
      >
        <span style={{ fontSize: RAIL.viewLabel, fontWeight: 900, color: INK }}>{viewMode.toUpperCase()}</span>
      </RailButton>
      <RailButton
        label={t(hidden ? 'a11y.show_ui' : 'a11y.hide_ui')}
        files={plan.kitFiles}
        cell={cell(1)}
        grow="left"
        dim={hidden}
        onPress={onHide}
      >
        <GlyphIcon glyph={GLYPHS.hideUi} size={RAIL.glyph} />
      </RailButton>
      {/* The design source drew no fit-to-view glyph, so this is the app's own stroke icon. A text
          arrow would render as flat type on one platform and as colour emoji on the next. */}
      <RailButton
        label={t('a11y.fit_view')}
        files={plan.kitFiles}
        cell={cell(2)}
        grow="left"
        veiled={hidden}
        onPress={() => host.camera.fit()}
      >
        <FitIcon />
      </RailButton>
      <RailButton
        label={t('a11y.zoom_in')}
        files={plan.kitFiles}
        cell={cell(3)}
        grow="left"
        repeat={STEP_REPEAT}
        veiled={hidden}
        onPress={() => host.camera.zoomIn()}
      >
        <GlyphIcon glyph={GLYPHS.zoomIn} size={RAIL.glyph} />
      </RailButton>
      <RailButton
        label={t('a11y.zoom_out')}
        files={plan.kitFiles}
        cell={cell(4)}
        grow="left"
        repeat={STEP_REPEAT}
        veiled={hidden}
        onPress={() => host.camera.zoomOut()}
      >
        <GlyphIcon glyph={GLYPHS.zoomOut} size={RAIL.glyph} />
      </RailButton>
      {/*
        THE TWO TURNS ARRIVE AND LEAVE, rather than blinking with the view.

        They can, because the kit is planned for its full complement whichever view is showing
        (`frame.ts:planRail` counts `KIT_BUTTONS`): the grid hangs by its top and these two stand in
        its last row, so a pair that is still leaving holds the cells it already had and nothing
        above it moves. The kit's height cannot wobble here, and it must not, since the column hangs
        off the shelf's floor and a wobble there reads as the whole column moving.

        HOLDING THE CELLS IS WHAT `railCell` IS FOR. A leaving button is mounted, so grid
        auto-placement counted it and shuffled the cells of the buttons around it as it went: in two
        files a turn mid-fade dropped a row and jumped a column, and zoom-out changed columns without
        travelling. Now both are named cells: zoom-out TRAVELS across (its cell changed, which is what
        `layoutDependency` reads), the leaving turn stays exactly where it was drawn, and the two
        share the cell for the length of the fade.

        Each button is its own keyed child rather than a fragment: a fragment is not something
        `AnimatePresence` can hold open, and a wrapper around the pair would be one grid cell and
        would break the two-file arrangement a short window puts them in.
      */}
      <AnimatePresence initial={false}>
        {viewMode === '3d' ? YAW_TURNS.map(({ dir, flip, labelKey }) => (
          <RailButton
            key={dir}
            label={t(labelKey)}
            arrival={yawArrival(offer)}
            files={plan.kitFiles}
            cell={cell(KIT_BUTTONS - YAW_TURNS.length + YAW_TURNS.findIndex((y) => y.dir === dir))}
            grow="left"
            repeat={STEP_REPEAT}
            veiled={hidden}
            onPress={() => getActiveView()?.camera.orbit?.(dir * YAW_STEP, 0)}
          >
            <GlyphIcon glyph={GLYPHS.rotate} size={RAIL.glyph} flip={flip} />
          </RailButton>
        )) : null}
      </AnimatePresence>
    </div>
  );
}

export function Rail({ hidden, onHide }: { hidden: boolean; onHide: () => void }) {
  // The layer control's SIZE lives up here because it places every group, not one: the panel
  // replaces the control, and how deep it draws decides where the other two go.
  const [mode, setMode] = useState<LayerMode>('pill');
  // The window's own height, in the px the frame is laid out in.
  const zoom = useFrameZoom();
  const vh = useViewportHeight() / zoom;
  /**
   * OPENING IS ONE STEP OF THE LADDER, and the count is the rung below the file.
   *
   * The three sizes are one control (`frame.ts:LAYER_MODES`), so the way in is the way the arrows
   * go: pill, then file, then square. Opening onto whichever of the two the window happens to have
   * room for makes the ladder skip its middle rung on a tall monitor and not on a laptop, so one
   * press gives two different panels and the file can only be reached by stepping back down to it.
   * What size the window can hold is still the plan's answer, and it is still what decides where the
   * plate STANDS (`planRail`) — but it decides that for whichever size the visitor has walked to,
   * rather than deciding which one they get.
   */
  const openPanel = useCallback(() => setMode('column'), []);
  const plan = planRail(vh, { open: mode !== 'pill', plateDepth: plateDepth(mode) });
  return (
    <>
      <LayerControl panelOpen={mode !== 'pill'} onOpen={openPanel} veiled={hidden} />
      {/* A SIBLING OF THE THREE GROUPS, not a child of the one it replaces. A group carries a
          z-index, so it is a stacking context, and a plate nested inside one is ordered against its
          siblings INSIDE it however high its own z-index is: the buttons of the next group along
          then painted over the plate, and cut through the tiles at its right edge. */}
      <LayerPanel
        mode={mode}
        onMode={setMode}
        right={plan.plateRight}
        maxHeight={plan.plateMaxH}
        veiled={hidden}
      />
      <HistoryGroup top={plan.historyTop} files={plan.historyFiles} veiled={hidden} />
      <ViewKit plan={plan} hidden={hidden} onHide={onHide} />
    </>
  );
}
