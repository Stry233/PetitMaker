import type { ReactNode } from 'react';
import { ActionButton } from '../../../primitives/ActionButton';
import { TouchReach, type ReachSides } from '../../../primitives/TouchReach';
import { useFrameZoom } from '../../use-frame-zoom';
import { usePlanGlide } from '../../frame-layout';
import { btnReset, cursors, UNAVAILABLE, radii } from '../../../design/styles';
import { MUTED_INK, ON_DARK, PLATE, PLATE_INK } from '../../../design/tokens';
import { TEXT } from '../../units';
import { Switch } from '../../../primitives/Switch';
import { BarText, Groove } from '../bar-atoms';
import { GAP, STRIP } from './generate-shelf';

/**
 * A strip setting shown as its reading that opens a screen to change it (the scope, a letter's item):
 * name then value, the value staying on the strip once answered.
 */
export function StripChip({ name, value, onOpen, testId, disabled, width }: {
  name: string; value: string; onOpen: () => void; testId: string;
  /** Standing but inapplicable in this state: dimmed and refusing, never taken away. */
  disabled?: boolean;
  /** A fixed width for a chip among the knobs, so its changing reading never shoves them; long text ellipsizes. */
  width?: number;
}) {
  const zoom = useFrameZoom();
  return (
    <ActionButton
      interaction="action" unavailable={disabled}
      data-testid={testId}
      onClick={disabled ? undefined : onOpen}
      title={value}
      style={{
        ...btnReset, position: 'relative', flex: '0 0 auto', pointerEvents: 'auto',
        cursor: disabled ? cursors.blocked : cursors.clickable,
        opacity: disabled ? UNAVAILABLE : 1,
        height: STRIP.h, padding: `0 ${STRIP.padX}px`, borderRadius: radii.pill, background: PLATE,
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
      <TouchReach zoom={zoom} />
    </ActionButton>
  );
}

/** A switch with its name before it; standing but inapplicable it dims and refuses, the dimming the switch's own. */
export function StripSwitch({ label, on, onToggle, testId, disabled }: {
  label: string; on: boolean; onToggle: () => void; testId: string; disabled?: boolean;
}) {
  const zoom = useFrameZoom();
  return (
    <span
      data-testid={testId}
      style={{ display: 'flex', alignItems: 'center', gap: GAP.sliderPart, flex: '0 0 auto', pointerEvents: 'auto' }}
    >
      <BarText size={TEXT.label} color={ON_DARK} align="left" style={{ opacity: disabled ? UNAVAILABLE : 1 }}>
        {label}
      </BarText>
      <Switch on={on} onClick={onToggle} label={label} reachZoom={zoom} {...(disabled ? { disabled } : {})} />
    </span>
  );
}

/**
 * One strip slot: the setting's name, then its control (the reading lives on the knob's bubble).
 * A control that draws its own shape turns the groove off.
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
        {groove ? <Groove /> : null}
        {control}
      </span>
    </span>
  );
}

/** One of the shelf's whole-generation actions (New batch, Clear): a cream plate holding a mark, refusing while the shelf works. */
export function ShelfAction({ label, testId, busy, width, height, radius, at, reach, onPress, children }: {
  label: string;
  testId: string;
  busy: boolean;
  width: number;
  height: number;
  radius: number;
  /** Where it stands in the pair's box, which glides as the pair stacks and unstacks. */
  at: { left: number; top: number };
  /** The sides its fingertip area may grow past: the pair closes the side they share. */
  reach: Partial<ReachSides>;
  onPress: () => void;
  children: ReactNode;
}) {
  const zoom = useFrameZoom();
  const glide = usePlanGlide('frame.layout.adapt');
  return (
    <ActionButton
      interaction="action" unavailable={busy}
      aria-label={label}
      data-testid={testId}
      onClick={onPress}
      style={{
        ...btnReset, position: 'absolute', left: at.left, top: at.top, width, height,
        transition: glide(['width', 'height', 'left', 'top']),
        pointerEvents: 'auto', cursor: busy ? cursors.blocked : cursors.clickable,
        borderRadius: radius, background: PLATE,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
      <TouchReach w={width} h={height} zoom={zoom} sides={reach} />
    </ActionButton>
  );
}
