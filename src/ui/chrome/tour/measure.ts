import { tourTargetSelector, type TourTargetId } from './steps';
import { visualRect, type VisualRect } from '../../design/visual-rect';
import { viewportSize } from '../../../platform/device/viewport-space';
import type { Box } from './place-beside';

/** The first carrier of `id` that has laid out and stands at least partly on screen. */
function shownRect(id: TourTargetId): VisualRect | null {
  const { width, height } = viewportSize();
  for (const el of document.querySelectorAll(tourTargetSelector(id))) {
    const rect = visualRect(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.left + rect.width <= 0 || rect.top + rect.height <= 0 || rect.left >= width || rect.top >= height) continue;
    return rect;
  }
  return null;
}

/**
 * The live screen box around every target of `ids` that is shown, or null when none is.
 *
 * Measured rather than looked up because three separate factors scale this chrome (the menu's
 * viewport-height mapping, the chrome zoom and the persisted uiZoom), so a rect is the only form
 * that is correct on every screen. A zero-sized rect reads as absent: an element that has not laid
 * out yet would otherwise put the spotlight at the origin.
 */
export function measureTargets(ids: readonly TourTargetId[]): Box | null {
  if (typeof document === 'undefined') return null;
  const rects = ids.map(shownRect).filter((r): r is VisualRect => r !== null);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}
