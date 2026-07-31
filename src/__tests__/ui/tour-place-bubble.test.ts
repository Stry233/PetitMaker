/**
 * Where the tour bubble lands beside the thing it is describing. The property that matters is that
 * the two boxes never intersect: a bubble clamped back into the viewport used to land ON the
 * control the step was pointing at.
 */
import { describe, it, expect } from 'vitest';
import { placeBubble, type Box } from '../../ui/chrome/tour/place-bubble';

const VIEWPORT = { width: 1600, height: 900 };
const SIZE = { width: 340, height: 200 };
const GAP = 18;

function intersects(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width
    && a.top < b.top + b.height && b.top < a.top + a.height;
}

function asBox(p: { left: number; top: number }): Box {
  return { left: p.left, top: p.top, ...SIZE };
}

describe('placeBubble', () => {
  it('uses the preferred side when the bubble fits there', () => {
    const spot: Box = { left: 700, top: 400, width: 100, height: 60 };
    const placed = placeBubble(spot, SIZE, 'right', GAP, VIEWPORT);
    expect(placed.side).toBe('right');
    expect(placed.left).toBe(spot.left + spot.width + GAP);
  });

  it('places a bubble to the LEFT of a target near the right edge, clear of the spotlight', () => {
    // The layer panel's buttons sit here: preferring 'right' leaves 21px, so the old clamp pushed
    // the bubble back over the button it was describing.
    const spot: Box = { left: 1521, top: 34, width: 62, height: 55 };
    const placed = placeBubble(spot, SIZE, 'right', GAP, VIEWPORT);
    expect(placed.side).toBe('left');
    expect(placed.left + SIZE.width).toBeLessThanOrEqual(spot.left);
    expect(intersects(asBox(placed), spot)).toBe(false);
  });

  it('honours a left preference at the right edge without moving the bubble', () => {
    const spot: Box = { left: 1521, top: 34, width: 62, height: 55 };
    const placed = placeBubble(spot, SIZE, 'left', GAP, VIEWPORT);
    expect(placed.side).toBe('left');
    expect(placed.left).toBe(spot.left - GAP - SIZE.width);
    expect(intersects(asBox(placed), spot)).toBe(false);
  });

  it('goes below a target hugging the left edge, since neither side has room', () => {
    const spot: Box = { left: 4, top: 300, width: 40, height: 40 };
    const placed = placeBubble(spot, SIZE, 'left', GAP, VIEWPORT);
    expect(placed.side).toBe('right');
    expect(intersects(asBox(placed), spot)).toBe(false);
  });

  it('drops to above/below when a wide target leaves no room either side', () => {
    const spot: Box = { left: 200, top: 600, width: 1200, height: 80 };
    const placed = placeBubble(spot, SIZE, 'right', GAP, VIEWPORT);
    expect(placed.side).toBe('above');
    expect(placed.top + SIZE.height).toBeLessThanOrEqual(spot.top);
    expect(intersects(asBox(placed), spot)).toBe(false);
  });

  it('never overlaps the spotlight, wherever the target is', () => {
    const sides = ['left', 'right', 'above', 'below'] as const;
    for (const side of sides) {
      for (let x = 0; x <= VIEWPORT.width - 60; x += 60) {
        for (let y = 0; y <= VIEWPORT.height - 60; y += 60) {
          const spot: Box = { left: x, top: y, width: 60, height: 60 };
          const placed = placeBubble(spot, SIZE, side, GAP, VIEWPORT);
          expect(intersects(asBox(placed), spot), `${side} at ${x},${y}`).toBe(false);
        }
      }
    }
  });

  it('takes the roomiest side when the bubble fits nowhere', () => {
    // A viewport smaller than the bubble: something has to overflow, and it should overflow into
    // the emptiest part of the screen rather than into whichever side was declared first.
    const tiny = { width: 300, height: 260 };
    const spot: Box = { left: 200, top: 20, width: 60, height: 60 };
    const placed = placeBubble(spot, SIZE, 'right', GAP, tiny);
    expect(placed.side).toBe('below');
    expect(intersects(asBox(placed), spot)).toBe(false);
  });

  it('keeps the cross axis inside the viewport', () => {
    // A target at the very bottom: the bubble sits beside it, but its top is lifted so the card
    // does not run off the bottom edge.
    const spot: Box = { left: 700, top: 860, width: 40, height: 30 };
    const placed = placeBubble(spot, SIZE, 'right', GAP, VIEWPORT);
    expect(placed.side).toBe('right');
    expect(placed.top + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height);
  });
});
