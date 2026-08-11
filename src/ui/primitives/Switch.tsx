import { motion, useReducedMotionConfig } from 'framer-motion';
import { colors, inkTint, springs, cursors } from '../design/styles';
import { skin } from '../design/window-skin';

/**
 * The one cozy toggle switch — 48×26 track, 20px knob sliding 3px↔25px, the design source's active
 * yellow when on. Shared by SettingsModal (grid / chunk toggles) and the export controls.
 * `disabled` dims + no-ops it while keeping it visible (never hidden), for the
 * provenance-badge toggle on human-made maps.
 *
 * Motion: the knob SLIDES on a house spring (Framer `animate`, never a CSS transition) so it
 * shares the app's spring physics and, crucially, honours reduced-motion — a CSS `transition`
 * would animate even under `prefers-reduced-motion`, since Framer's `MotionConfig` cannot
 * gate it. Reduced motion → the knob jumps instantly. Uses `springs.stiff` (the fast
 * house spring) so the toggle throw feels snappy, matching the SegmentedControl pill slide.
 */
export function Switch({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label?: string; disabled?: boolean }) {
  const reduced = useReducedMotionConfig();
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={disabled}
      aria-label={label}
      onClick={disabled ? undefined : onClick}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      animate={{ backgroundColor: on ? skin.active : skin.track }}
      transition={reduced ? { duration: 0 } : springs.stiff}
      style={{
        width: 48,
        height: 26,
        borderRadius: 999,
        position: 'relative',
        border: 'none',
        padding: 0,
        cursor: disabled ? cursors.blocked : cursors.clickable,
        flex: 'none',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <motion.span
        initial={false}
        animate={{ x: on ? 25 : 3 }}
        transition={reduced ? { duration: 0 } : springs.stiff}
        style={{
          position: 'absolute',
          top: 3,
          left: 0,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: colors.white,
          boxShadow: `0 1px 3px ${inkTint(0.35)}`,
        }}
      />
    </motion.button>
  );
}
