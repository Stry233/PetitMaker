/** Turning a blueprint body by quarter turns: its frame, cells, corner trims and objects turn as one. */
import { describe, expect, it } from 'vitest';
import { turnBody, type BlueprintBody, type BlueprintCell, type BlueprintObject } from '../../../tools/blueprint';
import { makeRng, type Rng } from '../../../core/base/rng';
import { CORNER_TRIMS, ROTATIONS, TerrainType, type Corners } from '../../../core/model/types';
import { getPlacedObjectSize } from '../../../state/object-geometry';

const STALL = 'building-stall';
const PAVILION = 'facility-pavilion';
const BRIDGE = 'bridge-iron';
const RAMP = 'ramp-grassy';
const ITEMS = [STALL, PAVILION, BRIDGE, RAMP, 'tree-apple', 'path-blue-board'] as const;

function randomBody(rng: Rng): BlueprintBody {
  const w = 1 + rng.int(8), h = 1 + rng.int(8);
  const cells: (BlueprintCell | null)[] = [];
  for (let i = 0; i < (w + 1) * (h + 1); i++) {
    if (rng.float() < 0.4) { cells.push(null); continue; }
    const corners = rng.float() < 0.5 ? undefined : ([0, 1, 2, 3].map(() => rng.pick(CORNER_TRIMS)) as Corners);
    cells.push({ type: rng.pick([TerrainType.Mountain, TerrainType.Water]), rise: rng.int(4), ...(corners ? { corners } : {}) });
  }
  const objects: BlueprintObject[] = [];
  for (let n = rng.int(5); n > 0; n--) {
    const catalogId = rng.pick(ITEMS);
    objects.push({
      // A bridge's rotation names its span axis, 0 or 90.
      catalogId, x: rng.int(w), y: rng.int(h), rotation: catalogId === BRIDGE ? rng.pick([0, 90] as const) : rng.pick(ROTATIONS), rise: rng.int(3),
      ...(catalogId === BRIDGE ? { spanLength: 3 + rng.int(4) } : {}),
      ...(rng.float() < 0.3 ? { corners: [0, 1, 2, 3].map(() => rng.pick(CORNER_TRIMS)) as Corners } : {}),
    });
  }
  return { w, h, cells, objects };
}

/** An object's footprint inside its body's frame. */
function footprint(o: BlueprintObject): { x: number; y: number; w: number; h: number } {
  const size = getPlacedObjectSize({ id: '', catalogId: o.catalogId, position: { x: o.x, y: o.y }, rotation: o.rotation, elevation: 0, spanLength: o.spanLength });
  return { x: o.x, y: o.y, ...size };
}

describe('turnBody', () => {
  it('four quarter turns give the body back', () => {
    for (let seed = 0; seed < 200; seed++) {
      const body = randomBody(makeRng(seed));
      let turned = body;
      for (let q = 0; q < 4; q++) turned = turnBody(turned, 1);
      expect(turned, `seed ${seed}`).toEqual(body);
      expect(turnBody(body, 4), `seed ${seed}`).toEqual(body);
      expect(turnBody(turnBody(body, 3), 1), `seed ${seed}`).toEqual(body);
    }
  });

  it('a quarter turn swaps width and height and moves the top-left cell to the top-right', () => {
    const cell: BlueprintCell = { type: TerrainType.Mountain, rise: 1 };
    const cells: (BlueprintCell | null)[] = Array.from({ length: 4 * 3 }, () => null);
    cells[0] = cell;
    const turned = turnBody({ w: 3, h: 2, cells, objects: [] }, 1);
    expect([turned.w, turned.h]).toEqual([2, 3]);
    expect(turned.cells).toHaveLength(3 * 4);
    expect(turned.cells.findIndex((c) => c !== null)).toBe(2);
    expect(turned.cells[2]).toEqual(cell);
  });

  it('turns corner trims with the cell', () => {
    const turned = turnBody({ w: 1, h: 1, cells: [{ type: TerrainType.Mountain, rise: 0, corners: ['tri-NW', 'square', 'square', 'square'] }, null, null, null], objects: [] }, 1);
    expect(turned.cells[1]).toEqual({ type: TerrainType.Mountain, rise: 0, corners: ['square', 'tri-NE', 'square', 'square'] });
  });

  it("turns an object's rotation and keeps its footprint inside the frame", () => {
    const body: BlueprintBody = {
      w: 8, h: 7, cells: Array.from({ length: 9 * 8 }, () => null),
      objects: [
        { catalogId: PAVILION, x: 1, y: 0, rotation: 0, rise: 0 },
        { catalogId: BRIDGE, x: 0, y: 5, rotation: 0, rise: 1, spanLength: 4 },
      ],
    };
    const turned = turnBody(body, 1);
    expect(turned.objects).toEqual([
      { catalogId: PAVILION, x: 2, y: 1, rotation: 90, rise: 0 },
      { catalogId: BRIDGE, x: 0, y: 0, rotation: 90, rise: 1, spanLength: 4 },
    ]);
    for (const q of [1, 2, 3]) {
      const t = turnBody(body, q);
      for (const o of t.objects) {
        const f = footprint(o);
        expect(f.x >= 0 && f.y >= 0 && f.x + f.w <= t.w && f.y + f.h <= t.h, `${o.catalogId} after ${q}`).toBe(true);
      }
    }
    expect(footprint(turned.objects[1]!), 'the span runs along the turned axis').toMatchObject({ w: 2, h: 4 });
  });

  it('turns a ramp\'s facing with the body, so it still runs down the turned cliff', () => {
    const body: BlueprintBody = {
      w: 4, h: 3, cells: Array.from({ length: 5 * 4 }, () => null), objects: [{ catalogId: RAMP, x: 1, y: 0, rotation: 0, rise: 1 }],
    };
    // Downhill +y (rotation 0) turns to downhill -x (rotation 270).
    expect(turnBody(body, 1).objects).toEqual([{ catalogId: RAMP, x: 1, y: 1, rotation: 270, rise: 1 }]);
    expect(turnBody(body, 2).objects).toEqual([{ catalogId: RAMP, x: 1, y: 1, rotation: 180, rise: 1 }]);
  });

  it('keeps the facing of an item the catalog does not know', () => {
    const body: BlueprintBody = {
      w: 2, h: 2, cells: Array.from({ length: 9 }, () => null), objects: [{ catalogId: 'no-such-item', x: 0, y: 0, rotation: 90, rise: 0 }],
    };
    expect(turnBody(body, 1).objects).toEqual([{ catalogId: 'no-such-item', x: 1, y: 0, rotation: 90, rise: 0 }]);
  });
});
