import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { btnReset, buttonMotion, cursors, UNAVAILABLE } from '../../design/styles';
import { DARK_GROOVE, MUTED_INK, ON_DARK, PLATE, PLATE_INK } from '../../design/tokens';
import { TEXT } from '../units';
import { Switch } from '../../primitives/Switch';
import { BarText } from './bar-atoms';
import { GAP, STRIP } from './generate-shelf';

/**
 * A setting that stands in the strip as its own READING and opens a screen to change it: the scope,
 * and the item a letter is tiled with.
 *
 * Name then value, like the knobs beside it, because it is another setting in the same strip. And
 * the value STAYS on the strip once it has been answered, which is the whole reason this is a chip
 * rather than a press that opens a screen and leaves nothing behind: a choice you cannot see is a
 * choice you cannot change.
 */
export function StripChip({ name, value, onOpen, testId, disabled, width }: {
  name: string; value: string; onOpen: () => void; testId: string;
  /** Standing but inapplicable in this state: dimmed and refusing, never taken away. */
  disabled?: boolean;
  /**
   * A FIXED width, for a chip standing among the knobs at the right of the strip.
   *
   * Its reading changes with the setting — an item's name, or the n/a of a state it cannot act in —
   * and a chip as wide as its own words would shove every control beside it each time. The scope
   * chip needs none of this: it stands BEFORE the strip's spacer, so its width comes out of the
   * spacer and nothing to its right moves. A reading too long for the box is ellipsized; the item
   * shelf is where the full name is read.
   */
  width?: number;
}) {
  return (
    <motion.button
      type="button"
      {...(disabled ? {} : buttonMotion)}
      aria-disabled={disabled}
      data-testid={testId}
      onClick={disabled ? undefined : onOpen}
      title={value}
      style={{
        ...btnReset, flex: '0 0 auto', pointerEvents: 'auto',
        cursor: disabled ? cursors.blocked : cursors.clickable,
        opacity: disabled ? UNAVAILABLE : 1,
        height: STRIP.h, padding: `0 ${STRIP.padX}px`, borderRadius: 999, background: PLATE,
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
        ...(width ? { width, boxSizing: 'border-box' as const } : {}),
      }}
    >
      <BarText size={TEXT.label} color={MUTED_INK}>{name}</BarText>
      <BarText size={TEXT.label} color={PLATE_INK} align="left" style={{ minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ display: 'block', minWidth: 0, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value}
        </span>
      </BarText>
    </motion.button>
  );
}

/**
 * A switch with its name before it, the way the maze's own pair stand in this strip.
 *
 * Standing but inapplicable is DIMMED AND REFUSING, never taken away, exactly as the chip beside it
 * is: a control that comes and goes as its neighbour is pressed shoves every knob in the row. The
 * dimming is the switch's own — the name takes the same treatment, and nothing wraps both, since two
 * dimmings multiply and the pair goes past faint to invisible.
 */
export function StripSwitch({ label, on, onToggle, testId, disabled }: {
  label: string; on: boolean; onToggle: () => void; testId: string; disabled?: boolean;
}) {
  return (
    <span
      data-testid={testId}
      style={{ display: 'flex', alignItems: 'center', gap: GAP.sliderPart, flex: '0 0 auto', pointerEvents: 'auto' }}
    >
      <BarText size={TEXT.label} color={ON_DARK} align="left" style={{ opacity: disabled ? UNAVAILABLE : 1 }}>
        {label}
      </BarText>
      <Switch on={on} onClick={onToggle} label={label} {...(disabled ? { disabled } : {})} />
    </span>
  );
}

/**
 * One slot in the strip: the setting's NAME, then its control.
 *
 * The name stands to the left, because two sliders on one strip are the same drawing and nothing
 * else says which is the corridor's width and which the tallest layer. The READING is the part that
 * moved to the knob's own bubble (`BarSlider`): a number that is always on screen is read once and
 * never again, where the name is what tells the two tracks apart every time.
 *
 * The groove behind a slider's track is the design's drawing of a groove; a control that draws its
 * own shape turns it off.
 */
export function Knob({ label, control, groove = true }: {
  label?: string;
  control: ReactNode;
  groove?: boolean;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: GAP.sliderPart, flex: '0 0 auto' }}>
      {label ? <BarText size={TEXT.label} color={ON_DARK} align="left">{label}</BarText> : null}
      {/* The slot stands at the strip's one control height; the drawn track centres inside it and
          the groove fills it, so the three kinds of control share one box. */}
      <span style={{ position: 'relative', display: 'flex', alignItems: 'center', height: STRIP.h }}>
        {groove ? (
          <span
            style={{
              position: 'absolute', inset: 0, borderRadius: 999,
              background: DARK_GROOVE, pointerEvents: 'none',
            }}
          />
        ) : null}
        {control}
      </span>
    </span>
  );
}
