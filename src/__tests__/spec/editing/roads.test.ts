/** Roads, bridges and ramps: tiles laid per cell, carried by the ground under them, cleared by
 *  what stands on them, and spans that find their own gap or cliff. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { brush, dragObject, objectsOf, picture, placeItem, plateau, pointAt } from './_editing';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';

const DIRT = 'path-overgrown-dirt';
const BOARD = 'path-blue-board';
const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });
const paveRect = (w: SpecWorld, from: MacroCoord, to: MacroCoord, material = DIRT) =>
  brush(w, { contentType: 'road', shape: 'rect', tileMaterial: material }).drag(from, to);
const spot = (o: PlacedObject) => `${o.position.x},${o.position.y}`;

describe('roads', () => {
  spec('EDIT-33', 'lays one tile per cell on land and none on water', () => {
    const w = world();
    const at = w.openGround(12, 3);
    paveRect(w, at, shift(at, 5, 2));
    const dry = objectsOf(w, DIRT).map(spot).sort();
    expect(dry).toEqual(rect(at, 6, 3).map((c) => `${c.x},${c.y}`).sort());

    const wet = shift(at, 7, 0);
    brush(w, { contentType: 'water' }).click(shift(wet, 2, 1));
    paveRect(w, wet, shift(wet, 4, 2));
    const tiles = objectsOf(w, DIRT).filter((o) => o.position.x >= wet.x);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThan(15);
    expect(tiles.map(spot)).not.toContain(`${wet.x + 2},${wet.y + 1}`);
    expect(w.terrainAt(shift(wet, 2, 1))).toEqual({ type: TerrainType.Water, elevation: 0 });
  });

  spec('EDIT-33', 'a tile of a new material replaces the one beneath it', () => {
    const w = world();
    const at = w.openGround(3, 3);
    paveRect(w, at, shift(at, 2, 1));
    paveRect(w, at, shift(at, 2, 1), BOARD);
    expect(objectsOf(w, DIRT)).toEqual([]);
    expect(objectsOf(w, BOARD)).toHaveLength(6);
  });

  spec('EDIT-33', 'mountain painted under a road carries the road up with it, in one undo step', () => {
    const w = world();
    const at = w.openGround(6, 6);
    paveRect(w, shift(at, 2, 2), shift(at, 3, 3));
    const before = w.fingerprint();
    brush(w, { shape: 'rect' }).drag(at, shift(at, 5, 5));
    expect(w.terrainAt(shift(at, 2, 2))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(objectsOf(w, DIRT).map((o) => o.elevation)).toEqual([1, 1, 1, 1]);
    w.undo();
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-33', 'a road whose ground turns uneven is removed with the stroke, and undo brings it back', () => {
    const w = world();
    const at = w.openGround(4, 4);
    paveRect(w, at, at);
    expect(objectsOf(w, DIRT)).toHaveLength(1);
    const before = w.fingerprint();
    brush(w).click(at);
    expect(w.terrainAt(at)?.elevation).toBe(1);
    expect(objectsOf(w, DIRT)).toEqual([]);
    w.undo();
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-34', 'a solid object placed over a road clears the road beneath it in the same undo step', () => {
    const w = world();
    const at = w.openGround(5, 5);
    paveRect(w, at, shift(at, 4, 4), BOARD);
    const before = picture(w);
    const tree = placeItem(w, 'tree-apple', shift(at, 2, 2));
    expect(tree).not.toBeNull();
    expect(objectsOf(w, BOARD).map(spot)).not.toContain(`${at.x + 2},${at.y + 2}`);
    expect(objectsOf(w, BOARD)).toHaveLength(24);
    w.undo();
    expect(picture(w)).toBe(before);
  });

  spec('EDIT-34', 'an item made to stand on pavement keeps the road under it', () => {
    const w = world();
    const at = w.openGround(9, 9);
    paveRect(w, at, shift(at, 8, 8), BOARD);
    expect(placeItem(w, 'building-bamboo-cabin', shift(at, 2, 2))).not.toBeNull();
    expect(objectsOf(w, BOARD)).toHaveLength(81);
  });

  spec('EDIT-34', 'a refused placement leaves the road untouched', () => {
    const w = world();
    const at = w.openGround(5, 5);
    paveRect(w, at, shift(at, 4, 4), BOARD);
    expect(placeItem(w, 'tree-apple', shift(at, 1, 1))).not.toBeNull();
    const before = w.fingerprint();
    expect(placeItem(w, 'tree-apple', shift(at, 2, 1)), 'too close to the first tree').toBeNull();
    expect(w.fingerprint()).toBe(before);
  });
});

describe('bridges and ramps', () => {
  /** Two terraces at layer 2 with a four-cell gap of open ground between them, along x or along y. */
  function gap(w: SpecWorld, along: 'x' | 'y'): MacroCoord {
    const at = w.openGround(12, 12);
    const far = along === 'x' ? shift(at, 8, 0) : shift(at, 0, 8);
    const [bw, bh] = along === 'x' ? [4, 6] : [6, 4];
    plateau(w, at, bw, bh, 1);
    plateau(w, far, bw, bh, 1);
    return along === 'x' ? shift(at, 5, 2) : shift(at, 2, 5);
  }

  spec('EDIT-35', 'a bridge snaps across the gap it is placed at, taking the gap\'s orientation, length and deck height', () => {
    const across = (along: 'x' | 'y', placementRotation: 0 | 90 = 0) => {
      const w = world();
      const bridge = placeItem(w, 'bridge-iron', gap(w, along), { placementRotation });
      expect(bridge, `a bridge along ${along}`).not.toBeNull();
      return bridge!;
    };
    const ew = across('x'), ns = across('y');
    expect(ew.elevation, 'the deck at the terraces\' height').toBe(1);
    expect(ew.spanLength).toBeGreaterThanOrEqual(4);
    expect(ns.rotation).not.toBe(ew.rotation);
    expect(ns.spanLength).toBe(ew.spanLength);
    expect([ew.position.x % 1, ew.position.y % 1], 'it may sit on half cells').toContain(0.5);
    expect(across('x', 90), 'the rotate command has no say').toEqual({ ...ew, id: expect.any(String) });
  });

  spec('EDIT-35', 'a ramp snaps up a cliff in whichever direction the cliff faces, and the rotate command has no say', () => {
    const up = (side: 'east' | 'south', placementRotation: 0 | 270 = 0) => {
      const w = world();
      const at = w.openGround(12, 12);
      plateau(w, at, 6, 6, 1);
      const ramp = placeItem(w, 'ramp-grassy', side === 'east' ? shift(at, 5, 2) : shift(at, 2, 5), { placementRotation });
      expect(ramp, side).not.toBeNull();
      return ramp!;
    };
    const east = up('east'), south = up('south');
    expect(east.rotation).not.toBe(south.rotation);
    expect(up('east', 270)).toEqual({ ...east, id: expect.any(String) });
  });

  spec('EDIT-35', 'a ramp dragged to another cliff snaps again where it is dropped', () => {
    const w = world();
    const at = w.openGround(12, 12);
    plateau(w, at, 6, 6, 1);
    const south = placeItem(w, 'ramp-grassy', shift(at, 2, 5))!;
    w.undo();
    const ramp = placeItem(w, 'ramp-grassy', shift(at, 5, 2))!;
    expect(ramp.rotation).not.toBe(south.rotation);
    const refusal = dragObject(w, [ramp.id], ramp.id, pointAt(at.x + 5.5, at.y + 2.5), pointAt(at.x + 2.5, at.y + 5.5));
    expect(refusal).toBeNull();
    const moved = w.object(ramp.id)!;
    expect({ position: moved.position, rotation: moved.rotation, elevation: moved.elevation })
      .toEqual({ position: south.position, rotation: south.rotation, elevation: south.elevation });
  });
});
