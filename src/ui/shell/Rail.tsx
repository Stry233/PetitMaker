/**
 * Right-edge layer, history, and view controls. `planRail` owns their responsive placement,
 * including folded layouts and room for the layer panel. Hover labels open toward the map without
 * moving their button targets; zoom and rotation controls repeat while held.
 */
import {
  useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode,
} from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotionConfig, type AnimationPlaybackControls, type TargetAndTransition } from 'framer-motion';
import { getActiveView } from '../../canvas/active-view';
import { tourTargetAttr, type TourTargetId } from '../chrome/tour/steps';
import { helpTargetAttr } from '../chrome/modals/help/targets';
import type { HelpPageId } from '../chrome/modals/help/page-schema';
import { ELEVATION_MAX } from '../../core/model/constants';
import { hasWebGL2 } from '../../core/runtime/device-quality';
import { showToast } from '../chrome/floating/Toast';
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
  LAYERS_STACK_SRC, railCell, RAIL_TOP, readoutPressLane, viewKitCell,
  type RailCell, type RailPlan,
} from './frame';
import { GlyphIcon } from './GlyphIcon';
import { LayerPanel } from './windows/LayerPanel';
import { FrameLayoutProvider, useFrameLayout } from './frame-layout';
import { CSS_CURVES } from './motion/curves';
import { MOTIONS } from './motion/registry';
import { cssMotion, useMotion } from './motion/use-motion';
import { useDockStage } from './use-dock';
import { ACTIVE, DARK_PLATE, INK, MAP_LABEL, PLATE, PLATE_INK, plateShapeEdge } from '../design/tokens';
import { PANEL_RIGHT } from './panel-frame';
import { useFrameZoom, useFrameReadableWeight } from './use-frame-zoom';
import { EDGE_RIGHT, RAIL, TEXT } from './units';
import { visualRect } from '../design/visual-rect';


/** Apply the frame veil clock to caller-owned CSS properties. */
const veilTransition = (hidden: boolean, ...properties: string[]) =>
  cssMotion(hidden ? 'frame.veil' : 'frame.unveil', ...properties);

/** How the pair travels between its two places. */
const YIELD_MOTION = MOTIONS['rail.history.yield'];
const YIELD_TRANSITION = `top ${YIELD_MOTION.duration}s ${CSS_CURVES[YIELD_MOTION.curve]}`;

/** Size the fit-to-view icon by its visible ink rather than its source box. */
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
  // Only controls reclaim pointer events; empty grid cells and gaps must pass through to the map.
  pointerEvents: 'none',
};

/** What a control inside a group re-claims, the air around it having given it up. */
const inGroup: CSSProperties = { pointerEvents: 'auto' };

/** How much bigger a button draws itself while the pointer is on it, taken from the hover every
 *  other button in the app answers with (`styles.ts:pressable`) rather than restated, so the rail
 *  acknowledges a pointer by the same amount the modals and the mode blocks do. */
const HOVER_SCALE = pressable.whileHover.scale;

/** Animate discrete reflow in local units while continuous CSS zoom follows the frame directly. */
function useRailReflow(x: number, y: number, place: string, enabled = true) {
  const dx = useMotionValue(0), dy = useMotionValue(0);
  const previous = useRef<{ x: number; y: number; place: string }>();
  const running = useRef<AnimationPlaybackControls[]>([]);
  const reduced = useReducedMotionConfig();
  const transition = useMotion('rail.group.reflow');
  useLayoutEffect(() => {
    const before = previous.current;
    if (reduced) {
      running.current.forEach(animation => animation.stop());
      running.current = [];
      dx.set(0);
      dy.set(0);
    } else if (enabled && before && before.place !== place) {
      running.current.forEach(animation => animation.stop());
      // Rebase without turning the coordinate change into spring velocity.
      dx.jump(dx.get() + before.x - x);
      dy.jump(dy.get() + before.y - y);
      running.current = [animate(dx, 0, transition), animate(dy, 0, transition)];
    }
    previous.current = { x, y, place };
  });
  useEffect(() => () => running.current.forEach(animation => animation.stop()), []);
  return { x: dx, y: dy };
}

/**
 * Round rail control with a fixed hit box and a pointer-transparent animated plate. Keeping hit
 * testing off the growing plate prevents hover oscillation and layout shifts. The plate and its
 * measured, localized label share one spring and open toward the map without moving the glyph.
 */
function RailButton({ label, onPress, disabled, on, arrival, files, grow, repeat, cell, veiled, dim, unavailable, tourTarget, helpTarget, children }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** In force: the drawing marks a held state by filling the same plate yellow. */
  on?: boolean;
  /** For a button its group only offers sometimes: how it comes and goes. Each target carries its
   *  own transition rather than replacing the button's, so the press feedback is untouched. */
  arrival?: { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition };
  /** Grid column count used to animate changes to this button's cell. */
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
  /** The device cannot do what this button offers. It stays pressable so the press can say why. */
  unavailable?: boolean;
  /** The tour points at this button. It is the plate that is marked, not the group: a spotlight
   *  covering the whole kit would light six controls to explain one. */
  tourTarget?: TourTargetId;
  helpTarget?: HelpPageId;
  children: ReactNode;
}) {
  const weightAt = useFrameReadableWeight();
  const reach = useMotion('rail.name.reach');
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
  // Only discrete cell changes animate; scaling keeps the local coordinates unchanged.
  const place = `${files ?? 1}:${cell?.column ?? 1}:${cell?.row ?? 1}`;
  const offset = useRailReflow(((cell?.column ?? 1) - (files ?? 1)) * (RAIL.button + RAIL.gap),
    ((cell?.row ?? 1) - 1) * (RAIL.button + RAIL.gap), place);
  const name = (
    <span
      ref={nameRef}
      style={{
        flex: 'none', whiteSpace: 'nowrap', color: on ? INK : PLATE_INK,
        fontSize: TEXT.tab, fontWeight: weightAt(800, TEXT.tab), lineHeight: 1,
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
      {...(repeat === undefined || disabled ? { onClick: onPress } : held)}
      {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
      {...(helpTarget ? helpTargetAttr(helpTarget) : {})}
      aria-label={label}
      // No `title`: the pill is this button's name, and a native tooltip arriving over it a second
      // later is the same word said twice in two type faces.
      disabled={disabled}
      {...(unavailable ? { 'aria-disabled': true } : {})}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => { setHovered(false); if (repeat !== undefined && !disabled) held.onPointerLeave(); }}
      style={{
        ...btnReset,
        ...inGroup,
        ...offset,
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
        cursor: disabled || unavailable ? cursors.blocked : cursors.clickable,
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
          opacity: veiled ? 0 : disabled || unavailable ? 0.4 : dim && !hovered ? 0.45 : 1,
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
        src={LAYERS_STACK_SRC}
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
 * Layer stepper and panel trigger. The localized count sits outside the narrow arrow plate and is
 * measured to keep its press lane clear of the assistant column. Opening the panel replaces this
 * control without moving the rail groups below it.
 */
function LayerControl({ panelOpen, onOpen, veiled }: { panelOpen: boolean; onOpen: () => void; veiled: boolean }) {
  const weightAt = useFrameReadableWeight();
  const t = useT();
  const layout = useFrameLayout();
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const displayLayer = useEditorStore((s) => s.displayLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const assistantOpen = useEditorStore((s) => s.assistantOpen);
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
      const box = visualRect(el);
      setLane(readoutPressLane(
        { left: box.left / zoom, width: box.width / zoom },
        // A DOCKED panel is at the other end of the window and the two can never meet, so the lane
        // is the word's own; free, it stands where this measurement is against.
        assistantOpen && place === 'free' ? PANEL_RIGHT : null,
      ));
    };
    measure();
    // The lane is the room between two edges of the WINDOW, so a resize moves it with neither the
    // word nor the zoom changing.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [place, zoom, word, panelOpen, assistantOpen]);
  return (
    <div
      data-testid="shell-layer-control"
      {...helpTargetAttr('layers')}
      style={{
        ...group, top: layout?.railTop ?? RAIL_TOP, right: (layout?.edgeRight ?? EDGE_RIGHT) + LAYER_STEP_RIGHT - EDGE_RIGHT, flexDirection: 'row', gap: RAIL.layer.gap,
        opacity: veiled ? 0 : 1,
        visibility: veiled ? 'hidden' : 'visible',
        transition: [veilTransition(veiled), cssMotion('frame.layout.adapt', 'top')].join(', '),
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
                fontSize: TEXT.readout, fontWeight: weightAt(900, TEXT.readout), lineHeight: 1,
                whiteSpace: 'nowrap',
                ...(layout?.compact ? { maxWidth: RAIL.button * 2.5, overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
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
                  position: 'absolute', top: 0, bottom: 0, right: 0, width: '100%', maxWidth: lane,
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

/** History follows continuous zoom directly; only discrete group reflows receive an offset tween. */
function HistoryGroup({ top, right, files, placement, veiled }: { top: number; right: number; files: number; placement: string; veiled: boolean }) {
  const t = useT();
  const zooming = useUiZooming();
  const offset = useRailReflow(0, top, placement, zooming);
  const eventBus = useEditorStore((s) => s.eventBus);
  const [{ canUndo, canRedo }, setHistory] = useState({ canUndo: false, canRedo: false });
  useEffect(() => {
    const onHistory = (e: { canUndo: boolean; canRedo: boolean }) => setHistory({ canUndo: e.canUndo, canRedo: e.canRedo });
    eventBus.on('history-changed', onHistory);
    return () => eventBus.off('history-changed', onHistory);
  }, [eventBus]);
  return (
    <motion.div
      data-testid="shell-rail-history"
      style={{
        ...group,
        ...offset,
        top,
        right,
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
        transition: [zooming ? '' : `${YIELD_TRANSITION}, ${cssMotion('frame.layout.adapt', 'right')}`, veilTransition(veiled)].filter(Boolean).join(', '),
      }}
    >
      <RailButton
        label={t('a11y.undo')}
        helpTarget="undo"
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
        helpTarget="undo"
        disabled={!canRedo}
        files={files}
        cell={railCell(1, HISTORY_BUTTONS, files)}
        grow="left"
        veiled={veiled}
        onPress={() => useEditorStore.getState().commandExecutor?.redo()}
      >
        <GlyphIcon glyph={GLYPHS.undo} size={RAIL.glyph} flip />
      </RailButton>
    </motion.div>
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
 * drag to the right does is carry the planet the way the hand went. "Clockwise" would describe the
 * same turn from above, correctly, and ask a visitor to hold a camera path they cannot see and then
 * decide whether it is the camera or the planet going round.
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
function ViewKit({ plan, right, hidden, onHide }: { plan: RailPlan; right: number; hidden: boolean; onHide: () => void }) {
  const t = useT();
  const zooming = useUiZooming();
  const weightAt = useFrameReadableWeight();
  const offer = useMotion('rail.yaw.offer');
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const webgl2 = hasWebGL2();
  // What the kit is SHOWING, which is not what it is planned for: the plan reserves room for the
  // full complement so nothing moves across a view switch, but the row that ends up short is the
  // one drawn, so the fill direction is answered against the buttons actually on screen.
  const shown = KIT_BUTTONS - (viewMode === '3d' ? 0 : YAW_TURNS.length);
  const cell = (i: number) => viewKitCell(i, shown, plan.kitFiles);
  const offset = useRailReflow(0, plan.kitTop, String(plan.kitFiles), zooming);
  return (
    <motion.div
      data-testid="shell-view-kit"
      {...helpTargetAttr('camera')}
      style={{
        ...group,
        ...offset,
        top: plan.kitTop, right,
        transition: zooming ? undefined : cssMotion('frame.layout.adapt', 'top', 'right'),
        // Explicit cells keep exiting yaw buttons from reflowing the remaining controls.
        display: 'grid',
        gridTemplateColumns: `repeat(${plan.kitFiles}, ${RAIL.button}px)`,
      }}
    >
      {/* The drawing marks the 3D view by filling this plate yellow, so the toggle is one button in
          two states rather than a pair of switches. */}
      <RailButton
        label={t('a11y.toggle_view')}
        helpTarget="camera"
        on={viewMode === '3d'}
        files={plan.kitFiles}
        cell={cell(0)}
        grow="left"
        veiled={hidden}
        unavailable={!webgl2}
        tourTarget="view3d"
        onPress={() => {
          // Without WebGL2 the scene build throws and the view returns to 2D; the press says that
          // instead of making the round trip.
          if (!webgl2) { showToast(t('view3d.unavailable'), 'error'); return; }
          setViewMode(viewMode === '3d' ? '2d' : '3d');
        }}
      >
        <span style={{ fontSize: RAIL.viewLabel, fontWeight: weightAt(900, RAIL.viewLabel), color: INK }}>{viewMode.toUpperCase()}</span>
      </RailButton>
      <RailButton
        label={t(hidden ? 'a11y.show_ui' : 'a11y.hide_ui')}
        helpTarget="frame"
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
        travelling. Both occupy explicit cells: zoom-out animates its cell change, the leaving turn
        stays exactly where it was drawn, and the two
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
    </motion.div>
  );
}

export function Rail({ hidden, onHide }: { hidden: boolean; onHide: () => void }) {
  const layout = useFrameLayout();
  if (!layout) return <FrameLayoutProvider><Rail hidden={hidden} onHide={onHide} /></FrameLayoutProvider>;
  const { layerMode: mode, setLayerMode: setMode, rail: plan } = layout;
  return (
    <>
      <LayerControl panelOpen={mode !== 'pill'} onOpen={() => setMode('column')} veiled={hidden} />
      {/* A SIBLING OF THE THREE GROUPS, not a child of the one it replaces. A group carries a
          z-index, so it is a stacking context, and a plate nested inside one is ordered against its
          siblings INSIDE it however high its own z-index is: the buttons of the next group along
          then painted over the plate, and cut through the tiles at its right edge. */}
      <LayerPanel
        mode={mode}
        onMode={setMode}
        right={plan.plateRight}
        top={layout.plateTop}
        maxWidth={layout.plateMaxWidth}
        maxHeight={plan.plateMaxH}
        veiled={hidden}
      />
      <HistoryGroup top={plan.historyTop} right={layout.edgeRight} files={plan.historyFiles}
        placement={`${plan.kitFiles}:${plan.historyFiles}:${layout.cornerTop}`} veiled={hidden} />
      <ViewKit plan={plan} right={layout.edgeRight} hidden={hidden} onHide={onHide} />
    </>
  );
}
