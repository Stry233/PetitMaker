/** A rail button and the group it stands in, shared by the rail's three groups. */
import { ActionButton } from '../../primitives/ActionButton';
import {
  useRef, useState, type CSSProperties, type ReactNode,
} from 'react';
import { motion, type TargetAndTransition } from 'framer-motion';
import { tourTargetAttr, type TourTargetId } from '../../chrome/tour/steps';
import { helpTargetAttr } from '../../session/help-targets';
import type { HelpPageId } from '../../help/page-schema';
import { btnReset, cursors, pressable, z, radii, UNAVAILABLE } from '../../design/styles';
import { usePressRepeat } from './use-press-repeat';
import {
  type RailCell, } from '../frame';
import { useTransition } from '../../design/motion/use-motion';
import { cssMotion } from '../../design/motion';
import { ACTIVE, INK, PLATE, PLATE_INK, plateShapeEdge } from '../../design/tokens';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { EDGE_RIGHT, RAIL, TEXT } from '../units';
import { useLocalReflow } from './use-local-reflow';
import { useNaturalWidth } from './use-natural-width';

/** Apply the frame veil clock to caller-owned CSS properties. */
export const veilTransition = (hidden: boolean, ...properties: string[]) =>
  cssMotion(hidden ? 'frame.veil' : 'frame.unveil', [...properties]);
/** A group: a column against the right edge, its members close enough to read as one thing. */
export const group: CSSProperties = {
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
export const inGroup: CSSProperties = { pointerEvents: 'auto' };
/** How much bigger a button draws itself while the pointer is on it, taken from the hover every
 *  other button in the app answers with (`styles.ts:pressable`) rather than restated, so the rail
 *  acknowledges a pointer by the same amount the modals and the mode blocks do. */
export const HOVER_SCALE = pressable.whileHover.scale;
/** Rail cells and groups glide between discrete reflows on the rail's own reflow motion. */
export const useRailReflow = (x: number, y: number, place: string, enabled = true) => useLocalReflow(x, y, place, { motionId: 'rail.group.reflow', enabled });
/**
 * A round rail control: a fixed hit box under a pointer-transparent plate that grows with its localized
 * name toward the map, the glyph never moving.
 */
export function RailButton({ label, onPress, disabled, on, arrival, files, grow, repeat, cell, veiled, dim, unavailable, tourTarget, helpTarget, children }: {
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
  /**
   * Which way the name opens: away from the edge the group hangs on. In a folded group the pill paints over
   * its earlier neighbour and closes before the pointer can reach the word.
   */
  grow: 'left' | 'right';
  /** Milliseconds between repeats while the button is held. Only for a stepper, whose action means
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
  const reach = useTransition('rail.name.reach');
  const [hovered, setHovered] = useState(false);
  const nameRef = useRef<HTMLSpanElement>(null);
  // Re-measured on the word itself, which is what a language change is.
  const nameW = useNaturalWidth(nameRef, label, 0.5);

  const held = usePressRepeat({ action: onPress, intervalMs: repeat ?? 0 });
  // The pointer is on it. A disabled button is named explicitly rather than left to the browser:
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
    <ActionButton
      interaction="tap" dim="caller"
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
        width: RAIL.button, height: RAIL.button, borderRadius: radii.pill,
        color: INK, flex: 'none',
        // Visibility only on the button: Framer drives the arriving opacity on the drawing, so a CSS opacity
        // transition here would be a second clock.
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
          height: RAIL.button, borderRadius: radii.pill, overflow: 'hidden',
          background: on ? ACTIVE : PLATE,
          display: 'flex', alignItems: 'center',
          // The button's whole ink, so the veil and the two dimmings are drawn here rather than on
          // the element (see its style above): a fade of the drawing is a fade of the button.
          opacity: veiled ? 0 : disabled || unavailable ? UNAVAILABLE : dim && !hovered ? 0.45 : 1,
          transition: veilTransition(!!veiled, 'opacity'),
          // The drawing takes no pointer events, so the square underneath it is the whole of what
          // hit-testing sees whatever this shape is doing.
          pointerEvents: 'none',
          transformOrigin: anchor,
          // Anchored at the glyph's end, so what a closed plate clips off is the name and never the
          // drawing.
          justifyContent: grow === 'left' ? 'flex-end' : 'flex-start',
          // The map hairline as the plate's ring (`plateShapeEdge`); the dilation filter smears in WebKit as the width animates.
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
    </ActionButton>
  );
}
