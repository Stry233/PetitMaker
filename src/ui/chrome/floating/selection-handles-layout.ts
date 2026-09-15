/** Selection toolbar sizes depend on UI scale; the map camera only controls placement. */
import { clampLeft, clampTop } from '../../primitives/ClickCatcher';

/** Row constants, in CSS px (the row renders inside the chrome-zoom subtree, so the whole row scales
 *  with the rest of the chrome — but nothing here scales with the MAP camera). */
export const GROUP_BTN = 32;   // button diameter
export const GROUP_GAP = 6;   // between row items
export const GROUP_LIFT = 44;  // clear air between the anchor point and the row's bottom edge

/** Digit box for the count badge, so the row's predicted width is the width it actually renders at
 *  (the badge gets this exact width assigned; a `min-width` + text would make the two disagree). */
const BADGE_PAD = 8, BADGE_DIGIT = 9;

export interface RowMetrics {
  /** Button diameter (css px). */
  btn: number;
  /** Gap between row items (css px). */
  gap: number;
  /** Group count-badge width, in CSS px; zero for a single selection. */
  badge: number;
  /** Clear space below the row, in CSS px. */
  lift: number;
  /** Whole-row size (css px). */
  width: number;
  height: number;
}

/** The row's size for a given member count. A function of the count alone: no camera term exists. */
export function groupRowMetrics(count: number): RowMetrics {
  const digits = Math.max(1, String(Math.max(0, Math.trunc(count))).length);
  const badge = Math.max(GROUP_BTN, BADGE_PAD * 2 + digits * BADGE_DIGIT);
  return {
    btn: GROUP_BTN,
    gap: GROUP_GAP,
    badge,
    lift: GROUP_LIFT,
    width: GROUP_BTN * 2 + GROUP_GAP * 2 + badge,
    height: GROUP_BTN,
  };
}

/** The projected anchor point, in VISUAL px (i.e. `ViewProjection.cellToScreen`'s output, before the
 *  chrome zoom is divided back out — see SelectionHandles for why that division happens last). */
export interface ScreenAnchor { x: number; y: number; behind?: boolean }

export interface ViewportSize { width: number; height: number }

export type RowPlacement =
  | { visible: false }
  /** Position in CSS px with chrome zoom divided out; row dimensions come from its metrics. */
  | { visible: true; left: number; top: number };

export function placeControlRow(
  anchor: ScreenAnchor,
  metrics: RowMetrics,
  viewport: ViewportSize,
  chrome: number,
  margin = 8,
): RowPlacement {
  if (anchor.behind || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return { visible: false };
  if (anchor.x < 0 || anchor.x > viewport.width || anchor.y < 0 || anchor.y > viewport.height) {
    return { visible: false };
  }
  const visualW = metrics.width * chrome, visualH = metrics.height * chrome;
  const left = clampLeft(anchor.x - visualW / 2, metrics.width, chrome, margin, viewport.width);
  const top = clampTop(anchor.y - metrics.lift * chrome - visualH, metrics.height, chrome, margin, viewport.height);
  return { visible: true, left: left / chrome, top: top / chrome };
}

export function singleRowMetrics(actions: number): RowMetrics {
  return { btn: GROUP_BTN, gap: GROUP_GAP, badge: 0, lift: 12, width: actions * GROUP_BTN + Math.max(0, actions - 1) * GROUP_GAP, height: GROUP_BTN };
}

export interface ScreenBounds { x: number; y: number; w: number; h: number }

/** Partly visible selections keep their toolbar reachable at the viewport edge. */
export function placeSelectionRow(bounds: ScreenBounds, metrics: RowMetrics, viewport: ViewportSize, chrome: number): RowPlacement {
  const { x, y, w, h } = bounds;
  if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0
    || x + w < 0 || y + h < 0 || x > viewport.width || y > viewport.height) return { visible: false };
  return placeControlRow({
    x: Math.max(0, Math.min(viewport.width, x + w / 2)),
    y: Math.max(0, Math.min(viewport.height, y)),
  }, metrics, viewport, chrome);
}
