/**
 * A notice for a visitor whose browser is an app's built-in view or an engine older than the CSS
 * zoom the interface is measured against. Both readings are guesses (a user-agent match and one
 * layout probe), so the notice only informs: nothing is blocked, and the dismissal is remembered.
 */
import { useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { isInAppBrowser } from '../../../core/runtime/browser-env';
import { readPref, writePref } from '../../../core/runtime/prefs';
import { activeTarget } from '../../../legal/deploy-targets';
import { colors, cursors, font, radii, springs, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { PANEL_EDGE } from '../../design/tokens';
import { useChromeScale } from '../../design/scale';
import { zoomedRectsAreVisual } from '../../design/visual-rect';

function seen(): boolean {
  return readPref('inAppBrowserSeen');
}

function remember(): void {
  writePref('inAppBrowserSeen', true);
}

// Bottom, not top: the dev-build notice owns the top centre, and both can be up at once.
const wrap: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  zIndex: z.toast,
  display: 'flex',
  alignItems: 'stretch',
  gap: 12,
  maxWidth: 'min(92vw, 560px)',
  padding: '10px 12px 10px 16px',
  borderRadius: radii.lg,
  border: PANEL_EDGE,
  background: colors.panelCream,
  color: colors.frameDark,
  fontFamily: font.family,
  ...roleFont('caption'),
  lineHeight: 1.35,
};

const stripe: CSSProperties = {
  flex: '0 0 auto', width: 4, borderRadius: 2, background: colors.accentPrimary,
};

const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };

const title: CSSProperties = { ...roleFont('chip'), fontFamily: font.family };

const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 };

const pill: CSSProperties = {
  flex: '0 0 auto',
  border: 'none',
  background: colors.surfaceSecondary,
  color: colors.frameDark,
  fontFamily: font.family,
  ...roleFont('small'),
  padding: '6px 10px',
  borderRadius: 999,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  cursor: cursors.clickable,
};

export function UnsupportedBrowserNotice() {
  const t = useT();
  const chromeScale = useChromeScale();
  const [show, setShow] = useState(() => (isInAppBrowser() || !zoomedRectsAreVisual()) && !seen());
  const downloads = activeTarget().browserDownloads;

  const dismiss = () => { remember(); setShow(false); };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          data-testid="unsupported-browser-notice"
          // The chrome zoom goes on the fixed element itself; an ancestor zoom skews `left: 50%`.
          style={{ ...wrap, zoom: chromeScale }}
          initial={{ opacity: 0, x: '-50%', y: 12 }}
          animate={{ opacity: 1, x: '-50%', y: 0 }}
          exit={{ opacity: 0, x: '-50%', y: 8 }}
          transition={springs.stiff}
        >
          <span style={stripe} aria-hidden />
          <div style={column}>
            <span style={title}>{t('browser.unsupported_title')}</span>
            <span>{t('browser.unsupported_body')}</span>
            <div style={actions}>
              <a style={pill} href={downloads.chrome} target="_blank" rel="noopener noreferrer">{t('browser.get_chrome')} ↗</a>
              <a style={pill} href={downloads.firefox} target="_blank" rel="noopener noreferrer">{t('browser.get_firefox')} ↗</a>
              <button type="button" style={pill} onClick={dismiss}>{t('browser.dismiss')}</button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
