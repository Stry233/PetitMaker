import type { ReactNode, RefObject } from 'react';
import { ActionButton } from '../../../primitives/ActionButton';
import { TouchReach, type ReachSides } from '../../../primitives/TouchReach';
import { useFrameZoom } from '../../use-frame-zoom';
import { usePlanGlide } from '../../frame-layout';
import { btnReset, cursors, UNAVAILABLE, radii } from '../../../design/styles';
import { ACTIVE, MUTED_INK, ON_DARK, PLATE, PLATE_INK, plateShapeEdge } from '../../../design/tokens';
import { Switch } from '../../../primitives/Switch';
import { BarText, Groove } from '../bar-atoms';
import { GAP, STRIP } from './generate-shelf';

/**
 * A pill of the strip's height on the cream plate, the one shape the strips' chips and actions take:
 * what it holds stands in a row, and standing but inapplicable it dims and refuses, never taken away.
 */
function StripPill({ label, title, testId, disabled, width, gap = 8, buttonRef, expanded, pressed, onPress, children }: {
  /** Its accessible name where its words alone do not name it. */
  label?: string;
  title?: string;
  testId?: string;
  disabled?: boolean;
  /** A fixed width for a pill among the knobs, so a changing reading never shoves them. */
  width?: number;
  gap?: number;
  buttonRef?: RefObject<HTMLButtonElement>;
  /** Whether what it opens stands open, for a pill that opens something. */
  expanded?: boolean;
  /** For a pill that toggles a way of working: whether it is on, drawn in the chosen fill. */
  pressed?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const zoom = useFrameZoom();
  return (
    <ActionButton
      ref={buttonRef}
      interaction="action" unavailable={disabled}
      {...(label === undefined ? {} : { 'aria-label': label })}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      onClick={disabled ? undefined : onPress}
      title={title}
      style={{
        ...btnReset, position: 'relative', flex: '0 0 auto', pointerEvents: 'auto',
        cursor: disabled ? cursors.blocked : cursors.clickable,
        opacity: disabled ? UNAVAILABLE : 1,
        height: STRIP.h, padding: `0 ${STRIP.padX}px`, borderRadius: radii.pill, background: pressed ? ACTIVE : PLATE,
        display: 'flex', alignItems: 'center', gap, minWidth: 0,
        ...(width ? { width, boxSizing: 'border-box' as const } : {}),
      }}
    >
      {children}
      <TouchReach zoom={zoom} />
    </ActionButton>
  );
}

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
  return (
    <StripPill testId={testId} title={value} disabled={disabled} width={width} onPress={onOpen}>
      <BarText role="chip" color={MUTED_INK}>{name}</BarText>
      <BarText role="chip" color={PLATE_INK} align="left" style={{ minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ display: 'block', minWidth: 0, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value}
        </span>
      </BarText>
    </StripPill>
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
      <BarText role="chip" color={ON_DARK} align="left" style={{ opacity: disabled ? UNAVAILABLE : 1 }}>
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
      {label ? <BarText role="chip" color={ON_DARK} align="left">{label}</BarText> : null}
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
export function ShelfAction({ label, testId, busy, pressed, piece, width, height, radius, at, reach, onPress, children }: {
  label: string;
  testId: string;
  busy: boolean;
  /** For a square that toggles: whether it stands pressed, drawn in the chosen fill. */
  pressed?: boolean;
  /** What it wears as a piece of a re-arrangement inside its surface (`primitives/morph.ts:morphScope`). */
  piece?: Record<string, string>;
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
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...piece}
      data-testid={testId}
      onClick={onPress}
      style={{
        ...btnReset, position: 'absolute', left: at.left, top: at.top, width, height,
        transition: glide(['width', 'height', 'left', 'top']),
        pointerEvents: 'auto', cursor: busy ? cursors.blocked : cursors.clickable,
        // Edged as the delete target it crossfades with on the Blueprint strip, so the edge never flickers.
        borderRadius: radius, background: pressed ? ACTIVE : PLATE, boxShadow: plateShapeEdge(),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
      <TouchReach w={width} h={height} zoom={zoom} sides={reach} />
    </ActionButton>
  );
}
