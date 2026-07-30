/**
 * Dev-build signposting: a notice on arrival and a standing watermark.
 *
 * Both render only when `IS_DEV_BUILD`, which is derived from the version rather than from an
 * environment flag: a build carries `-dev` unless the publish workflow wrote a release marker
 * into its stamp, so the dev site, a local build and a source checkout all signpost themselves
 * while a published snapshot never does, with nothing to remember per environment.
 *
 * The notice shows on every page load (that is what "you are on the dev site" has to mean) and
 * can be dismissed for the rest of the visit. It is deliberately NOT persisted: a returning
 * visitor should be told again, and a dismissal is only about getting it out of the way now.
 *
 * The watermark stays. It is `pointerEvents: none` so it can never intercept a click, and it is
 * DOM rather than canvas, so it cannot reach an exported image (exports render the Pixi scene,
 * not the page).
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../i18n/context';
import { APP_VERSION, IS_DEV_BUILD } from '../../version';
import { LEGAL } from '../../legal/config';
import { colors, font, inkTint, radii, springs, z, cursors } from '../styles';
import { useChromeScale } from '../menu/scale';

// Centring lives in framer's `x`, NOT in a `transform` here: motion writes the element's
// transform to animate `y`, which silently drops a `translateX(-50%)` set in CSS. That put the
// card half its own width off centre at every viewport size (the watermark, which is not a
// motion element, was unaffected). Both `initial` and `animate` carry the same x so nothing
// slides sideways on entry.
const noticeWrap: CSSProperties = {
  position: 'fixed',
  top: 16,
  left: '50%',
  zIndex: z.toast,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: 'min(92vw, 560px)',
  padding: '10px 12px 10px 16px',
  borderRadius: radii.lg,
  background: colors.panelCream,
  color: colors.frameDark,
  fontFamily: font.family,
  fontSize: 12.5,
  fontWeight: 700,
  lineHeight: 1.35,
  boxShadow: `0 10px 28px ${inkTint(0.22)}, 0 2px 6px ${colors.inkBorder}`,
};

// The accent stripe carries "this is a warning" without colouring the text, which has to stay
// legible at this size.
const stripe: CSSProperties = {
  flex: '0 0 auto',
  width: 4,
  alignSelf: 'stretch',
  borderRadius: 2,
  background: colors.accentPrimary,
};

const linkStyle: CSSProperties = {
  color: colors.frameDark,
  fontWeight: 800,
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  whiteSpace: 'nowrap',
};

const dismissStyle: CSSProperties = {
  flex: '0 0 auto',
  border: 'none',
  background: colors.surfaceSecondary,
  color: colors.frameDark,
  fontFamily: font.family,
  fontWeight: 800,
  fontSize: 11.5,
  padding: '6px 10px',
  borderRadius: radii.md,
  cursor: cursors.clickable,
};

const watermarkStyle: CSSProperties = {
  position: 'fixed',
  bottom: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  // Below every control (z.panel) so it can never sit over one, and inert regardless.
  zIndex: 1,
  pointerEvents: 'none',
  userSelect: 'none',
  fontFamily: font.family,
  fontWeight: 900,
  fontSize: 11,
  letterSpacing: '0.12em',
  color: colors.frameDark,
  opacity: 0.34,
  whiteSpace: 'nowrap',
};

export function DevBuildNotice() {
  const t = useT();
  const chromeScale = useChromeScale();
  const [dismissed, setDismissed] = useState(false);

  if (!IS_DEV_BUILD) return null;

  // The chrome zoom goes on each FIXED element, never on a wrapper around them: an ancestor
  // with `zoom` skews what `left: 50%` resolves against, which is what pushed the notice off
  // centre. Same shape as ToastContainer, which centres correctly for the same reason.
  return (
    <>
      <AnimatePresence>
        {!dismissed && (
          <motion.div
            role="status"
            data-testid="dev-notice"
            style={{ ...noticeWrap, zoom: chromeScale }}
            initial={{ opacity: 0, x: '-50%', y: -12 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%', y: -8 }}
            transition={springs.stiff}
          >
            <span style={stripe} aria-hidden />
            <span>
              {t('dev.notice')}{' '}
              <a style={linkStyle} href={LEGAL.canonicalOrigin} target="_blank" rel="noopener noreferrer">
                {t('dev.notice_cta')} ↗
              </a>
            </span>
            <button
              type="button"
              style={dismissStyle}
              onClick={() => setDismissed(true)}
              aria-label={t('dev.notice_dismiss')}
            >
              {t('dev.notice_dismiss')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ ...watermarkStyle, zoom: chromeScale }} data-testid="dev-watermark" aria-hidden>
        {t('dev.watermark')} · {APP_VERSION}
      </div>
    </>
  );
}
