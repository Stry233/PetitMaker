/** The selection card's header is placed where the opened card also fits, inside the viewport. */
import { describe, it, expect } from 'vitest';
import { cardBoxStyle, holdPlace, placeSelectionCard, tailStyle } from '../../../../ui/chrome/floating/selection-card-layout';

/** The card's default gap from its anchor and its margin from the area's edges, in css px. */
const CARD_GAP = 14;
const CARD_MARGIN = 8;

const VIEWPORT = { width: 1024, height: 768 };
const SIZE = { w: 280, h: 48, body: 160 };

function shown(p: ReturnType<typeof placeSelectionCard>) {
  if (!p.visible) throw new Error('expected a visible placement');
  return p;
}

describe('placeSelectionCard', () => {
  it('stands above the selection, centred, when the opened card fits there', () => {
    const p = shown(placeSelectionCard({ x: 500, y: 400, w: 40, h: 40 }, SIZE, VIEWPORT));
    expect(p).toMatchObject({ side: 'above', growUp: true, left: 520 - SIZE.w / 2, top: 400 - CARD_GAP - SIZE.h });
    expect(p.tail).toEqual({ x: 520, y: 400 - CARD_GAP });
  });

  it('stands below when only the space below holds the opened card', () => {
    const p = shown(placeSelectionCard({ x: 500, y: 100, w: 40, h: 40 }, SIZE, VIEWPORT));
    expect(p).toMatchObject({ side: 'below', growUp: false, top: 140 + CARD_GAP });
  });

  it('stands beside the selection when neither end holds the opened card, and never over it', () => {
    const tall = { x: 500, y: 150, w: 60, h: 460 };
    const p = shown(placeSelectionCard(tall, SIZE, VIEWPORT));
    expect(p.side).toBe('right');
    expect(p.left).toBeGreaterThanOrEqual(tall.x + tall.w);
    const top = p.growUp ? p.top - SIZE.body : p.top;
    expect(top).toBeGreaterThanOrEqual(CARD_MARGIN);
    expect(top + SIZE.h + SIZE.body).toBeLessThanOrEqual(VIEWPORT.height - CARD_MARGIN);
  });

  it('goes to the left when the right has no room', () => {
    const p = shown(placeSelectionCard({ x: 900, y: 150, w: 60, h: 460 }, SIZE, VIEWPORT));
    expect(p.side).toBe('left');
    expect(p.left + SIZE.w).toBeLessThanOrEqual(900);
  });

  it('keeps a partly visible selection reachable at every edge', () => {
    for (const bounds of [
      { x: -20, y: 400, w: 30, h: 30 }, { x: 1010, y: 400, w: 30, h: 30 },
      { x: 500, y: -20, w: 30, h: 30 }, { x: 500, y: 760, w: 30, h: 30 },
    ]) {
      const p = shown(placeSelectionCard(bounds, SIZE, VIEWPORT));
      expect(p.left).toBeGreaterThanOrEqual(CARD_MARGIN);
      expect(p.left + SIZE.w).toBeLessThanOrEqual(VIEWPORT.width - CARD_MARGIN);
      expect(p.top).toBeGreaterThanOrEqual(CARD_MARGIN);
      expect(p.top + SIZE.h).toBeLessThanOrEqual(VIEWPORT.height - CARD_MARGIN);
    }
  });

  it('hides fully off-screen or invalid bounds', () => {
    for (const bounds of [{ x: -40, y: 200, w: 30, h: 30 }, { x: NaN, y: 200, w: 30, h: 30 }]) {
      expect(placeSelectionCard(bounds, SIZE, VIEWPORT)).toEqual({ visible: false });
    }
  });
});

describe('placeSelectionCard inside the clear map area', () => {
  const AREA = { left: 0, top: 120, right: 900, bottom: 560 };

  it('keeps the opened card out of the frame at the top and bottom', () => {
    const p = shown(placeSelectionCard({ x: 400, y: 200, w: 40, h: 40 }, SIZE, VIEWPORT, { area: AREA }));
    const top = p.growUp ? p.top - SIZE.body : p.top;
    expect(top).toBeGreaterThanOrEqual(AREA.top + CARD_MARGIN);
    expect(top + SIZE.h + SIZE.body).toBeLessThanOrEqual(AREA.bottom - CARD_MARGIN);
  });

  it('keeps clear of the right-hand column', () => {
    const p = shown(placeSelectionCard({ x: 880, y: 300, w: 40, h: 40 }, SIZE, VIEWPORT, { area: AREA }));
    expect(p.left + SIZE.w).toBeLessThanOrEqual(AREA.right - CARD_MARGIN);
  });
});

describe('placeSelectionCard for a selection partly under the frame', () => {
  it('still puts the header in the clear area', () => {
    const AREA = { left: 0, top: 120, right: 900, bottom: 560 };
    const p = shown(placeSelectionCard({ x: 400, y: 600, w: 40, h: 40 }, SIZE, VIEWPORT, { area: AREA }));
    expect(p.top + SIZE.h).toBeLessThanOrEqual(AREA.bottom - CARD_MARGIN);
  });
});

describe('the held place', () => {
  const at = { members: 'a', positions: '1,1', rotations: '0', camera: 'c', frame: 'f' };
  const held = { ...at, bounds: { x: 0, y: 0, w: 1, h: 1 }, side: 'below' as const };

  it('holds through a turn of its own and re-reads after a move', () => {
    expect(holdPlace(held, { ...at, positions: '2,1', rotations: '90' }, false).keep).toBe(true);
    expect(holdPlace(held, { ...at, positions: '2,1' }, false).keep).toBe(false);
    expect(holdPlace(held, { ...at, positions: '2,1' }, true).keep).toBe(true);
  });

  it('keeps its side under a moving camera without travelling', () => {
    expect(holdPlace(held, { ...at, camera: 'd' }, false)).toEqual({ keep: false, prefer: 'below', travel: false });
    expect(holdPlace(held, { ...at, members: 'b' }, false)).toEqual({ keep: false, travel: false });
  });
});

describe('the drawn card', () => {
  it('pins a card that grows up by its bottom edge, at the chrome zoom', () => {
    const p = shown(placeSelectionCard({ x: 400, y: 500, w: 40, h: 40 }, SIZE, VIEWPORT));
    const style = cardBoxStyle(p, SIZE, VIEWPORT, { left: 0, top: 0, right: 1024, bottom: 768 }, { zoom: 2, minRoom: 96 });
    expect(p.growUp).toBe(true);
    expect(style.top).toBeNull();
    expect(style.bottom).toBe((VIEWPORT.height - p.top - SIZE.h) / 2);
    expect(style.left).toBe(p.left / 2);
  });

  it('puts the pointer on the edge that faces the selection', () => {
    const p = shown(placeSelectionCard({ x: 400, y: 500, w: 40, h: 40 }, SIZE, VIEWPORT));
    const { box } = tailStyle(p, 1, 14, 48, 1);
    expect(p.side).toBe('above');
    expect(box.bottom).toBe('-7px');
    expect(box.top).toBe('');
  });
});
