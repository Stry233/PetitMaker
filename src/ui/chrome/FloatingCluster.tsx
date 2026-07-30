import type { CSSProperties, ReactNode } from 'react';
import { colors, font, shadows, cursors } from '../styles';
import { useChromeScale } from '../menu/scale';

/**
 * The cozy floating corner button — cream + dark ink, soft espresso shadow.
 * Shared by the zoom and undo/redo corner clusters. Callers spread it onto a
 * motion.button and layer per-button overrides (e.g. a disabled cursor/opacity).
 */
export const floatingBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // border-box + no padding so the box is EXACTLY 46×46 — a UA button's default
  // padding would otherwise leave a ~2px residual when the tilt steppers animate
  // their height to 0 (a space jump on collapse).
  boxSizing: 'border-box',
  padding: 0,
  width: 46,
  height: 46,
  borderRadius: 16,
  background: colors.panelCream,
  color: colors.frameDark,
  border: 'none',
  cursor: cursors.clickable,
  fontSize: 24,
  fontWeight: 900,
  fontFamily: font.family,
  lineHeight: 1,
  boxShadow: shadows.float,
  WebkitTapHighlightColor: 'transparent',
};

/**
 * Fixed corner container for a floating button cluster. Owns the corner offset,
 * the button gap, the z-index and the chrome `zoom` (the ONE ui factor) so the
 * cluster tracks the menu chrome. `direction` lays the buttons out in a row or a
 * column (zoom = vertical column, history = horizontal row).
 */
export function FloatingCluster({ corner, direction = 'column', children }: {
  corner: 'bottom-left' | 'bottom-right';
  direction?: 'row' | 'column';
  children: ReactNode;
}) {
  const chrome = useChromeScale(); // the ONE ui factor: capped viewport scale × uiZoom (Ctrl +/-)
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 18,
        ...(corner === 'bottom-left' ? { left: 18 } : { right: 18 }),
        display: 'flex',
        flexDirection: direction,
        gap: 10,
        zIndex: 100,
        zoom: chrome,
      }}
    >
      {children}
    </div>
  );
}
