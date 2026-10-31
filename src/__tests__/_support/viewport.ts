/** The window and the UI scale a rendered surface stands in, set through the seams the app reads. */
import { act } from '@testing-library/react';
import { useEditorStore } from '../../state/store';
import { __resetUiZoomAnim } from '../../ui/design/ui-zoom-anim';

/** jsdom's own window, which every test leaves behind. */
export const JSDOM_WINDOW = { w: 1024, h: 768 } as const;

/** Resizes the window to `w` by `h` css px and tells its readers. */
export function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

/** Settles the UI scale at `uiZoom`, with no glide running. */
export function atScale(uiZoom: number): void {
  act(() => { useEditorStore.setState({ uiZoom }); __resetUiZoomAnim(); });
}
