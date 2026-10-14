/**
 * A notice for a visitor whose browser is an app's built-in view or an engine older than the CSS
 * zoom the interface is measured against. Both readings are guesses (a user-agent match and one
 * layout probe), so the notice only informs: nothing is blocked, and the dismissal is remembered.
 */
import { useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { isInAppBrowser } from '../../../platform/device/browser-env';
import { browserNoticeSeen, rememberBrowserNoticeSeen } from '../../../io/storage/browser-notice-facts';
import { activeTarget } from '../../../platform/build/deploy-targets';
import { font } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { NoticeAction, NoticeBar, NoticeLink } from '../../primitives/NoticeBar';
import { zoomedRectsAreVisual } from '../../design/visual-rect';

const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };

const title: CSSProperties = { ...roleFont('chip'), fontFamily: font.family };

const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 };

export function UnsupportedBrowserNotice() {
  const t = useT();
  const [show, setShow] = useState(() => (isInAppBrowser() || !zoomedRectsAreVisual()) && !browserNoticeSeen());
  const downloads = activeTarget().browserDownloads;

  const dismiss = () => { rememberBrowserNoticeSeen(); setShow(false); };

  return (
    <AnimatePresence>
      {show && (
        // Bottom, not top: the dev-build notice owns the top centre, and both can be up at once.
        <NoticeBar role="status" data-testid="unsupported-browser-notice" edge="bottom" offset={16} align="stretch" stripe travel={12}>
          <div style={column}>
            <span style={title}>{t('browser.unsupported_title')}</span>
            <span>{t('browser.unsupported_body')}</span>
            <div style={actions}>
              <NoticeLink href={downloads.chrome}>{t('browser.get_chrome')} ↗</NoticeLink>
              <NoticeLink href={downloads.firefox}>{t('browser.get_firefox')} ↗</NoticeLink>
              <NoticeAction style={{ whiteSpace: 'nowrap' }} onClick={dismiss}>{t('browser.dismiss')}</NoticeAction>
            </div>
          </div>
        </NoticeBar>
      )}
    </AnimatePresence>
  );
}
