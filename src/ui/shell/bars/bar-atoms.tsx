import { useToolbarContext } from '../use-toolbar-context';
/*
 * bar-atoms.tsx — the pieces every bottom bar is built from.
 *
 * A bar is drawn art plus text over it, at design coordinates. Two things it needs that the frame
 * does not: the bars hang off the BOTTOM edge (the design canvas maps onto viewport HEIGHT, but the
 * cap, the touch boost and the UI zoom all leave the canvas's own bottom above the viewport's, so a
 * bar placed by its design `top` would float), and their labels are live strings in seven languages
 * rather than baked art.
 */
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { effectiveCombo, useKeybinds } from '../../../core/runtime/keybindings';
import { CANVAS, usePx } from '../../design/scale';
import { prettyCombo } from '../../../core/runtime/keybindings';
import { MAP_LABEL, ON_DARK } from '../../design/tokens';
import { SCALE, TEXT } from '../units';
import { useMotion } from '../motion/use-motion';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { BADGE, PLATE_ART, plateRight, type ArtPart } from './terrain-cells';

/** Design y of a box's top → its distance from the design canvas's bottom edge. */
export function fromBottom(y: number, h: number): number {
  return CANVAS.h - (y + h);
}


/** One layer of a glyph, placed against an origin its parent box sits at. */
export function Art({ part, ox, oy }: { part: ArtPart; ox: number; oy: number }) {
  const { px } = usePx();
  return (
    <img
      src={part.src}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        left: px(part.x - ox),
        top: px(part.y - oy),
        width: px(part.w),
        height: px(part.h),
        pointerEvents: 'none',
      }}
    />
  );
}

/** A plate or any other single drawn shape, filling the box its parent gives it. */
export function Plate({ src, style }: { src: string; style: CSSProperties }) {
  return <img src={src} alt="" draggable={false} style={{ position: 'absolute', pointerEvents: 'none', ...style }} />;
}

/**
 * The keyboard shortcut a cell wears, on the top-right corner of the PLATE it is standing on.
 *
 * IT HANGS OFF THE PLATE'S RIGHT EDGE, NOT OFF A NUMBER. That edge is the one thing about a cell
 * that moves: the plate grows past the box as the chosen one, and it opens into a pill around a
 * setting that is 87 css px wider in Indonesian than in English. A badge placed from the left, at
 * whatever offset, cannot follow a right edge: it stays where it was put as the pill opens around
 * it. `plateRight` is the edge, css does the following, and the badge's own
 * box is anchored by its right side so a two-key combo grows into the plate rather than off it.
 *
 * The VERTICAL is the cell's, not the plate's: the badge overhangs the row's top line by
 * `BADGE.rise` and stays there, so choosing a cell does not lift its badge out of the row.
 *
 * It travels on the plate's own motion, since the two are one corner and a badge that jumped while
 * the shape under it sprang would come apart mid-press.
 *
 * Both kinds of cell in the terrain row draw it: the seven tools and smart build. The binding is
 * read LIVE (`effectiveCombo`), the way the keyboard page reads it, so a rebind shows here with no
 * wiring, and a command with no binding shows nothing at all.
 */
export function ShortcutBadge({ commandId, active = false, grown = false }: {
  commandId: string;
  /** Whether the cell under it is the chosen one, and whether that cell's plate has opened into a
   *  pill around a control. Both only say which SHAPE the plate is; the badge reads its edge off
   *  the same description the plate is drawn from. */
  active?: boolean;
  grown?: boolean;
}) {
  const overrides = useKeybinds((s) => s.overrides);
  const shape = useMotion('tool.plate.shape');
  const context = useToolbarContext();
  const combo = effectiveCombo(overrides, commandId, context);
  if (!combo) return null;
  return (
    <motion.span
      initial={false}
      animate={{ right: plateRight(active, grown) }}
      transition={shape}
      style={{
        position: 'absolute', top: -BADGE.rise * SCALE, pointerEvents: 'none',
        minWidth: BADGE.w * SCALE, height: BADGE.h * SCALE, padding: '0 4px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Plate src={PLATE_ART.badge} style={{ inset: 0, width: '100%', height: '100%' }} />
      <BarText size={TEXT.small} color={ON_DARK} weight={900} style={{ position: 'relative' }}>
        {prettyCombo(combo)}
      </BarText>
    </motion.span>
  );
}

/**
 * A label. Its size is a CONSTANT in css px and its box is as wide as the words need: no shrink to
 * fit, in either direction. A label that shrinks to hold its box is how "Естественность" ends up at
 * a third the size of the "100%" beside it, unreadable, while the row it sits in looks tidy. The
 * row is what gives instead — it flows, wraps or scrolls — so every language reads at one size.
 *
 * Flex, always: the text then sits in its own box rather than on a line box shared with the host's
 * unscaled strut.
 *
 * A label sits on ONE of two things and says which: a plate, and then it takes that plate's ink as
 * `color`, or the MAP, and then it takes `onMap` — the warm off-white and the thin dark outline
 * that stand in for the plate it does not have.
 */
export function BarText({
  size, color, onMap, weight = 800, align = 'center', style, children,
}: {
  /** css px, from `units.ts:TEXT` — a role, not a measurement of the slot. */
  size: number;
  color?: string;
  onMap?: boolean;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  style?: CSSProperties;
  children: ReactNode;
}) {
  const weightAt = useFrameReadableWeight();
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        pointerEvents: 'none',
        fontSize: size,
        fontWeight: weightAt(weight, size),
        whiteSpace: 'nowrap',
        lineHeight: 1.15,
        ...(onMap ? MAP_LABEL : null),
        ...(color ? { color } : null),
        ...style,
      }}
    >
      {children}
    </span>
  );
}
