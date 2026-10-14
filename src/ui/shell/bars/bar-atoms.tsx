/* The pieces every bottom bar is built from: drawn art and live text over it, hung off the bottom edge. */
import { btnReset, cursors, UNAVAILABLE, radii } from '../../design/styles';
import { ActionButton } from '../../primitives/ActionButton';
import { useToolbarContext } from '../../session/use-toolbar-context';
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { effectiveCombo } from '../../../state/keymap/resolve';
import { useKeybinds } from '../../../state/keymap/store';
import { prettyCombo } from '../../../platform/input/combo';
import { MAP_LABEL, ON_DARK, ACTIVE, PLATE, PLATE_INK } from '../../design/tokens';
import { SCALE, TEXT } from '../units';
import { useTransition } from '../../design/motion/use-motion';
import { useFrameReadableWeight } from '../use-frame-zoom';
import { BADGE, PLATE_ART, plateRight, CELL_BOX } from './terrain-cells';

/** A plate or any other single drawn shape, filling the box its parent gives it. */
export function Plate({ src, style }: { src: string; style: CSSProperties }) {
  return <img src={src} alt="" draggable={false} style={{ position: 'absolute', pointerEvents: 'none', ...style }} />;
}

/**
 * A cell's shortcut badge on its plate's top-right corner: anchored to `plateRight` so it follows a pill of
 * any width, standing `BADGE.rise` over the row on the plate's own motion, the binding read live.
 */
export function ShortcutBadge({ commandId, active = false, grown = false }: {
  commandId: string;
  /** Which shape the plate under the badge is: the chosen cell's, and grown into a pill around a control. */
  active?: boolean;
  grown?: boolean;
}) {
  const overrides = useKeybinds((s) => s.overrides);
  const shape = useTransition('tool.plate.shape');
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
 * A label at a constant css-px size in a box as wide as its words, never shrunk to fit: the row flows,
 * wraps or scrolls instead. It sits on a plate (`color`, the plate's ink) or on the map (`onMap`).
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

export function Action({ label, primary, disabled, onPress }: {
  label: string; primary?: boolean; disabled?: boolean; onPress: () => void;
}) {
  return (
    <ActionButton
      interaction="action" unavailable={disabled}
      onClick={() => { if (!disabled) onPress(); }}
      style={{
        ...btnReset, flex: 'none', pointerEvents: 'auto',
        cursor: disabled ? cursors.blocked : cursors.clickable,
        opacity: disabled ? UNAVAILABLE : 1,
        height: CELL_BOX.h, padding: '0 18px', borderRadius: radii.pill,
        background: primary ? ACTIVE : PLATE,
        display: 'flex', alignItems: 'center',
      }}
    >
      <BarText size={TEXT.label} color={PLATE_INK}>{label}</BarText>
    </ActionButton>
  );
}
