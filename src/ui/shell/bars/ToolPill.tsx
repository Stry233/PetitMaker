import { tourTargetAttr, type TourTargetId } from '../../chrome/tour/steps';
import { presence } from '../../design/motion';
import { helpAttributes, type HelpTarget } from '../../primitives/help-target';
import { ActionButton } from '../../primitives/ActionButton';
import { MapCaption } from './MapCaption';
import { useLayoutEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useNameReveal } from '../../primitives/use-name-reveal';
import { TouchReach } from '../../primitives/TouchReach';
import { useFrameZoom } from '../use-frame-zoom';
import { btnReset, cursors, radii } from '../../design/styles';
import { ACTIVE, PLATE } from '../../design/tokens';
import { GlyphIcon } from '../GlyphIcon';
import type { Glyph } from '../frame';
import { useTransition } from '../../design/motion/use-motion';
import { QUAD, SCALE, TEXT } from '../units';
import { BAR_LINE_HEIGHT, BarText, ShortcutBadge, useCommandTitle } from './bar-atoms';
import { hoverBleed } from './swatch-strip';
import { BADGE, PILL_H, PLATE_PAD, CELL_BOX, commandLabel, toolCell } from './terrain-cells';
import type { ContentType } from '../../../state/editing/edit-mode';
import { useT } from '../../../i18n/context';
import { useObjectKey } from '../../primitives/use-object-key';

const TOOL_PILL_WIDTH = 170 * SCALE;
const TOOL_PILL_GROWTH = 30 * SCALE;

export const TOOL_PILL_GAP = 8;

/** How far an armed pill's caption reaches past its row's ends while that pill grows or shrinks: the
 *  caption fits the grown pill, and an ungrown pill's centre stands half the growth nearer its end. */
export const CAPTION_SWAY = TOOL_PILL_GROWTH / 2;

export function toolPillCentre(index: number, activeIndex: number): number {
  return QUAD.left + index * (TOOL_PILL_WIDTH + TOOL_PILL_GAP) + TOOL_PILL_WIDTH / 2
    + (activeIndex >= 0 && activeIndex < index ? TOOL_PILL_GROWTH : 0)
    + (activeIndex === index ? TOOL_PILL_GROWTH / 2 : 0);
}

/** The plate an inactive pill stands on, and the same cream with no body, so the armed plate under
 *  the row shows through the armed pill. */
const PLATE_CLEAR = `${PLATE}00`;

/**
 * The armed tool's plate, one element under the whole pill row, sliding to the pill just chosen.
 * Pills are uniform except the armed one's growth, so its place follows from its index alone.
 */
export function ToolHighlight({ index }: { index: number }) {
  const slide = useTransition('tool.highlight.slide');
  const shown = index >= 0;
  const wasShown = useRef(shown);
  const lastAt = useRef(Math.max(0, index));
  const at = shown ? index : lastAt.current;
  // Appearing from nothing armed starts on the pill itself rather than sliding in from the last one.
  const arriving = shown && !wasShown.current;
  useLayoutEffect(() => { wasShown.current = shown; if (shown) lastAt.current = index; });
  const place = { duration: 0 };
  return <motion.span data-tool-highlight aria-hidden initial={false}
    animate={{ left: at * (TOOL_PILL_WIDTH + TOOL_PILL_GAP), opacity: shown ? 1 : 0 }}
    transition={arriving ? { ...slide, left: place } : slide}
    style={{ position: 'absolute', top: -PLATE_PAD.y, height: PILL_H, width: TOOL_PILL_WIDTH + TOOL_PILL_GROWTH,
      borderRadius: radii.pill, background: ACTIVE, pointerEvents: 'none' }}/>;
}

/** Where a toolbar control's caption stands, under its plate. */
export const CAPTION_TOP = CELL_BOX.h + PLATE_PAD.y + 5;

/** How far a caption reaches under its control's box. */
export const CAPTION_HANG = CAPTION_TOP - CELL_BOX.h + TEXT.label * BAR_LINE_HEIGHT;

/** How far a tool pill's drawing reaches above its row's box: the plate's `PLATE_PAD.y`, then past the
 *  plate its hovered growth carrying the shortcut badge or the focus ring, whichever stands farther. */
export const PILL_RISE = `calc(${PLATE_PAD.y}px + ${hoverBleed(PILL_H / 2, BADGE.rise * SCALE - PLATE_PAD.y)})`;

/** A tool cell's pill on `surface`: the cell's glyph, named after the command that arms it. */
export function useCellPill(surface: ContentType): (id: string) => { glyph: Glyph; label: string; commandId: string } {
  const t = useT();
  return (id) => {
    const cell = toolCell(id);
    return { glyph: cell.glyph[surface], label: t(commandLabel(cell.commandId)), commandId: cell.commandId };
  };
}

export function ToolPill({ helpTarget, tourTarget, glyph, label, commandId, active, centre, onSelect }: {
  helpTarget?: HelpTarget;
  /** The tour's Show me can ring this pill. */
  tourTarget?: TourTargetId;
  glyph: Glyph; label: string; commandId?: string;
  active: boolean; centre: number; onSelect: () => void;
}) {
  const transition = useTransition('tool.plate.shape');
  const reduced = useReducedMotionConfig();
  // Unarmed, the pill shows its glyph alone, so it names itself; armed, its caption names it.
  const name = useNameReveal(label, 'above', useCommandTitle()(label, commandId));
  const zoom = useFrameZoom();
  return <motion.div {...(tourTarget ? tourTargetAttr(tourTarget) : {})}
    initial={false} animate={{ width: TOOL_PILL_WIDTH + (active ? TOOL_PILL_GROWTH : 0) }} transition={transition}
    style={{ position: 'relative', height: CELL_BOX.h, flex: 'none' }}>
    <ActionButton {...helpAttributes(helpTarget)} {...name.bind} interaction="action" aria-label={label} aria-pressed={active}
      onClick={onSelect}
      initial={false} animate={{ backgroundColor: active ? PLATE_CLEAR : PLATE }} transition={transition}
      style={{ ...btnReset, position: 'absolute', top: -PLATE_PAD.y, width: '100%', height: PILL_H,
        borderRadius: radii.pill, display: 'grid', placeItems: 'center', pointerEvents: 'auto', cursor: cursors.clickable }}>
      <GlyphSwap glyph={glyph}/>
      {active ? null : name.bubble}
      <TouchReach zoom={zoom} />
    </ActionButton>
    {commandId && <ShortcutBadge commandId={commandId} grown/>}
    <AnimatePresence initial={false}>{active && <MapCaption data-tool-caption key={label} top={CAPTION_TOP} centre={centre}
      motionProps={presence('tool.plate.shape', { opacity: 0 }, { reduced })}>
      <BarText onMap size={TEXT.label}>{label}</BarText>
    </MapCaption>}</AnimatePresence>
  </motion.div>;
}

/** A pill kept across a switch between bars crossfades its drawing in place. */
function GlyphSwap({ glyph }: { glyph: Glyph }) {
  const fade = presence('control.fade', { opacity: 0 }, { reduced: useReducedMotionConfig() });
  const glyphKey = useObjectKey<Glyph>();
  return <span style={{ display: 'grid', placeItems: 'center' }}>
    <AnimatePresence initial={false}>
      <motion.span key={glyphKey(glyph)} {...fade}
        style={{ gridArea: '1 / 1', display: 'grid', placeItems: 'center' }}>
        <GlyphIcon glyph={glyph} size={62 * SCALE}/>
      </motion.span>
    </AnimatePresence>
  </span>;
}
