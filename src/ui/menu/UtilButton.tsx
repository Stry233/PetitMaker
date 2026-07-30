/*
 * UtilButton.tsx — the small taupe continuous-corner buttons at the top-right
 * of the card: the settings gear and the help "?". Glyphs are white, drawn
 * natively (the gear is an SVG scalloped cog, the help is text).
 */
import { motion } from 'framer-motion';
import type { CSSProperties } from 'react';
import { colors, font, springs, cursors } from '../styles';
import { UTIL } from './metrics';
import { usePx } from './scale';
import { squircleClip } from './squircle';
import { Icon } from './icons';

interface UtilButtonProps {
  kind: 'gear' | 'help';
  onClick: () => void;
  ariaLabel: string;
}

export function UtilButton({ kind, onClick, ariaLabel }: UtilButtonProps) {
  const { px, pxf, fw } = usePx();
  const pos = kind === 'gear' ? UTIL.gear : UTIL.help;
  const sz = px(UTIL.size);

  const style: CSSProperties = {
    position: 'absolute',
    left: px(pos.x),
    top: px(pos.y),
    width: sz,
    height: sz,
    clipPath: squircleClip(sz, sz, px(UTIL.r)),
    background: colors.utilTaupe,
    border: 'none',
    padding: 0,
    cursor: cursors.clickable,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <motion.button
      type="button"
      style={style}
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      transition={springs.stiff}
      aria-label={ariaLabel}
    >
      {kind === 'gear' ? (
        <Icon name="gear" size={px(UTIL.cog.w)} />
      ) : (
        <span
          style={{
            fontFamily: font.family,
            fontWeight: fw(900),
            fontSize: pxf(UTIL.help.fontSize),
            color: colors.white,
            lineHeight: 1,
          }}
        >
          ?
        </span>
      )}
    </motion.button>
  );
}
