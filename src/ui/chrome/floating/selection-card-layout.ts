/**
 * Where the selection card stands. All lengths are visual px (the projection's output); the card
 * divides its chrome zoom back out when it writes them.
 *
 * The card is a header row that grows a details body away from the selection. The header is placed
 * where the opened card also fits, so opening the details never moves the row the pointer is on:
 * above the selection, else below it, else beside it, growing toward whichever end has more room.
 * The card draws under the frame, so it keeps to the map area the frame leaves clear.
 */

export interface ScreenBounds { x: number; y: number; w: number; h: number }
export interface ViewportSize { width: number; height: number }
export interface Area { left: number; top: number; right: number; bottom: number }
export interface CardSize {
  /** Header row width and height. */
  w: number;
  h: number;
  /** Height the details body adds when open. */
  body: number;
}

export type CardSide = 'above' | 'below' | 'right' | 'left';

export type CardPlacement =
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

/** A placement that shows the card. */
export type ShownPlacement = Extract<CardPlacement, { visible: true }>;

/** Clear air between the selection and the header, in visual px. */
const CARD_GAP = 14;
/** Distance kept from the edge of the clear map area, in visual px. */
const CARD_MARGIN = 8;

export function placeSelectionCard(
  bounds: ScreenBounds,
  size: CardSize,
  viewport: ViewportSize,
  opts: {
    area?: Area;
    gap?: number;
    margin?: number;
    /** A side to keep while it still fits, so a moving camera does not flip the card. */
    prefer?: CardSide;
  } = {},
): CardPlacement {
  const { area = { left: 0, top: 0, right: viewport.width, bottom: viewport.height }, gap = CARD_GAP, margin = CARD_MARGIN, prefer } = opts;
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

/** The readings that decide whether the card re-reads its place: who is selected, where they stand,
 *  how they face, where the camera is, and the frame the card is drawn in. */
export interface PlaceSignature {
  members: string;
  positions: string;
  rotations: string;
  camera: string;
  frame: string;
}

/** The place the card holds, with the readings it was taken under. */
export interface HeldPlace extends PlaceSignature {
  bounds: ScreenBounds;
  side?: CardSide;
}

/**
 * How a new reading treats the held place. The card keeps its bounds through the selection's own
 * edits: the same members, camera and frame, with positions unchanged or moved by a turn of their
 * own (or a group rotation that has just landed, `adopt`). Over the same members it prefers its
 * side, and it travels to a new place only while the camera stands still.
 */
export function holdPlace(held: HeldPlace | null, next: PlaceSignature, adopt: boolean): { keep: boolean; prefer?: CardSide; travel: boolean } {
  if (!held || held.members !== next.members) return { keep: false, travel: false };
  const still = held.camera === next.camera;
  const keep = still && held.frame === next.frame
    && (held.positions === next.positions || held.rotations !== next.rotations || adopt);
  return { keep, ...(held.side ? { prefer: held.side } : {}), travel: still };
}

/** Where the card's box stands, in css px for a card drawn at `zoom`: its left edge, the edge the
 *  header is pinned to (the bottom when the body grows up), and the room its details may fill. */
export function cardBoxStyle(
  p: ShownPlacement, size: CardSize, viewport: ViewportSize, area: Area, fit: { zoom: number; minRoom: number },
): { left: number; top: number | null; bottom: number | null; detailsMax: number } {
  const { zoom, minRoom } = fit;
  const room = p.growUp ? p.top - area.top - CARD_MARGIN : area.bottom - CARD_MARGIN - p.top - size.h;
  return {
    left: p.left / zoom,
    top: p.growUp ? null : p.top / zoom,
    bottom: p.growUp ? (viewport.height - p.top - size.h) / zoom : null,
    detailsMax: Math.max(minRoom, room / zoom),
  };
}

/**
 * The pointer's box and the card's transform origin, in css px. The pointer is a square of side
 * `tail` turned 45 degrees whose centre sits on the header's selection-facing edge; `scale` is the
 * factor the edge painter draws lengths at (2 on WebKit), and `row` is the header's height.
 */
export function tailStyle(
  p: ShownPlacement, zoom: number, tail: number, row: number, scale: number,
): { box: Record<'left' | 'right' | 'top' | 'bottom' | 'width' | 'height', string>; origin: string } {
  const lx = (p.tail.x - p.left) / zoom, ly = (p.tail.y - p.top) / zoom;
  const half = tail / 2;
  const px = (v: number) => `${v * scale}px`;
  const box = { left: '', right: '', top: '', bottom: '', width: px(tail), height: px(tail) };
  if (p.side === 'above' || p.side === 'below') {
    box.left = px(lx - half);
    box[p.side === 'above' ? 'bottom' : 'top'] = px(-half);
  } else {
    box[p.side === 'right' ? 'left' : 'right'] = px(-half);
    if (p.growUp) box.bottom = px(row - ly - half); else box.top = px(ly - half);
  }
  const origin = p.side === 'right' ? `0 ${ly}px` : p.side === 'left' ? `100% ${ly}px` : `${lx}px ${p.growUp ? '100%' : '0'}`;
  return { box, origin };
}
