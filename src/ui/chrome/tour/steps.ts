/*
 * How a live control says the tour's Show me can ring it. A step names targets, never positions: the
 * spotlight measures them at runtime, because the menu scale, the chrome zoom and the persisted uiZoom
 * each move the chrome independently.
 */
import type { BuildMode } from '../../../state/editing/edit-mode';

/** The elements a Show me step can ring or an arrival bubble points at (`chrome/floating/MenuBubbles.tsx`,
 *  the region-load notice's `load` and the object shelf's `shelf-brush` among them). A target several elements carry (the shelf's cards, the
 *  recipe cards) points at the first of them on screen; the rest are carried by one element each. */
export type TourTargetId =
  | 'modes' | `mode:${BuildMode}` | 'bar' | 'view3d' | 'assistant' | 'share' | 'menu' | 'load'
  | 'brush' | 'eraser' | 'add-layer' | 'generate-kinds' | 'recipe' | 'shelf-card' | 'shelf-brush' | 'share-tabs'
  | 'fit' | 'zoom-in' | 'zoom-out' | 'turn-left' | 'turn-right';

/** Mark an element as a tour target. Spread onto the element: `<div {...tourTargetAttr('menu')} />`. */
export function tourTargetAttr(id: TourTargetId): { 'data-tour-target': TourTargetId } {
  return { 'data-tour-target': id };
}

/** The selector for a target's carriers, for code that measures the live DOM (the spotlight, the Help
 *  figures): built from the typed id, so a renamed target is a compile error. */
export function tourTargetSelector(id: TourTargetId): string {
  return `[data-tour-target="${id}"]`;
}
