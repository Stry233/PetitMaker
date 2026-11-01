// @vitest-environment jsdom
/**
 * The Lite entry on an upright window: it shows the shared portrait arrangement with the page
 * unrotated, so the layout space is the window itself. jsdom has no layout, so where the surfaces
 * stand is checked in a browser.
 */
import { describe, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { spec } from '../_support/spec';
import { viewportSize } from '../../platform/device/viewport-space';

vi.hoisted(() => { (globalThis as { __PETIT_LITE__?: boolean }).__PETIT_LITE__ = true; });
// jsdom has no canvas context for the map views.
vi.mock('../../view/map2d/PixiCanvas', () => ({ PixiCanvas: () => null }));
vi.mock('../../view/map3d/Editor3DCanvas', () => ({ Editor3DCanvas: () => null }));

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

describe('the Lite shell on an upright window', () => {
  spec('UI-28', 'the Lite shell at 390x844 shows the portrait arrangement unrotated', async () => {
    // The window has its size before the app's modules load, as on a phone: the store seeds the
    // layout shape from it.
    sizeWindow(390, 844);
    const { TOUR_SEEN_KEY, TOUR_OFFERED } = await import('../_support/tour');
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    localStorage.setItem('petit-planet-locale', 'en');
    vi.stubGlobal('CSS', { supports: () => false });
    document.body.innerHTML = '<div id="root"></div>';
    await import('../../lite/main');
    const { useEditorStore } = await import('../../state/store');

    expect(useEditorStore.getState().layoutShape).toBe('portrait');
    expect(document.body.style.transform).not.toMatch(/rotate/);
    expect(viewportSize()).toEqual({ width: 390, height: 844 });
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-placement]');
      if (!el) throw new Error('the mode row has not rendered');
      return el;
    });
    expect(row.dataset.placement).toBe('bottom');
    expect(screen.getByTestId('shell-corner-actions')).toBeTruthy();
    // The whole Lite entry loads here, every module of the app, which takes several seconds.
  }, 20_000);
});
