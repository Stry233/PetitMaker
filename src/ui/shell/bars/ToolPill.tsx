import { presence } from '../../design/motion';
import { helpAttributes, type HelpTarget } from '../../primitives/help-target';
import { ActionButton } from '../../primitives/ActionButton';
import { MapCaption } from './MapCaption';
import { useToolbarContext } from '../../session/use-toolbar-context';
import { useLayoutEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { effectiveCombo } from '../../../state/keymap/resolve';
import { prettyCombo } from '../../../platform/input/combo';
import { useT } from '../../../i18n/context';
import { useKeybinds } from '../../../state/keymap/store';
import { btnReset, cursors, radii } from '../../design/styles';
import { ACTIVE, PLATE } from '../../design/tokens';
import { GlyphIcon } from '../GlyphIcon';
import type { Glyph } from '../frame';
import { useTransition } from '../../design/motion/use-motion';
import { QUAD, SCALE, TEXT } from '../units';
import { BarText, ShortcutBadge } from './bar-atoms';
import { PILL_H, PLATE_PAD, CELL_BOX } from './terrain-cells';
import { useObjectKey } from '../../primitives/use-object-key';

const TOOL_PILL_WIDTH = 170 * SCALE;
const TOOL_PILL_GROWTH = 30 * SCALE;

export const TOOL_PILL_GAP = 8;

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

export function ToolPill({ helpTarget, glyph, label, commandId, active, centre, onSelect }: {
  helpTarget?: HelpTarget;
  glyph: Glyph; label: string; commandId?: string;
  active: boolean; centre: number; onSelect: () => void;
}) {
  const t = useT();
  const transition = useTransition('tool.plate.shape');
  const reduced = useReducedMotionConfig();
  const overrides = useKeybinds(s => s.overrides);
  const context = useToolbarContext();
  const combo = commandId ? effectiveCombo(overrides, commandId, context) : null;
  return <motion.div initial={false} animate={{ width: TOOL_PILL_WIDTH + (active ? TOOL_PILL_GROWTH : 0) }} transition={transition}
    style={{ position: 'relative', height: CELL_BOX.h, flex: 'none' }}>
    <ActionButton {...helpAttributes(helpTarget)} interaction="action" aria-label={label} aria-pressed={active}
      title={combo ? t('shortcut.with_combo', { label, combo: prettyCombo(combo) }) : label} onClick={onSelect}
      initial={false} animate={{ backgroundColor: active ? PLATE_CLEAR : PLATE }} transition={transition}
      style={{ ...btnReset, position: 'absolute', top: -PLATE_PAD.y, width: '100%', height: PILL_H,
        borderRadius: radii.pill, display: 'grid', placeItems: 'center', pointerEvents: 'auto', cursor: cursors.clickable }}>
      <GlyphSwap glyph={glyph}/>
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
