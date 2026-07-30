/**
 * The pure layout behind the plural-selection control row. Two properties matter and both are
 * camera-free by construction, which is the point: the row's SIZE is a function of the member count
 * alone (so no camera framing can move its buttons closer together), and its PLACEMENT is a function
 * of one anchor POINT (so nothing degenerates the way a projected box does).
 */
import { describe, it, expect } from 'vitest';
import {
  groupRowMetrics, placeControlRow, GROUP_BTN, GROUP_GAP, GROUP_LIFT,
} from '../../ui/chrome/selection-handles-layout';

const VIEWPORT = { width: 1024, height: 768 };

describe('groupRowMetrics', () => {
  it('takes no camera term: the row is button + gap + badge + gap + button, all constants', () => {
    // The signature is the proof — there is nowhere for a scale/zoom/projection to enter — and these
    // are the values the row actually renders at.
    const m = groupRowMetrics(3);
    expect(m.btn).toBe(GROUP_BTN);
    expect(m.gap).toBe(GROUP_GAP);
    expect(m.height).toBe(GROUP_BTN);
    expect(m.width).toBe(GROUP_BTN * 2 + GROUP_GAP * 2 + m.badge);
  });

  it('grows only with the DIGIT count of the badge, never below the button size', () => {
    const two = groupRowMetrics(2), nine = groupRowMetrics(9);
    expect(nine).toEqual(two);                              // same digits ⇒ same row
    expect(groupRowMetrics(12).badge).toBeGreaterThan(two.badge);
    expect(groupRowMetrics(120).badge).toBeGreaterThan(groupRowMetrics(12).badge);
    expect(two.badge).toBeGreaterThanOrEqual(GROUP_BTN);
  });
});

describe('placeControlRow', () => {
  const m = groupRowMetrics(3);

  it('centres the row over the anchor and lifts it clear, at chrome 1', () => {
    const p = placeControlRow({ x: 500, y: 400 }, m, VIEWPORT, 1);
    expect(p.visible).toBe(true);
    if (!p.visible) throw new Error('unreachable');
    expect(p.left).toBe(500 - m.width / 2);
    expect(p.top).toBe(400 - GROUP_LIFT - m.height);
  });

  it('keeps the anchor-relative offset when the chrome zoom changes (the divide-out is symmetric)', () => {
    // The row lives in a `zoom: chrome` subtree, so a css coord renders at coord*chrome. Multiplying
    // the returned css coords back by the zoom must land the row's centre back on the anchor.
    for (const chrome of [0.5, 1, 1.75]) {
      const p = placeControlRow({ x: 500, y: 400 }, m, VIEWPORT, chrome);
      if (!p.visible) throw new Error('unreachable');
      expect(p.left * chrome + (m.width * chrome) / 2).toBeCloseTo(500, 6);
      expect(p.top * chrome + m.height * chrome + GROUP_LIFT * chrome).toBeCloseTo(400, 6);
    }
  });

  it('a row nudged past an edge is TRANSLATED into the viewport, never resized', () => {
    // Left, right, top and bottom in turn: the placement stays inside the margin, and the row keeps
    // its metrics (the caller reads width/height from groupRowMetrics, which no clamp can touch — so
    // the distance between the buttons is invariant even at an edge).
    const cases = [
      { x: 2, y: 400 }, { x: VIEWPORT.width - 2, y: 400 },
      { x: 500, y: 2 }, { x: 500, y: VIEWPORT.height - 2 },
    ];
    for (const anchor of cases) {
      const p = placeControlRow(anchor, m, VIEWPORT, 1);
      expect(p.visible).toBe(true);
      if (!p.visible) throw new Error('unreachable');
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.left + m.width).toBeLessThanOrEqual(VIEWPORT.width - 8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.top + m.height).toBeLessThanOrEqual(VIEWPORT.height - 8);
    }
  });

  it('hides for an anchor BEHIND the camera (the coords come back finite but mirrored)', () => {
    expect(placeControlRow({ x: 500, y: 400, behind: true }, m, VIEWPORT, 1)).toEqual({ visible: false });
  });

  it('hides for an anchor off-screen on any side, and for a non-finite projection', () => {
    for (const anchor of [
      { x: -1, y: 400 }, { x: VIEWPORT.width + 1, y: 400 },
      { x: 500, y: -1 }, { x: 500, y: VIEWPORT.height + 1 },
      { x: NaN, y: 400 }, { x: 500, y: Infinity },
    ]) {
      expect(placeControlRow(anchor, m, VIEWPORT, 1)).toEqual({ visible: false });
    }
  });

  it('an anchor ON screen is never hidden, however extreme the framing that produced it', () => {
    // The old box path hid whenever the projected box degenerated — a collapsed sliver under an
    // end-on orbit, or a box bigger than the screen from a close camera. A point has no extent, so no
    // framing is left that can hide a selection the user can see.
    for (const anchor of [{ x: 0, y: 0 }, { x: VIEWPORT.width, y: VIEWPORT.height }, { x: 1, y: 767 }]) {
      expect(placeControlRow(anchor, m, VIEWPORT, 1).visible).toBe(true);
    }
  });
});
