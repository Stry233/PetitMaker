/** A blueprint's water laid on the surface it is dropped on, through the blueprint tool's door: it
 *  stands at its own rise above that surface, on the blueprint's mountains as at its lowest ground,
 *  fills the lowest ground it needs up to that surface, keeps whatever can stand when part of it
 *  cannot, and never replaces other terrain or digs below its own height. */
import { expect } from 'vitest';
import { spec } from '../../_support/spec';
import { captureBlueprint, placeBlueprint, previewBlueprint, type BlueprintBody } from '../../../tools/blueprint';
import { isLegalMap } from '../../../rules/legality';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { plateau } from '../editing/_editing';
import { plain, raise, shift } from './_blueprints';

function capture(w: SpecWorld, frame: { x: number; y: number; w: number; h: number }): BlueprintBody {
  const out = captureBlueprint(w.state, frame);
  if (!('body' in out)) throw new Error(`refused: ${out.refusal}`);
  return out.body;
}

/** An 8 by 8 frame, terrain cells offset from its top-left: a 5 by 5 plateau two layers up at
 *  (1, 1) holding a 3 by 3 pond on its top at (2, 2), and a 2 by 2 pond dug into the ground at
 *  (6, 6). */
function waterGarden(): BlueprintBody {
  const w = world();
  const g = w.openGround(12, 12);
  const f = shift(g, 1, 1);
  plateau(w, shift(f, 1, 1), 5, 5, 2);
  for (const [at, side, e] of [[shift(f, 2, 2), 3, 2], [shift(f, 6, 6), 2, 0]] as const) {
    const out = w.stroke(rect(at, side, side), TerrainType.Water, e);
    if (!out.ok) throw new Error(`pond refused: ${out.refusedBy.join(', ')}`);
  }
  return capture(w, { ...f, w: 8, h: 8 });
}

/** A 3 by 3 plateau one layer up with a pond on its middle block, in a 3 by 3 frame. */
function plateauPond(): BlueprintBody {
  const w = world();
  const g = w.openGround(6, 6);
  plateau(w, shift(g, 1, 1), 3, 3, 1);
  if (!w.stroke([shift(g, 2, 2)], TerrainType.Water, 1).ok) throw new Error('pond refused');
  return capture(w, { ...g, w: 3, h: 3 });
}

spec('BLUE-08', 'water on its own mountains and at its lowest ground stands at its rise above the surface it is dropped on', () => {
  const body = waterGarden();
  for (const layers of [0, 1, 2]) {
    const { w, at } = plain(layers);
    const door = w.sandbox.door();
    const preview = previewBlueprint(door, body, { at, quarters: 0 });
    expect(preview.base, `plain ${layers}`).toBe(layers);
    expect(preview.blocked, `plain ${layers}`).toEqual([]);
    const res = placeBlueprint(door, body, { at, quarters: 0 });
    expect(res.skips.ground, `plain ${layers}`).toBe(0);
    for (const c of rect(shift(at, 2, 2), 3, 3)) {
      expect(w.terrainAt(c), `plain ${layers} top pond ${c.x},${c.y}`).toEqual({ type: TerrainType.Water, elevation: layers + 2 });
    }
    expect(w.terrainAt(shift(at, 3, 1)), `plain ${layers} rim`).toEqual({ type: TerrainType.Mountain, elevation: layers + 2 });
    for (const c of rect(shift(at, 6, 6), 2, 2)) {
      expect(w.terrainAt(c), `plain ${layers} ground pond ${c.x},${c.y}`).toEqual({ type: TerrainType.Water, elevation: layers });
    }
    expect(w.terrainAt(at), `plain ${layers} ground`).toEqual(layers > 0 ? { type: TerrainType.Mountain, elevation: layers } : null);
    expect(isLegalMap(w.state, w.sandbox.kit.registry), `plain ${layers}`).toBe(true);
  }
});

spec('BLUE-08', 'raised water never replaces other terrain or digs below its own height', () => {
  const { w, at } = plain(1);
  // A tower over the top pond, which wants water at 3 there, and a block over the ground pond, which wants water at 1.
  const tower = shift(at, 4, 4), block = shift(at, 7, 7);
  raise(w, [tower], 4);
  raise(w, [block], 2);
  const door = w.sandbox.door();
  const body = waterGarden();
  expect(previewBlueprint(door, body, { at, quarters: 0 }).blocked).toEqual([tower, block]);
  const res = placeBlueprint(door, body, { at, quarters: 0 });
  expect(res.skips.ground).toBe(2);
  expect(w.terrainAt(tower)).toEqual({ type: TerrainType.Mountain, elevation: 4 });
  expect(w.terrainAt(block)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  expect(w.terrainAt(shift(at, 3, 3))).toEqual({ type: TerrainType.Water, elevation: 3 });
  expect(w.terrainAt(shift(at, 6, 6))).toEqual({ type: TerrainType.Water, elevation: 1 });
  expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);

  // Water standing on the plain where the body's pond rises above it: nothing is built on water.
  const second = plain(1);
  const pool = shift(second.at, 2, 2);
  expect(second.w.stroke([pool], TerrainType.Water, 1).ok).toBe(true);
  const preview = previewBlueprint(second.w.sandbox.door(), plateauPond(), { at: second.at, quarters: 0 });
  expect(preview.blocked).toEqual([pool]);
  placeBlueprint(second.w.sandbox.door(), plateauPond(), { at: second.at, quarters: 0 });
  expect(second.w.terrainAt(pool)).toEqual({ type: TerrainType.Water, elevation: 1 });
  expect(second.w.terrainAt(shift(pool, 1, 0))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  expect(isLegalMap(second.w.state, second.w.sandbox.kit.registry)).toBe(true);
});
