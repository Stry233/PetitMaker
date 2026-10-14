import { motion, type MotionValue } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { DOCK_CHROME, DOCK_CHROME_FILE_H, type DockSide } from '../../shell/panel-frame';
import { STATUS_CARD_HEIGHT } from './StatusCard';
import { IconButton, PIN_KNOB_OUT } from '../parts/IconButton';
import { PANEL_PAD } from '../panel-skin';
import { PANEL_RADIUS } from './plate';

/**
 * The dock controls: a floating panel carries one pin disc on its top-right edge, riding the plate's
 * wipe; a docked panel stands the pin and the side switch in the desk band's gutter.
 */
export function PinControls({ pinned, dockSide, blocked, carry, onTogglePin, onSwitchSide }: {
  pinned: boolean;
  dockSide: DockSide;
  /** The window is too narrow to dock. */
  blocked: boolean;
  /** The disc's position along the plate's animated inset. */
  carry: { x: MotionValue<number>; y: MotionValue<number>; scale: MotionValue<number> };
  onTogglePin(): void;
  onSwitchSide?(): void;
}) {
  const t = useT();
  const label = t(blocked ? 'agent.pin_no_room' : pinned ? 'agent.pin_undock' : 'agent.pin_dock');
  const icon = dockSide === 'left' ? 'pw-dock-left' : 'pw-dock-right';
  return (
    <motion.div
      data-testid="desk-pin"
      style={pinned
        ? {
          position: 'absolute',
          top: PANEL_PAD + (STATUS_CARD_HEIGHT - DOCK_CHROME_FILE_H) / 2,
          right: PANEL_PAD,
          display: 'flex', flexDirection: 'column', gap: DOCK_CHROME.stack, zIndex: 1,
        }
        : { position: 'absolute', top: PANEL_RADIUS, right: -PIN_KNOB_OUT, display: 'flex', zIndex: 1, ...carry }}
    >
      {pinned ? (
        <>
          <IconButton testId="dock-pin" icon={icon} label={label} data-act="pin" lit onClick={onTogglePin} />
          {onSwitchSide ? (
            <IconButton
              testId="dock-switch"
              // The glyph shows the destination side.
              icon={dockSide === 'left' ? 'pw-dock-right' : 'pw-dock-left'}
              label={t(dockSide === 'left' ? 'agent.dock_switch_right' : 'agent.dock_switch_left')}
              data-act="dock-side"
              onClick={onSwitchSide}
            />
          ) : null}
        </>
      ) : (
        <IconButton knob testId="dock-pin" icon={icon} label={label} data-act="pin" disabled={blocked} onClick={onTogglePin} />
      )}
    </motion.div>
  );
}
