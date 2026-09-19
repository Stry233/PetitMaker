import { helpAttributes, type HelpTarget } from '../../primitives/help-target';
import { useToolbarContext } from '../use-toolbar-context';
import { AnimatePresence, motion } from 'framer-motion';
import { effectiveCombo, prettyCombo, useKeybinds } from '../../../core/runtime/keybindings';
import { btnReset, buttonMotion, cursors } from '../../design/styles';
import { ACTIVE, PLATE } from '../../design/tokens';
import { GlyphIcon } from '../GlyphIcon';
import type { Glyph } from '../frame';
import { useMotion } from '../motion/use-motion';
import { captionShift, QUAD, SCALE, TEXT } from '../units';
import { BarText, ShortcutBadge } from './bar-atoms';
import { CELL_BOX } from './ToolCell';
import { PILL_H, PLATE_PAD } from './terrain-cells';

export const TOOL_PILL_WIDTH = 170 * SCALE;
export const TOOL_PILL_GROWTH = 30 * SCALE;

export const TOOL_PILL_GAP = 8;

export function toolPillCentre(index: number, activeIndex: number): number {
  return QUAD.left + index * (TOOL_PILL_WIDTH + TOOL_PILL_GAP) + TOOL_PILL_WIDTH / 2
    + (activeIndex >= 0 && activeIndex < index ? TOOL_PILL_GROWTH : 0)
    + (activeIndex === index ? TOOL_PILL_GROWTH / 2 : 0);
}

export function ToolPill({ helpTarget, glyph, label, commandId, active, centre, onSelect }: {
  helpTarget?: HelpTarget;
  glyph: Glyph; label: string; commandId?: string;
  active: boolean; centre: number; onSelect: () => void;
}) {
  const transition = useMotion('tool.plate.shape');
  const overrides = useKeybinds(s => s.overrides);
  const context = useToolbarContext();
  const combo = commandId ? effectiveCombo(overrides, commandId, context) : null;
  return <motion.div initial={false} animate={{ width: TOOL_PILL_WIDTH + (active ? TOOL_PILL_GROWTH : 0) }} transition={transition}
    style={{ position: 'relative', height: CELL_BOX.h, flex: 'none' }}>
    <motion.button {...helpAttributes(helpTarget)} type="button" {...buttonMotion} aria-label={label} aria-pressed={active}
      title={combo ? `${label} (${prettyCombo(combo)})` : label} onClick={onSelect}
      initial={false} animate={{ backgroundColor: active ? ACTIVE : PLATE }} transition={transition}
      style={{ ...btnReset, position: 'absolute', top: -PLATE_PAD.y, width: '100%', height: PILL_H,
        borderRadius: 999, display: 'grid', placeItems: 'center', pointerEvents: 'auto', cursor: cursors.clickable }}>
      <GlyphIcon glyph={glyph} size={62 * SCALE}/>
    </motion.button>
    {commandId && <ShortcutBadge commandId={commandId} grown/>}
    <AnimatePresence initial={false}>{active && <motion.span data-tool-caption key={label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition}
      style={{ position: 'absolute', top: CELL_BOX.h + PLATE_PAD.y + 5, left: '50%', transform: captionShift(centre), whiteSpace: 'nowrap', pointerEvents: 'none' }}>
      <BarText onMap size={TEXT.label}>{label}</BarText>
    </motion.span>}</AnimatePresence>
  </motion.div>;
}
