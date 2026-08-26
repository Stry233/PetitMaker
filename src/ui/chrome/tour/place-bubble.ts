/*
 * Where the tour's bubble goes, given the lit box it is pointing at.
 *
 * A step names a PREFERRED side, and that side is honoured only where the bubble actually fits
 * beside the spotlight. Clamping a bubble that does not fit puts it ON TOP of the control it is
 * describing: `clampLeft` pushes a box back inside the viewport, and beside a target near an
 * edge "inside the viewport" is the target itself.
 *
 * Everything here is in VISUAL px (what occupies screen), the units `getBoundingClientRect` reports
 * and the units `clampLeft`/`clampTop` reason in. The caller divides the chrome zoom back out.
 *
 * Pure, so the one thing that must always hold — the bubble never overlaps the spotlight — is a
 * property a test can state directly.
 */

export type BubbleSide = 'left' | 'right' | 'above' | 'below';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Kept off every viewport edge, matching `clampLeft`/`clampTop`'s own default. */
const MARGIN = 8;

/** The sides in the order they are tried once the preferred one has been ruled out. Opposite first:
 *  a target that leaves no room on one side usually has the most room on the other. */
const FALLBACK_ORDER: Record<BubbleSide, readonly BubbleSide[]> = {
  left: ['right', 'below', 'above'],
  right: ['left', 'below', 'above'],
  above: ['below', 'right', 'left'],
  below: ['above', 'right', 'left'],
};

/** How much room there is between the spotlight and the viewport edge on one side, gap included. */
function roomOn(side: BubbleSide, spot: Box, gap: number, viewport: Viewport): number {
  switch (side) {
    case 'left': return spot.left - gap - MARGIN;
    case 'right': return viewport.width - (spot.left + spot.width) - gap - MARGIN;
    case 'above': return spot.top - gap - MARGIN;
    case 'below': return viewport.height - (spot.top + spot.height) - gap - MARGIN;
  }
}

/** Clamp to the viewport on the axis the chosen side does NOT control: the main axis is what keeps
 *  the bubble clear of the spotlight, so clamping it would reintroduce the overlap. */
function clampCross(value: number, extent: number, limit: number): number {
  return Math.max(MARGIN, Math.min(value, limit - extent - MARGIN));
}

export interface BubblePlacement {
  left: number;
  top: number;
  /** The side actually used, which is the preferred one only when the bubble fits there. */
  side: BubbleSide;
}

/**
 * Place `size` beside `spot` on `preferred` if it fits there, else on the first fallback side that
 * fits, else on the side with the most room.
 *
 * `spot` is the LIT box (the target plus the overlay's inset), not the raw target rect: the bubble
 * has to clear what is drawn, not what was measured.
 */
export function placeBubble(
  spot: Box,
  size: { width: number; height: number },
  preferred: BubbleSide,
  gap: number,
  viewport: Viewport,
): BubblePlacement {
  const needed = (side: BubbleSide) => (side === 'left' || side === 'right' ? size.width : size.height);
  // The FRACTION of the bubble that fits, not the raw room: a side is judged against the extent
  // the bubble needs THERE, and the horizontal sides need the width where the vertical ones need
  // the height, so comparing raw px would pick a side by which axis happens to be longer.
  const fit = (s: BubbleSide) => roomOn(s, spot, gap, viewport) / needed(s);
  const order = [preferred, ...FALLBACK_ORDER[preferred]];
  const side =
    order.find((s) => fit(s) >= 1)
    // Nothing fits: overflow into the emptiest part of the screen rather than into whichever side
    // the fallback order happened to name first.
    ?? order.reduce((best, s) => (fit(s) > fit(best) ? s : best));

  switch (side) {
    case 'left':
      return { side, left: spot.left - gap - size.width, top: clampCross(spot.top, size.height, viewport.height) };
    case 'right':
      return { side, left: spot.left + spot.width + gap, top: clampCross(spot.top, size.height, viewport.height) };
    case 'above':
      return { side, top: spot.top - gap - size.height, left: clampCross(spot.left, size.width, viewport.width) };
    case 'below':
      return { side, top: spot.top + spot.height + gap, left: clampCross(spot.left, size.width, viewport.width) };
  }
}
