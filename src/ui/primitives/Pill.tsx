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
  return <ActionButton {...props} ref={ref} data-testid={testId} disabled={disabled} busy={busy}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: 'none', ...windowPill(variant, disabled || busy, on), ...style }} />;
});
