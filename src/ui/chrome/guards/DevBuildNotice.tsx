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
 * DISMISSING IS THE DEFAULT, so the notice takes itself away (`TimedButton`). It has one sentence
 * to deliver and nothing to ask, and standing over the map until someone attends to it is the
 * notice charging for a fact it has already given. What keeps that from defeating the notice is
 * that the countdown holds while the pointer is anywhere on the CARD, not merely on its dismiss:
 * reading happens over the sentence, and the dismiss is at the far end of it.
 *
 * The watermark stays, and it stands ABOVE EVERYTHING (`z.unmissable`). Being unmissable is the
 * whole point of it: it is DOM rather than canvas, so it cannot reach an exported image (exports
 * render the Pixi scene, not the page), and it is `pointerEvents: none`, so it can never intercept
 * a click. A panel that could cover it would be a panel that hides which build this is.
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { APP_VERSION, IS_DEV_BUILD } from '../../../version';
import { LEGAL } from '../../../legal/config';
import { TimedButton } from '../../primitives/TimedButton';
import { colors, font, radii, springs, z, cursors } from '../../design/styles';
import { MAP_LABEL, PANEL_EDGE } from '../../design/tokens';
import { useChromeScale } from '../../design/scale';

/**
 * How far down the notice hangs, in real css px of the window.
 *
 * The top margin is where the interface's own top row is — at any window narrower than about 1600
 * a card there reaches across the build-mode blocks. So it drops below that row and the name under
 * the selected block, and takes the page's own centre line, which is the one band across the
 * window that no control stands in. Both corners are left to the frame.
 *
 * NOT scaled by the chrome zoom, which is why it is divided back out at the use site: the number
 * has to clear a frame laid out in fixed css px, so a top that grew with the viewport would clear
 * it on one monitor and not the next.
 */
const NOTICE_TOP = 180;

// Centring lives in framer's `x`, NOT in a `transform` here: motion writes the element's
// transform to animate `y`, which silently drops a `translateX(-50%)` set in CSS. That put the
// card half its own width off centre at every viewport size (the watermark, which is not a
// motion element, was unaffected). Both `initial` and `animate` carry the same x so nothing
// slides sideways on entry.
const noticeWrap: CSSProperties = {
  position: 'fixed',
  left: '50%',
  zIndex: z.toast,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: 'min(92vw, 560px)',
  padding: '10px 12px 10px 16px',
  borderRadius: radii.lg,
  border: PANEL_EDGE,
  background: colors.panelCream,
  color: colors.frameDark,
  fontFamily: font.family,
  fontSize: 12.5,
  fontWeight: 700,
  lineHeight: 1.35,
  boxShadow: 'none',
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
  // A stadium, so the countdown's outline runs round a pill rather than round a box with soft
  // corners: `TimedButton` takes its own shape from whatever this says.
  borderRadius: 999,
  cursor: cursors.clickable,
};

/**
 * How long the notice stands before it takes itself away, in seconds.
 *
 * Long enough to read the sentence and follow the link with the pointer, which is what the pause
 * is for: a visitor who is reading has their pointer on the card, and the clock is not running.
 * What this really bounds is the case nobody is looking.
 */
const NOTICE_SECONDS = 10;

/*
 * The standing watermark.
 *
 * IT STANDS ON THE TOP RUNG AND IT IS STILL NOT DONE. The rung (`z.unmissable`) settles what may
 * cover it, which is nothing; what it cannot settle is whether the word can be READ over what it
 * lands on, and the bottom of this window is exactly where the interface puts a full-width shelf in
 * `DARK_PLATE`. Dark ink at a third of its strength on that plate is a watermark that a panel hides
 * without covering, which is the same failure by another route (measured: it paints over the
 * generate shelf and is invisible there).
 *
 * So it wears the treatment every word standing on unknown ground in this interface wears
 * (`tokens.ts:MAP_LABEL`): pale ink with a dark edge round it, one of the two carrying the word
 * whichever it is over. Quiet is still the intent — the strength below is the least that reads on
 * both — but between quiet and legible, legible is the whole reason the mark exists.
 */
const watermarkStyle: CSSProperties = {
  position: 'fixed',
  bottom: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: z.unmissable,
  pointerEvents: 'none',
  userSelect: 'none',
  fontFamily: font.family,
  fontWeight: 900,
  fontSize: 11,
  letterSpacing: '0.12em',
  ...MAP_LABEL,
  opacity: 0.62,
  whiteSpace: 'nowrap',
};

export function DevBuildNotice() {
  const t = useT();
  const chromeScale = useChromeScale();
  const [dismissed, setDismissed] = useState(false);
  const [reading, setReading] = useState(false);

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
            style={{ ...noticeWrap, top: NOTICE_TOP / chromeScale, zoom: chromeScale }}
            initial={{ opacity: 0, x: '-50%', y: -12 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%', y: -8 }}
            transition={springs.stiff}
            onPointerEnter={() => setReading(true)}
            onPointerLeave={() => setReading(false)}
          >
            <span style={stripe} aria-hidden />
            <span>
              {t('dev.notice')}{' '}
              <a style={linkStyle} href={LEGAL.canonicalOrigin} target="_blank" rel="noopener noreferrer">
                {t('dev.notice_cta')} ↗
              </a>
            </span>
            <TimedButton
              after={NOTICE_SECONDS}
              paused={reading}
              style={dismissStyle}
              onPress={() => setDismissed(true)}
              aria-label={t('dev.notice_dismiss')}
              data-testid="dev-notice-dismiss"
            >
              {t('dev.notice_dismiss')}
            </TimedButton>
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ ...watermarkStyle, zoom: chromeScale }} data-testid="dev-watermark" aria-hidden>
        {t('dev.watermark')} · {APP_VERSION}
      </div>
    </>
  );
}
