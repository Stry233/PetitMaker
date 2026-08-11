/**
 * The dev site has to say so. A visitor who lands on it should be told it is for evaluation and
 * pointed at the release, and should keep seeing that it is a dev build while they use it.
 *
 * The condition is derived from the VERSION, not from an environment flag — a build carries
 * `-dev` unless the publish workflow wrote a release marker into its stamp — so these tests
 * mock `src/version` to stand in for the two kinds of build rather than setting any config.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { LEGAL } from '../../../legal/config';
import { en } from '../../../i18n/locales/en';

const actual = await vi.importActual<typeof import('../../../version')>('../../../version');

/** Mount the notice as a build of the given version (the `-dev` suffix is the whole signal). */
async function mountAs(version: string) {
  vi.resetModules();
  vi.doMock('../../../version', () => ({
    ...actual, APP_VERSION: version, IS_DEV_BUILD: version.endsWith('-dev'),
  }));
  // Provider AND component from the same fresh module graph: resetModules gives the reimported
  // component a different React context object, so a provider held from the outer graph would
  // supply nothing and every string would render as its key.
  const [{ DevBuildNotice }, { I18nProvider }, { useEditorStore }] = await Promise.all([
    import('../../../ui/chrome/guards/DevBuildNotice'),
    import('../../../i18n/context'),
    import('../../../state/store'),
  ]);
  // The FRESH graph's store, not `_store.ts`'s: `resetModules` above made a second store instance,
  // and the component reimported here subscribes to that one.
  useEditorStore.setState({ locale: 'en' });
  return render(<I18nProvider><DevBuildNotice /></I18nProvider>);
}

beforeEach(() => { MotionGlobalConfig.skipAnimations = true; });
afterEach(() => { cleanup(); vi.doUnmock('../../../version'); vi.resetModules(); });

describe('a dev build says so', () => {
  it('shows the notice, with a link to the release site', async () => {
    await mountAs('0.1.1492-dev');
    expect(screen.getByTestId('dev-notice').textContent).toContain(en['dev.notice']);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(LEGAL.canonicalOrigin); // the release, from config
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('shows a watermark carrying the version, inert and unselectable', async () => {
    await mountAs('0.1.1492-dev');
    const mark = screen.getByTestId('dev-watermark');
    expect(mark.textContent).toContain('0.1.1492-dev');
    // It sits over the map, so it must never intercept a click or a drag.
    expect(mark.style.pointerEvents).toBe('none');
    expect(mark.style.userSelect).toBe('none');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
  });

  it('centres the notice through framer, not a CSS transform it would overwrite', async () => {
    // motion writes `transform` to animate `y`, so a `translateX(-50%)` in the style is
    // silently dropped and the card sits half its own width off centre (measured at +190px
    // across every viewport width before this fix). The offset has to travel in framer's `x`.
    await mountAs('0.1.1492-dev');
    const notice = screen.getByTestId('dev-notice');
    expect(notice.style.left).toBe('50%');
    expect(notice.style.transform).toContain('-50%');
    // And the watermark, which is not animated, keeps doing it the plain way.
    expect(screen.getByTestId('dev-watermark').style.transform).toBe('translateX(-50%)');
  });

  it('lets the notice be dismissed, and keeps the watermark', async () => {
    await mountAs('0.1.1492-dev');
    fireEvent.click(screen.getByRole('button'));
    // AnimatePresence unmounts when the exit finishes, so this is a wait, not a poll for luck.
    await waitFor(() => expect(screen.queryByTestId('dev-notice')).toBeNull());
    // The watermark is the standing signal; only the notice is dismissible.
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
    // resolveVersion drops `-dev` only for a tree the publish workflow marked as released.
    for (const version of ['0.1.1492', '1.2.7', '10.0.0']) {
      await mountAs(version);
      expect(screen.queryByTestId('dev-watermark'), version).toBeNull();
      cleanup();
    }
  });
});
