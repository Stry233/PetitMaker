// @vitest-environment jsdom
/**
 * A dev build shows a dismissible notice pointing at the release and a standing watermark. The
 * condition is the version's `-dev` suffix, so the tests mock `platform/build/build-info` rather
 * than any config.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { LEGAL } from '../../../../legal/config';
import { en } from '../../../../i18n/locales/en';

const actual = await vi.importActual<typeof import('../../../../platform/build/build-info')>('../../../../platform/build/build-info');

/** Mounts the notice as a build of the given version. */
async function mountAs(version: string) {
  vi.resetModules();
  vi.doMock('../../../../platform/build/build-info', () => ({
    ...actual, APP_VERSION: version, IS_DEV_BUILD: version.endsWith('-dev'),
  }));
  // Provider and component from the same fresh module graph, or they would hold different contexts.
  const [{ DevBuildNotice }, { I18nProvider }, { useEditorStore }] = await Promise.all([
    import('../../../../ui/chrome/guards/DevBuildNotice'),
    import('../../../../i18n/context'),
    import('../../../../state/store'),
  ]);
  // The fresh graph's store instance, which the reimported component subscribes to.
  useEditorStore.setState({ locale: 'en' });
  return render(<I18nProvider><DevBuildNotice /></I18nProvider>);
}

beforeEach(() => { MotionGlobalConfig.skipAnimations = true; });
afterEach(() => { cleanup(); vi.doUnmock('../../../../platform/build/build-info'); vi.resetModules(); });

describe('a dev build says so', () => {
  it('shows the notice, with a link to the release site', async () => {
    await mountAs('0.1.1492-dev');
    expect(screen.getByTestId('dev-notice').textContent).toContain(en['dev.notice']);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(LEGAL.canonicalOrigin);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows a watermark carrying the version, inert and unselectable', async () => {
    await mountAs('0.1.1492-dev');
    const mark = screen.getByTestId('dev-watermark');
    expect(mark.textContent).toContain('0.1.1492-dev');
    // It sits over the map.
    expect(mark.style.pointerEvents).toBe('none');
    expect(mark.style.userSelect).toBe('none');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
  });

  it('centres the notice through framer, not a CSS transform it would overwrite', async () => {
    // Framer writes `transform` to animate `y`, which would drop a `translateX(-50%)` in the style,
    // so the offset travels in framer's `x`.
    await mountAs('0.1.1492-dev');
    const notice = screen.getByTestId('dev-notice');
    expect(notice.style.left).toBe('50%');
    expect(notice.style.transform).toContain('-50%');
    // The watermark is not animated.
    expect(screen.getByTestId('dev-watermark').style.transform).toBe('translateX(-50%)');
  });

  it('lets the notice be dismissed, and keeps the watermark', async () => {
    await mountAs('0.1.1492-dev');
    fireEvent.click(screen.getByRole('button'));
    // AnimatePresence unmounts when the exit finishes.
    await waitFor(() => expect(screen.queryByTestId('dev-notice')).toBeNull());
    expect(screen.getByTestId('dev-watermark')).toBeTruthy();
  });
});

describe('a release build says nothing', () => {
  it('renders neither the notice nor the watermark', async () => {
    await mountAs('0.2.8');
    expect(screen.queryByTestId('dev-notice')).toBeNull();
    expect(screen.queryByTestId('dev-watermark')).toBeNull();
  });

  it('is decided by the version alone, so a published snapshot cannot show them', async () => {
    for (const version of ['0.1.1492', '1.2.7', '10.0.0']) {
      await mountAs(version);
      expect(screen.queryByTestId('dev-watermark'), version).toBeNull();
      cleanup();
    }
  });
});
