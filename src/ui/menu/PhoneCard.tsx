/*
 * PhoneCard.tsx — the floating card shell (expanded state). A 1:1 transcription
 * of the design's phone body: a dark continuous-corner rectangle with a cream
 * screen inset evenly inside it, plus the volume rail on the left edge. Children
 * are positioned absolutely against the card origin (0,0) in design coords.
 *
 * The shadow is a `drop-shadow` filter on the wrapper, so it follows the
 * squircle + volume-rail silhouette instead of a rectangle. The collapsed
 * state (the little phone icon) is the separate CollapsedPhone component.
 *
 * NOTE: the design source has no in-card collapse control (its collapsed state
 * is a separate screen), so the minimize button at the top-right is an added
 * affordance for the "collapsible" requirement.
 */
import type { ReactNode, CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { colors, inkTint, springs, cursors } from '../styles';
import { CARD, CREAM, VOL, HOME_POS, COLLAPSED } from './metrics';
import { usePx, useMenuCenterOffset } from './scale';
import { squircleClip } from './squircle';
import { iconUrl } from './icons';
import { useT } from '../../i18n/context';

interface PhoneCardProps {
  onCollapse: () => void;
  children: ReactNode;
}

export function PhoneCard({ onCollapse, children }: PhoneCardProps) {
  const t = useT();
  const { px } = usePx();
  const offsetY = useMenuCenterOffset(); // keep the phone centred as the UI zooms
  const W = px(CARD.w);
  const H = px(CARD.h);
  const creamW = px(CREAM.w);
  const creamH = px(CREAM.h);

  // Positioned at its canvas coordinates (left side, vertically centered).
  const wrapper: CSSProperties = {
    position: 'fixed',
    left: px(HOME_POS.x),
    top: px(HOME_POS.y) + offsetY,
    zIndex: 100,
    width: W,
    height: H,
    filter: `drop-shadow(0 ${px(18)}px ${px(26)}px ${inkTint(0.3)})`,
  };

  const rail: CSSProperties = {
    position: 'absolute',
    left: -px(VOL.protrude),
    top: px(VOL.top),
    width: px(VOL.width),
    height: px(VOL.height),
    borderRadius: px(VOL.r),
    background: colors.frameDark,
  };

  const frame: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: W,
    height: H,
    clipPath: squircleClip(W, H, px(CARD.r)),
    background: colors.frameDark,
  };

  const cream: CSSProperties = {
    position: 'absolute',
    left: px(CREAM.x),
    top: px(CREAM.y),
    width: creamW,
    height: creamH,
    clipPath: squircleClip(creamW, creamH, px(CREAM.r)),
    background: colors.panelCream,
  };

  // Collapse affordance: a phone-style "home indicator" pill at the bottom
  // center — on-theme, in the empty strip below the grid, overlaps nothing.
  const hitW = px(180);
  const homeHit: CSSProperties = {
    position: 'absolute',
    // centered via numeric left (NOT translateX, which framer's hover scale would clobber)
    left: Math.round((px(CARD.w) - hitW) / 2),
    top: px(904), // bottom strip of the card (below the grid, above the edge)
    width: hitW,
    height: px(42),
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: cursors.clickable,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    WebkitTapHighlightColor: 'transparent',
  };
  const homePill: CSSProperties = {
    width: px(135),
    height: px(14),
    borderRadius: px(7),
    background: colors.utilTaupe,
    display: 'block',
  };

  return (
    <motion.div
      style={wrapper}
      initial={{ scale: 0.6, opacity: 0, y: 40 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.6, opacity: 0, y: 40 }}
      transition={springs.bouncy}
    >
      {/* volume rail (sits behind the body so it merges into the left edge) */}
      <div style={rail} />
      <div style={frame}>
        <div style={cream} />
        {children}
        <motion.button
          type="button"
          style={homeHit}
          onClick={onCollapse}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          transition={springs.stiff}
          aria-label={t('a11y.collapse_menu')}
        >
          <motion.span style={homePill} whileHover={{ scaleX: 1.08 }} />
        </motion.button>
      </div>
    </motion.div>
  );
}

interface CollapsedPhoneProps {
  onExpand: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

/** The collapsed menu: the little phone icon the designer drew (tap to re-open). */
export function CollapsedPhone({ onExpand, onHoverStart, onHoverEnd }: CollapsedPhoneProps) {
  const t = useT();
  const { px } = usePx();
  const w = px(COLLAPSED.w);
  const h = px(COLLAPSED.h);
  // Positioned at its canvas coordinates — the top-left corner, not bottom-left.
  const style: CSSProperties = {
    position: 'fixed',
    left: px(COLLAPSED.x),
    top: px(COLLAPSED.y),
    zIndex: 100,
    width: w,
    height: h,
    background: 'none',
    border: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    padding: 0,
    cursor: cursors.clickable,
    overflow: 'visible',
    WebkitTapHighlightColor: 'transparent',
    // drop-shadow on the BUTTON (same element as the whileHover transform) so
    // the shadow follows the phone's alpha silhouette. Putting it on the inner
    // <img> made Chromium shadow the rectangular PNG bounds once the hover
    // transform promoted the img to a composited layer.
    filter: `drop-shadow(0 ${px(6)}px ${px(12)}px ${inkTint(0.32)})`,
  };
  return (
    <motion.button
      type="button"
      style={style}
      onClick={onExpand}
      onHoverStart={onHoverStart}
      onHoverEnd={onHoverEnd}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={springs.bouncy}
      aria-label={t('a11y.open_menu')}
    >
      <img
        src={iconUrl('toggle-collapse')}
        alt=""
        draggable={false}
        style={{
          display: 'block',
          width: w,
          height: h,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
    </motion.button>
  );
}
