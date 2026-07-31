import type { TourTargetId } from './steps';

/**
 * The live screen rect of a tour target, or null when it is absent or has not laid out.
 *
 * Measured rather than looked up in a table because three separate factors scale this chrome (the
 * menu's viewport-height mapping, the chrome zoom, and the persisted uiZoom), so a rect is the only
 * form that is correct on every screen. A zero-sized rect reads as absent: an element that has not
 * laid out yet would otherwise put the spotlight at the origin.
 */
export function measureTarget(id: TourTargetId): DOMRect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(`[data-tour-target="${id}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}
