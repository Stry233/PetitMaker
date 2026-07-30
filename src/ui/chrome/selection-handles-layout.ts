/**
 * PURE layout for the plural (group) selection's control row.
 *
 * THE INVARIANT: fixed-size UI is positioned from a projected POINT, never from a projected BOX. A
 * box's screen extents are a function of the camera — orbit until the group's long axis points away
 * and the box collapses to a sliver, dolly in and it grows past the viewport — so anything pinned to
 * its corners drifts, converges and vanishes for reasons the user never asked for. A single point
 * projects predictably under any camera: it cannot collapse, invert, or explode with distance. So
 * the row is one anchor point plus CONSTANTS (button size, gap, badge width, lift), and the camera
 * changes only WHERE the row sits, never how big it is or how far apart its buttons are.
 *
 * Two decisions live here, testable without a camera:
 *  - HIDE when the anchor itself is unusable: behind the camera (the projection's `behind` flag), a
 *    non-finite projection, or a point outside the viewport. Hiding never strands the user — Escape
 *    always deselects (`selection.deselect` in ui/keybindings/commands.ts).
 *  - Otherwise place the row centred over the anchor and lifted above it, then TRANSLATE it into the
 *    viewport (never resize: the buttons must stay the same distance apart) with the same
 *    clampLeft/clampTop helpers ClickCatcher's popovers use.
 *
 * The single-selection path (2D footprint or 3D body-box anchor) never calls this: one object's box
 * is small and stable, so it keeps its exact existing placement — see SelectionHandles' `reposition`.
 */
import { clampLeft, clampTop } from './ClickCatcher';

/** Row constants, in CSS px (the row renders inside the chrome-zoom subtree, so the whole row scales
 *  with the rest of the chrome — but nothing here scales with the MAP camera). */
export const GROUP_BTN = 32;   // button diameter
export const GROUP_GAP = 10;   // between row items
export const GROUP_LIFT = 44;  // clear air between the anchor point and the row's bottom edge

/** Digit box for the count badge, so the row's predicted width is the width it actually renders at
 *  (the badge gets this exact width assigned; a `min-width` + text would make the two disagree). */
const BADGE_PAD = 8, BADGE_DIGIT = 9;

export interface RowMetrics {
  /** Button diameter (css px). */
  btn: number;
  /** Gap between row items (css px). */
  gap: number;
  /** Count-badge width (css px) — the only metric that varies, and only with the DIGIT COUNT. */
  badge: number;
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
  /** Already in CSS px (chrome divided out) — assign straight to `style.left`/`style.top`. The row's
   *  width/height come from `groupRowMetrics`, never from here: they are constants. */
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
  const top = clampTop(anchor.y - GROUP_LIFT * chrome - visualH, metrics.height, chrome, margin, viewport.height);
  return { visible: true, left: left / chrome, top: top / chrome };
}
