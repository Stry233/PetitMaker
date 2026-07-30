import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { useT } from '../../i18n/context';
import { useFontsReady } from '../hooks/useFontsReady';
import { usePx } from '../menu/scale';
import { COLLAPSED } from '../menu/metrics';
import { squircleClip } from '../menu/squircle';
import { colors, font, inkTint, springs, pressable, exitTransition, cursors } from '../styles';

export interface RestoreBubbleProps {
  /** Reopen the autosaved map. */
  onRestore: () => void;
  /** Keep the fresh map (start new) — a quiet text link, not a button. */
  onDismiss: () => void;
  /** The collapsed phone is hovered → hint that clicking it will dismiss this bubble. */
  hint?: boolean;
}

/**
 * A speech bubble pointing FROM the collapsed phone, offering to restore the last autosaved map.
 * Never blocks (the editor already opened a fresh map; dismissing/opening the menu just keeps it).
 * Two motion layers: the OUTER does the enter (delayed so it follows the phone in) / exit
 * choreography; the INNER reacts instantly to `hint` — retreating toward the phone when it's hovered,
 * so it reads as "click the phone and I'll tuck away". Sized in the menu's scaled px space.
 */
export function RestoreBubble({ onRestore, onDismiss, hint }: RestoreBubbleProps) {
  const t = useT();
  const { px } = usePx();
  const W = px(412), MIN_H = px(212), R = px(30);

  // i18n: the card was a FIXED height (212), centering title+body+buttons — a longer translation
  // (ru/fr run noticeably longer than the EN copy this was tuned for) wraps to an extra line and
  // would overflow past the clipped edge, top and bottom, since the content is vertically centered
  // in a box that can't grow on its own. Measure the actual (unclipped) content group's natural
  // height and let the card GROW past the 212 baseline when it doesn't fit — English/Chinese
  // already fit under 212, so `cardH` stays exactly MIN_H for them (no visual change).
  const contentRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(MIN_H);
  const fit = () => {
    const el = contentRef.current;
    if (!el) return;
    const needed = el.offsetHeight + px(24); // a little breathing room above/below, like the original centered look
    setCardH(Math.max(MIN_H, needed));
  };
  useLayoutEffect(fit); // re-measure every render (language/text/scale changes); converges via setState equality
  useFontsReady(fit); // re-fit once the web font loads (first measure may use a fallback metric)

  const wrap: CSSProperties = {
    position: 'fixed',
    left: px(COLLAPSED.x + COLLAPSED.w + 14), // clear of the phone; the tail reaches back toward it
    top: px(COLLAPSED.y + 22),
    width: W,
    height: cardH,
    zIndex: 101,
    transformOrigin: 'left center', // grows out of the phone
    filter: `drop-shadow(0 ${px(10)}px ${px(20)}px ${inkTint(0.28)})`,
  };
  const layer: CSSProperties = { position: 'absolute', inset: 0, transformOrigin: 'left center' };
  const tail: CSSProperties = {
    position: 'absolute', left: -px(16), top: cardH / 2 - px(17), width: px(18), height: px(34),
    background: colors.white, clipPath: 'polygon(100% 0%, 100% 100%, 0% 50%)',
  };
  const card: CSSProperties = {
    position: 'absolute', inset: 0, clipPath: squircleClip(W, cardH, R), background: colors.white,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: `0 ${px(26)}px`, textAlign: 'center', fontFamily: font.family,
  };
  // The measured group (title + body + row) — its natural height (unaffected by the card's clip)
  // drives `cardH` above.
  const contentGroup: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: px(13) };
  // Sizes lifted to match the rest of the menu chrome (it read too small before): a bold title, a
  // legible body, and full-size choices on one row (PowerPoint "start here").
  const title: CSSProperties = { fontWeight: 900, fontSize: px(31), color: colors.frameDark, lineHeight: 1.05 };
  const body: CSSProperties = { fontWeight: 600, fontSize: px(19), color: colors.textSecondary, lineHeight: 1.35 };
  // `flexWrap` lets the two choices drop to their own lines if a long translation can't share a row
  // within the card's width (en/zh always fit side by side, so this is a no-op for them).
  const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: px(12), marginTop: px(3) };
  const resumeBtn: CSSProperties = {
    border: 'none', cursor: cursors.clickable, background: colors.accentPrimary, color: colors.textInverse,
    fontFamily: font.family, fontWeight: 800, fontSize: px(21), padding: `${px(11)}px ${px(22)}px`,
    borderRadius: px(999), whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
  };
  const dismiss: CSSProperties = {
    border: 'none', cursor: cursors.clickable, background: 'transparent', color: colors.textSecondary,
    fontFamily: font.family, fontWeight: 700, fontSize: px(19), padding: `${px(11)}px ${px(12)}px`,
    borderRadius: px(999), whiteSpace: 'nowrap', WebkitTapHighlightColor: 'transparent',
  };

  return (
    <motion.div
      style={wrap}
      initial={{ opacity: 0, scale: 0.8, x: px(-16) }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      // Exit the OPPOSITE way (slides off to the right); standard settle curve, no bounce.
      exit={{ opacity: 0, scale: 0.85, x: px(20), transition: exitTransition }}
      transition={{ ...springs.bouncy, delay: 0.18 }} // system "pop from phone" curve, just AFTER the phone
    >
      <motion.div
        style={layer}
        // Hint retreats to the RIGHT (the exit direction) so the dismissal reads consistently.
        animate={hint ? { scale: 0.92, opacity: 0.5, x: px(14) } : { scale: 1, opacity: 1, x: 0 }}
        transition={springs.stiff}
      >
        <div style={tail} />
        <div style={card}>
          <div ref={contentRef} style={contentGroup}>
            <div style={title}>{t('restore.title')}</div>
            <div style={body}>{t('restore.body')}</div>
            <div style={row}>
              <motion.button type="button" style={resumeBtn} onClick={onRestore} {...pressable}>{t('restore.resume')}</motion.button>
              <button type="button" style={dismiss} onClick={onDismiss}>{t('restore.fresh')}</button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
