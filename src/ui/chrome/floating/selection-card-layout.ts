/**
 * Where the selection card stands. All lengths are VISUAL px (the projection's output); the card
 * divides its chrome zoom back out when it writes them.
 *
 * The card is a header row that grows a details body away from the selection. The header is placed
 * where the OPENED card also fits, so opening the details never moves the row the pointer is on:
 * above the selection, else below it, else beside it, growing toward whichever end has more room.
 * The card draws under the frame, so it keeps to the map area the frame leaves clear.
 */

export interface ScreenBounds { x: number; y: number; w: number; h: number }
interface ViewportSize { width: number; height: number }
export interface Area { left: number; top: number; right: number; bottom: number }
interface CardSize {
  /** Header row width and height. */
  w: number;
  h: number;
  /** Height the details body adds when open. */
  body: number;
}

export type CardSide = 'above' | 'below' | 'right' | 'left';

type CardPlacement =
  | { visible: false }
  | {
    visible: true;
    /** Header row's top-left corner. */
    left: number;
    top: number;
    side: CardSide;
    /** The body grows upward from the header (the header is the card's bottom row). */
    growUp: boolean;
    /** Where the pointer on the header's selection-facing edge touches it. */
    tail: { x: number; y: number };
  };

/** Clear air between the selection and the header, in visual px. */
export const CARD_GAP = 14;
/** Distance kept from the edge of the clear map area, in visual px. */
export const CARD_MARGIN = 8;

export function placeSelectionCard(
  bounds: ScreenBounds,
  size: CardSize,
  viewport: ViewportSize,
  area: Area = { left: 0, top: 0, right: viewport.width, bottom: viewport.height },
  gap = CARD_GAP,
  margin = CARD_MARGIN,
  /** A side to keep while it still fits, so a moving camera does not flip the card. */
  prefer?: CardSide,
): CardPlacement {
  const { x, y, w, h } = bounds;
  if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0
    || x + w < 0 || y + h < 0 || x > viewport.width || y > viewport.height) return { visible: false };
  // A partly visible selection keeps its card reachable: measure against the on-screen part.
  const l = Math.max(0, x), t = Math.max(0, y);
  const r = Math.min(viewport.width, x + w), b = Math.min(viewport.height, y + h);
  const cx = (l + r) / 2, cy = (t + b) / 2;
  const full = size.h + size.body;
  const minX = area.left + margin, maxX = area.right - margin, minY = area.top + margin, maxY = area.bottom - margin;
  const clampX = (v: number) => Math.max(minX, Math.min(maxX - size.w, v));
  const clampY = (v: number, span: number) => Math.max(minY, Math.min(maxY - span, v));

  const above = (): CardPlacement | null => {
    if (t - gap - full < minY) return null;
    // A selection partly under the frame still gets its header in the clear area.
    const top = Math.min(t - gap - size.h, maxY - size.h);
    const left = clampX(cx - size.w / 2);
    return { visible: true, left, top, side: 'above', growUp: true, tail: { x: tailX(cx, left, size.w), y: top + size.h } };
  };
  const below = (): CardPlacement | null => {
    if (b + gap + full > maxY) return null;
    const top = Math.max(b + gap, minY);
    const left = clampX(cx - size.w / 2);
    return { visible: true, left, top, side: 'below', growUp: false, tail: { x: tailX(cx, left, size.w), y: top } };
  };
  const beside = (right: boolean): CardPlacement => {
    const left = Math.max(minX, right ? Math.min(r + gap, maxX - size.w) : l - gap - size.w);
    const growUp = cy - minY > maxY - cy;
    // The header sits level with the selection, shifted only as far as the opened card needs.
    const want = cy - size.h / 2;
    const top = growUp ? Math.min(maxY - size.h, Math.max(minY + size.body, want)) : clampY(want, full);
    return {
      visible: true, left, top, side: right ? 'right' : 'left', growUp,
      tail: { x: right ? left : left + size.w, y: Math.max(top + size.h / 2 - 8, Math.min(top + size.h / 2 + 8, cy)) },
    };
  };
  const rightFits = r + gap + size.w <= maxX, leftFits = l - gap - size.w >= minX;

  if (prefer === 'above' || prefer === 'below') {
    const kept = prefer === 'above' ? above() : below();
    if (kept) return kept;
  } else if ((prefer === 'right' && rightFits) || (prefer === 'left' && leftFits)) return beside(prefer === 'right');
  return above() ?? below() ?? beside(rightFits || !leftFits);
}

/** The tail keeps clear of the header's rounded ends. */
function tailX(cx: number, left: number, width: number): number {
  const inset = Math.min(22, width / 2);
  return Math.max(left + inset, Math.min(left + width - inset, cx));
}
