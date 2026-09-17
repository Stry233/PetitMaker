import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { UnsupportedBrowserNotice } from '../../../ui/chrome/guards/UnsupportedBrowserNotice';
import { activeTarget } from '../../../legal/deploy-targets';
import { PREFS } from '../../../core/runtime/prefs';
import { setStoreState } from '../../_store';
import { poseLegacyZoom } from '../_legacy-zoom';

const WECHAT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40';

function renderNotice() {
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider><UnsupportedBrowserNotice /></I18nProvider>
    </MotionConfig>,
  );
}

beforeEach(() => { setStoreState({ locale: 'en' }); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('UnsupportedBrowserNotice', () => {
  it('names the browser as unsupported inside an app and links the two downloads for this deployment', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(WECHAT);
    renderNotice();
    const notice = screen.getByTestId('unsupported-browser-notice');
    expect(notice.textContent).toContain('Unsupported browser');
    expect(notice.textContent).toContain('use the latest Chrome or Firefox');
    const links = activeTarget().browserDownloads;
    expect(screen.getByRole('link', { name: /Get Chrome/ }).getAttribute('href')).toBe(links.chrome);
    expect(screen.getByRole('link', { name: /Get Firefox/ }).getAttribute('href')).toBe(links.firefox);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByTestId('unsupported-browser-notice')).toBeNull());
    expect(localStorage.getItem(PREFS.inAppBrowserSeen.key)).toBe('1');
  });

  it('also shows on an engine that measures zoomed subtrees in their own pixels', () => {
    const restore = poseLegacyZoom(() => 1);
    try {
      renderNotice();
      expect(screen.getByTestId('unsupported-browser-notice')).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('stays silent in a current standalone browser', () => {
    renderNotice();
    expect(screen.queryByTestId('unsupported-browser-notice')).toBeNull();
  });
});
