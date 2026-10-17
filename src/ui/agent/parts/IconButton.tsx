import { forwardRef, type CSSProperties } from 'react';
import { ACTIVE, INK, MUTED, PLATE } from '../../design/tokens';
import { radii } from '../../design/styles';
import { ActionButton } from '../../primitives/ActionButton';
import { Icon, type IconId } from './sprite';
import { edge, panelTint } from '../panel-skin';

/** The panel's one icon-control size, in frame px. */
export const ICON_BUTTON = 28;

/** The free panel's dock disc; it hangs half its own width past the plate's right edge. */
export const PIN_KNOB = { size: ICON_BUTTON } as const;
export const PIN_KNOB_OUT = PIN_KNOB.size / 2;

interface IconButtonProps {
  testId: string;
  icon: IconId;
  label: string;
  'data-act'?: string;
  disabled?: boolean;
  /** The surface this control opens is standing open. */
  lit?: boolean;
  /** The gear recedes to the muted tone at rest; every other glyph stands at the house ink. */
  door?: boolean;
  /** The disc drawn on the plate's own stock across the panel's corner. */
  knob?: boolean;
  onClick?: () => void;
}

const BOX: CSSProperties = {
  width: ICON_BUTTON, height: ICON_BUTTON, flex: '0 0 auto', padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'none',
};

/** One pressable glyph, with the house yellow as the press and hover rather than as a resting state. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  testId, icon, label, disabled = false, lit = false, door = false, knob = false, onClick, ...rest
}, ref) {
  const face: CSSProperties = knob
    ? { border: edge, borderRadius: radii.pill, color: INK }
    : { border: 'none', borderRadius: radii.chip, color: door && !lit ? MUTED : INK };
  return (
    <ActionButton
      ref={ref}
      data-testid={testId}
      data-icon={icon}
      data-act={rest['data-act']}
      title={label}
      aria-label={label}
      disabled={disabled}
      fill={knob ? PLATE : lit ? ACTIVE : panelTint.chip}
      hoverFill={ACTIVE}
      onClick={onClick}
      style={{ ...BOX, ...face }}
    >
      <Icon id={icon} size={16} />
    </ActionButton>
  );
});
