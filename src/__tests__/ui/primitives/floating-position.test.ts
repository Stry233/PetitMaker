import { describe, expect, it } from 'vitest';
import { placeFloating } from '../../../ui/primitives/floating-position';

describe('floating placement', () => {
  it('keeps the complete card inside every viewport edge at different scales', () => {
    for (const zoom of [0.5, 1, 2]) for (const [x, y] of [[1, 1], [1190, 1], [1, 890], [1190, 890]]) {
      const { box } = placeFloating({ anchor: { left: x!, right: x!, top: y!, bottom: y!, width: 0 }, zoom,
        width: 350, height: 220, viewport: { width: 1200, height: 900 } });
      expect(Number(box.left) * zoom).toBeGreaterThanOrEqual(8);
      expect((Number(box.left) + Number(box.width)) * zoom).toBeLessThanOrEqual(1192);
      expect(Number(box.top) * zoom).toBeGreaterThanOrEqual(8);
      expect((Number(box.top) + Math.min(220, Number(box.maxHeight))) * zoom).toBeLessThanOrEqual(892);
    }
  });

  it('lines an end-aligned card up with the anchor\'s right edge', () => {
    const { box } = placeFloating({ anchor: { left: 400, right: 500, top: 20, bottom: 60, width: 100 },
      width: 150, height: 200, zoom: 2, align: 'end', viewport: { width: 1200, height: 900 } });
    expect((Number(box.left) + Number(box.width)) * 2).toBe(500);
  });

  it('flips above the anchor and caps oversized content to the available space', () => {
    const placed = placeFloating({ anchor: { left: 350, right: 550, top: 330, bottom: 360, width: 200 },
      width: 800, height: 900, zoom: 1, gap: 6, viewport: { width: 600, height: 400 } });
    expect(placed.above).toBe(true);
    expect(placed.box.width).toBe(584);
    expect(placed.box.maxHeight).toBe(316);
    expect(placed.box.top).toBe(8);
  });

  it('reports where the anchor falls along the card, also when the card is held off the window edge', () => {
    const viewport = { width: 400, height: 900 };
    const centred = placeFloating({ anchor: { left: 150, right: 250, top: 20, bottom: 60, width: 100 },
      width: 100, height: 100, zoom: 2, align: 'center', viewport });
    expect(centred.anchorX).toBe(50);
    const held = placeFloating({ anchor: { left: 300, right: 380, top: 20, bottom: 60, width: 80 },
      width: 100, height: 100, zoom: 2, align: 'center', viewport });
    expect(Number(held.box.left) * 2).toBe(192);
    expect(held.anchorX * 2).toBe(340 - 192);
  });

  it('reports the room the window leaves the card on its side, in the card\'s px', () => {
    const below = placeFloating({ anchor: { left: 100, right: 200, top: 20, bottom: 60, width: 100 },
      width: 100, height: 100, zoom: 2, gap: 8, viewport: { width: 400, height: 900 } });
    expect(below.above).toBe(false);
    expect(below.room * 2).toBe(900 - 60 - 16 - 8);
    expect(Number(below.box.maxHeight)).toBe(below.room);
  });
});
