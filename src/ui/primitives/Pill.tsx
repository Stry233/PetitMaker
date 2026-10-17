import { forwardRef, type CSSProperties } from 'react';
import { ActionButton, type ActionButtonProps } from './ActionButton';
import { windowPill, type PillVariant, type WindowSurface } from '../design/window-skin';

type PillProps = Omit<ActionButtonProps, 'style'> & {
  variant?: PillVariant;
  on?: WindowSurface;
  style?: CSSProperties;
  'data-testid'?: string;
  'data-demoted'?: string;
};

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill({ variant = 'quiet', on = 'plate', disabled = false, busy = false, style, 'data-testid': testId = 'pill', ...props }, ref) {
  const drawn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: 'none', ...windowPill(variant, disabled || busy, on), ...style };
  // A hover-tinted pill hands its skin's fill to Framer (`hover-fill.ts`).
  const { background, backgroundColor, ...undrawn } = drawn;
  const fill = props.hoverFill === undefined ? undefined : String(backgroundColor ?? background);
  return <ActionButton {...props} ref={ref} data-testid={testId} disabled={disabled} busy={busy}
    {...(fill === undefined ? { style: drawn } : { fill, style: undrawn })} />;
});
