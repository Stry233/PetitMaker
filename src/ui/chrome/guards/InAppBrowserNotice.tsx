/**
 * A notice for a visitor who arrived through an app's built-in browser.
 *
 * Those WebViews ship cut-down engines — missing WebGL2, no downloads, no orientation events — and
 * the editor leans on all of it, so the honest thing is to say so before a feature silently does
 * nothing. Detection is a user-agent guess (`core/runtime/browser-env`), which is why this only
 * ever informs: nothing is blocked and nothing is disabled, so a wrong guess costs one dismissal.
 *
 * Persisted, unlike the dev-build notice: that one is about where you are and should be repeated,
 * this one is advice the user has already read and acted on or chosen not to.
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { isInAppBrowser } from '../../../core/runtime/browser-env';
import { colors, font, inkTint, radii, springs, z, cursors } from '../../design/styles';
import { useChromeScale } from '../../design/scale';
import { readPref, writePref } from '../../../core/runtime/prefs';

function seen(): boolean {
  return readPref('inAppBrowserSeen');
}

function remember(): void {
  writePref('inAppBrowserSeen', true);
}

// Bottom, not top: the dev-build notice already owns the top centre, and both can be up at once.
const wrap: CSSProperties = {
  position: 'fixed',
  bottom: 16,
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

const stripe: CSSProperties = {
  flex: '0 0 auto', width: 4, alignSelf: 'stretch', borderRadius: 2, background: colors.accentPrimary,
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

export function InAppBrowserNotice() {
  const t = useT();
  const chromeScale = useChromeScale();
  // Resolved once, at mount: the user agent cannot change under a live page, and re-reading it on
  // every render would only re-run a regex.
  const [show, setShow] = useState(() => isInAppBrowser() && !seen());

  const dismiss = () => { remember(); setShow(false); };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          data-testid="in-app-browser-notice"
          // The chrome zoom goes on the FIXED element itself: an ancestor carrying `zoom` skews
          // what `left: 50%` resolves against.
          style={{ ...wrap, zoom: chromeScale }}
          initial={{ opacity: 0, x: '-50%', y: 12 }}
          animate={{ opacity: 1, x: '-50%', y: 0 }}
          exit={{ opacity: 0, x: '-50%', y: 8 }}
          transition={springs.stiff}
        >
          <span style={stripe} aria-hidden />
          <span>{t('inapp.notice')}</span>
          <button type="button" style={dismissStyle} onClick={dismiss} aria-label={t('inapp.dismiss')}>
            {t('inapp.dismiss')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
