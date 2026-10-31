import { cursors, radii, shadows, UNAVAILABLE } from '../design/styles';
import { motion } from 'framer-motion';
import { skin } from '../design/window-skin';
import { useTransition } from '../design/motion/use-motion';
import { ON_DARK } from '../design/tokens';
import { useInteractionProfiles } from '../design/input-mode';
import { TouchReach } from './TouchReach';

/** The track's box, in css px. */
const TRACK = { w: 48, h: 26 } as const;

/**
 * The one cozy toggle switch — 48×26 track, 20px knob sliding 3px↔25px, the design source's active
 * yellow when on. Shared by SettingsModal (grid / chunk toggles) and the export controls.
 * `disabled` dims + no-ops it while keeping it visible (never hidden), for the
 * provenance-badge toggle on human-made maps.
 *
 * Motion: the knob slides on a house spring (Framer `animate`, never a CSS transition) so it
 * shares the app's spring physics and, crucially, honours reduced-motion — a CSS `transition`
 * would animate even under `prefers-reduced-motion`, since Framer's `MotionConfig` cannot
 * gate it. Reduced motion → the knob jumps instantly. Rides `control.settle`.
 *
 * `reachZoom`, the visual px per css px the switch is drawn at, gives it a touch reach
 * (`TouchReach`) where it stands at a size a finger misses.
 */
export function Switch({ on, onClick, label, disabled, reachZoom }: {
  on: boolean; onClick: () => void; label?: string; disabled?: boolean; reachZoom?: number;
}) {
  const settle = useTransition('control.settle');
  const profiles = useInteractionProfiles();
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={disabled}
      aria-label={label}
      onClick={disabled ? undefined : onClick}
      whileTap={disabled ? undefined : profiles.toggleTap.whileTap}
      animate={{ backgroundColor: on ? skin.active : skin.track }}
      transition={settle}
      style={{
        width: TRACK.w,
        height: TRACK.h,
        borderRadius: radii.pill,
        position: 'relative',
        border: 'none',
        padding: 0,
        cursor: disabled ? cursors.blocked : cursors.clickable,
        flex: 'none',
        opacity: disabled ? UNAVAILABLE : 1,
      }}
    >
      <motion.span
        initial={false}
        animate={{ x: on ? 25 : 3 }}
        transition={settle}
        style={{
          position: 'absolute',
          top: 3,
          left: 0,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: ON_DARK,
          boxShadow: shadows.knob,
        }}
      />
      {reachZoom !== undefined && <TouchReach zoom={reachZoom} />}
    </motion.button>
  );
}
