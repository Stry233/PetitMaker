/** What objects need from the ground and from one another. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world } from '../_world';
import { build, inStroke, move, peel, placed, turn } from './_rules';

const M = TerrainType.Mountain;
const W = TerrainType.Water;

describe('objects and terrain', () => {
  spec('V-PLACE-BLOCK', 'refuses terrain on a cell a tree reaches across the half-cell offset and takes it one cell further', () => {
    const w = world();
    const at = w.openGround(4, 3);
    placed(w, 'tree-apple', at.x, at.y);
    const before = w.fingerprint();
    expect(w.stroke([at], M, 1).refusedBy).toContain('V-PLACE-BLOCK');
    expect(w.stroke([{ x: at.x + 1, y: at.y + 1 }], M, 1).refusedBy).toContain('V-PLACE-BLOCK');
    expect(w.fingerprint()).toBe(before);
    expect(w.stroke([{ x: at.x + 2, y: at.y }], M, 1).ok).toBe(true);
  });

  spec('V-PLACE-BLOCK', 'refuses erasing terrain under a tree and takes the cell beside it', () => {
    const w = world();
    const at = w.openGround(4, 3);
    build(w, [rect(at, 4, 3), M, 1]);
    placed(w, 'tree-apple', at.x, at.y, { elevation: 1 });
    const before = w.fingerprint();
    expect(peel(w, [{ x: at.x + 1, y: at.y + 1 }]).refusedBy).toContain('V-PLACE-BLOCK');
    expect(w.fingerprint()).toBe(before);
    expect(peel(w, [{ x: at.x + 3, y: at.y }]).ok).toBe(true);
  });

  spec('V-PLACE-BLOCK', 'carries a road up with the mountain painted under it and refuses water there', () => {
    const w = world();
    const at = w.openGround(3, 3);
    const road = placed(w, 'path-blue-board', at.x, at.y);
    const before = w.fingerprint();
    expect(w.stroke([at], W, 1).refusedBy).toContain('V-PLACE-BLOCK');
    expect(w.fingerprint()).toBe(before);
    expect(w.stroke(rect(at, 2, 2), M, 1).ok).toBe(true);
    expect(w.object(road.id)?.elevation).toBe(1);
  });
});

describe('what each item needs', () => {
  spec('V-PLACE-TRAIT', 'refuses a tree whose ground reaches a raised cell across the half-cell offset and takes it one column over', () => {
    const w = world();
    const at = w.openGround(4, 3);
    const block = { x: at.x + 2, y: at.y + 1 };
    build(w, [[block], M, 1]);
    const before = w.fingerprint();
    expect(w.place('tree-apple', block.x - 1, block.y - 1).refusedBy).toContain('V-PLACE-TRAIT');
    expect(w.fingerprint()).toBe(before);
    expect(w.place('tree-apple', block.x - 2, block.y - 1).ok).toBe(true);
  });

  spec('V-PLACE-TRAIT', 'refuses a road on water and takes it on dry ground', () => {
    const w = world();
    const at = w.openGround(6, 3);
    const pool = { x: at.x + 1, y: at.y + 1 };
    build(w, [rect(at, 3, 3).filter((c) => c.x !== pool.x || c.y !== pool.y), M, 1], [[pool], W, 1]);
    const before = w.fingerprint();
    expect(w.place('path-blue-board', pool.x, pool.y, { elevation: 1 }).refusedBy).toContain('V-PLACE-TRAIT');
    expect(w.fingerprint()).toBe(before);
    expect(w.place('path-blue-board', at.x + 4, at.y).ok).toBe(true);
  });

  spec('V-PLACE-TRAIT', 'keeps trees a cell apart at their sides and corners', () => {
    const w = world();
    const at = w.openGround(4, 4);
    placed(w, 'tree-apple', at.x, at.y);
    const before = w.fingerprint();
    expect(w.place('tree-apple', at.x + 1, at.y).refusedBy).toContain('V-PLACE-TRAIT');
    expect(w.place('tree-apple', at.x + 1, at.y + 1).refusedBy).toContain('V-PLACE-TRAIT');
    expect(w.fingerprint()).toBe(before);
    expect(w.place('tree-apple', at.x + 2, at.y + 2).ok).toBe(true);
  });

  spec('V-PLACE-TRAIT', 'refuses a tree on a half cell and takes a ramp there', () => {
    const w = world();
    const at = w.openGround(6, 9);
    build(w, [rect(at, 6, 6), M, 1]);
    const before = w.fingerprint();
    expect(w.place('tree-apple', at.x + 2.5, at.y + 7).refusedBy).toContain('V-PLACE-TRAIT');
    expect(w.fingerprint()).toBe(before);
    const ramp = w.place('ramp-grassy', at.x + 2.5, at.y + 6);
    expect(ramp.ok).toBe(true);
    expect(Number.isInteger(w.object(ramp.id!)!.position.x)).toBe(false);
  });

  /** Two plateaus one level up with `gap` cells of ground between them, and a bridge dropped into the gap. */
  function bridgeOver(gap: number) {
    const w = world();
    const at = w.openGround(12, 4);
    build(w, [[...rect(at, 3, 4), ...rect({ x: at.x + 3 + gap, y: at.y }, 3, 4)], M, 1]);
    const before = w.fingerprint();
    const outcome = w.place('bridge-iron', at.x + 3, at.y + 1);
    return { w, at, before, outcome };
  }

  spec('V-PLACE-TRAIT', 'snaps a bridge across a gap of three to six cells and refuses two or seven', () => {
    for (const gap of [2, 7]) {
      const { w, before, outcome } = bridgeOver(gap);
      expect(outcome.refusedBy).toContain('V-PLACE-TRAIT');
      expect(w.fingerprint()).toBe(before);
    }
    for (const gap of [3, 6]) {
      const { w, at, outcome } = bridgeOver(gap);
      expect(outcome.ok).toBe(true);
      expect(w.object(outcome.id!)).toMatchObject({ position: { x: at.x + 2 }, elevation: 1, spanLength: gap + 1 });
    }
  });

  spec('V-PLACE-TRAIT', 'refuses a bridge between ends of different heights', () => {
    const w = world();
    const at = w.openGround(12, 4);
    const far = rect({ x: at.x + 6, y: at.y }, 3, 4);
    build(w, [[...rect(at, 3, 4), ...far], M, 1], [far, M, 2]);
    const before = w.fingerprint();
    expect(w.place('bridge-iron', at.x + 3, at.y + 1).refusedBy).toContain('V-PLACE-TRAIT');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-PLACE-TRAIT', 'snaps a one-level ramp onto a one-level cliff and refuses it at a two-level cliff', () => {
    const low = world();
    const at = low.openGround(6, 9);
    build(low, [rect(at, 6, 6), M, 1]);
    expect(low.place('ramp-grassy', at.x + 2, at.y + 6).ok).toBe(true);

    const high = world();
    build(high, [rect(at, 6, 6), M, 1], [rect(at, 6, 6), M, 2]);
    const before = high.fingerprint();
    expect(high.place('ramp-grassy', at.x + 2, at.y + 6).refusedBy).toContain('V-PLACE-TRAIT');
    expect(high.fingerprint()).toBe(before);
  });
});

describe('a house door', () => {
  const HOUSE = 'building-bamboo-cabin';

  spec('V-PLACE-DOOR', 'refuses a house with higher ground within two and a half cells of its door and takes it at two and a half', () => {
    // The 5-by-5 house's door side is its bottom edge, at y + 5; terrain cell row r covers [r - 0.5, r + 0.5).
    const near = world();
    const at = near.openGround(5, 9);
    build(near, [[{ x: at.x + 2, y: at.y + 7 }], M, 1]);
    const before = near.fingerprint();
    expect(near.place(HOUSE, at.x, at.y).refusedBy).toContain('V-PLACE-DOOR');
    expect(near.fingerprint()).toBe(before);

    const far = world();
    build(far, [[{ x: at.x + 2, y: at.y + 8 }], M, 1]);
    expect(far.place(HOUSE, at.x, at.y).ok).toBe(true);
  });

  spec('V-PLACE-DOOR', 'refuses lowering the ground within one and a half cells of a standing door and takes it beyond', () => {
    const w = world();
    const at = w.openGround(6, 8);
    build(w, [rect(at, 6, 8), M, 1]);
    placed(w, HOUSE, at.x, at.y, { elevation: 1 });
    const row = (y: number) => rect({ x: at.x, y }, 6, 1);
    expect(peel(w, row(at.y + 7)).ok).toBe(true);
    const before = w.fingerprint();
    expect(peel(w, row(at.y + 6)).refusedBy).toContain('V-PLACE-DOOR');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-PLACE-DOOR', 'refuses turning a house to face higher ground', () => {
    const w = world();
    const at = w.openGround(5, 5, 4);
    // A quarter turn faces the door to -x (`state/object-geometry.ts:doorOf`).
    build(w, [[{ x: at.x - 2, y: at.y + 2 }], M, 1]);
    const house = placed(w, HOUSE, at.x, at.y);
    const before = w.fingerprint();
    expect(turn(w, house, 90).refusedBy).toContain('V-PLACE-DOOR');
    expect(w.fingerprint()).toBe(before);
    expect(turn(w, house, 270).ok).toBe(true);
  });
});

describe('objects and one another', () => {
  spec('V-PLACE-OVERLAP', 'refuses two objects on one cell and takes them edge to edge', () => {
    const w = world();
    const at = w.openGround(3, 3);
    placed(w, 'flower-protea', at.x, at.y);
    const before = w.fingerprint();
    expect(w.place('flower-protea', at.x, at.y).refusedBy).toContain('V-PLACE-OVERLAP');
    expect(w.fingerprint()).toBe(before);
    expect(w.place('flower-protea', at.x + 1, at.y).ok).toBe(true);
  });

  spec('V-PLACE-OVERLAP', 'judges a turned footprint', () => {
    const w = world();
    const at = w.openGround(8, 8);
    // The 6-by-5 pavilion turned a quarter stands 5 wide and 6 tall.
    placed(w, 'facility-pavilion', at.x, at.y, { rotation: 90 });
    const before = w.fingerprint();
    expect(w.place('flower-protea', at.x + 2, at.y + 5).refusedBy).toContain('V-PLACE-OVERLAP');
    expect(w.fingerprint()).toBe(before);
    expect(w.place('flower-protea', at.x + 5, at.y + 2).ok).toBe(true);
  });

  spec('V-PLACE-OVERLAP', 'lays a road under a building made to stand on pavement, and only a plantable road under a tree', () => {
    const w = world();
    const at = w.openGround(10, 6);
    placed(w, 'tree-apple', at.x, at.y);
    placed(w, 'building-stall', at.x + 4, at.y);
    const before = w.fingerprint();
    expect(w.place('path-blue-board', at.x, at.y).refusedBy).toContain('V-PLACE-OVERLAP');
    expect(w.fingerprint()).toBe(before);
    expect(w.place('path-blue-board', at.x + 4, at.y).ok).toBe(true);
    expect(w.place('path-tilled-soil', at.x, at.y).ok).toBe(true);
  });

  spec('V-PLACE-OVERLAP', 'lays a road under the low end of a ramp and keeps it off the cell over the cliff', () => {
    const w = world();
    const at = w.openGround(6, 9);
    build(w, [rect(at, 6, 6), M, 1]);
    const ramp = placed(w, 'ramp-grassy', at.x + 2, at.y + 6);
    const { x, y } = ramp.position;
    expect(w.place('path-blue-board', x, y + 1).ok).toBe(true);
    expect(w.place('path-blue-board', x + 1, y + 1).ok).toBe(true);
    const before = w.fingerprint();
    expect(w.place('path-blue-board', x, y).refusedBy).toContain('V-PLACE-TRAIT');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-PLACE-OVERLAP', 'takes a tree moved onto a road and removes the road, and keeps the road under a stall', () => {
    const w = world();
    const at = w.openGround(10, 6);
    const under = placed(w, 'path-blue-board', at.x, at.y);
    const kept = placed(w, 'path-blue-board', at.x + 6, at.y);
    const tree = placed(w, 'tree-apple', at.x, at.y + 3);
    const stall = placed(w, 'building-stall', at.x + 6, at.y + 3);
    expect(move(w, tree, at.x, at.y).ok).toBe(true);
    expect(w.object(under.id)).toBeUndefined();
    expect(move(w, stall, at.x + 6, at.y).ok).toBe(true);
    expect(w.object(kept.id)).toBeDefined();
  });

  spec('V-PLACE-OVERLAP', 'refuses a second road on one paving layer and takes a print over it', () => {
    const w = world();
    const at = w.openGround(3, 3);
    placed(w, 'path-blue-board', at.x, at.y);
    const before = w.fingerprint();
    expect(w.place('path-tilled-soil', at.x, at.y).refusedBy).toContain('V-PLACE-OVERLAP');
    expect(w.fingerprint()).toBe(before);
    expect(w.place('print-field-line', at.x, at.y).ok).toBe(true);
  });

  spec('V-PLACE-MAX', 'refuses a second one-of-a-kind house, and lets the one placed move and turn', () => {
    const w = world();
    const a = w.openGround(5, 5, 4);
    const house = placed(w, 'building-bamboo-cabin', a.x, a.y);
    const b = w.openGround(5, 5, 4);
    const before = w.fingerprint();
    expect(w.place('building-bamboo-cabin', b.x, b.y).refusedBy).toContain('V-PLACE-MAX');
    expect(w.fingerprint()).toBe(before);
    expect(turn(w, house, 270).ok).toBe(true);
    expect(move(w, w.object(house.id)!, a.x + 1, a.y).ok).toBe(true);
    expect(w.remove(house.id).ok).toBe(true);
    expect(w.place('building-bamboo-cabin', b.x, b.y).ok).toBe(true);
  });

  spec('V-PLACE-COATED', 'refuses a stroke that leaves a tree or a flower on a road and takes either on a plantable road', () => {
    const w = world();
    const at = w.openGround(9, 3);
    placed(w, 'path-blue-board', at.x, at.y);
    placed(w, 'path-tilled-soil', at.x + 3, at.y);
    placed(w, 'path-tilled-soil', at.x + 6, at.y);
    const before = w.fingerprint();
    expect(inStroke(w, () => w.place('tree-apple', at.x, at.y)).refusedBy).toContain('V-PLACE-COATED');
    expect(inStroke(w, () => w.place('flower-protea', at.x, at.y)).refusedBy).toContain('V-PLACE-COATED');
    expect(w.fingerprint()).toBe(before);
    expect(inStroke(w, () => w.place('flower-protea', at.x + 3, at.y)).ok).toBe(true);
    expect(inStroke(w, () => w.place('tree-apple', at.x + 6, at.y)).ok).toBe(true);
  });

  spec('V-PLACE-COATED', 'lets a building made to stand on pavement keep the road under it', () => {
    const w = world();
    const at = w.openGround(3, 3);
    placed(w, 'path-blue-board', at.x, at.y);
    expect(inStroke(w, () => w.place('building-stall', at.x, at.y)).ok).toBe(true);
  });
});
