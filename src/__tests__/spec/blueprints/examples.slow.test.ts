/** The examples a new library starts with, laid on the ground they meet: each whole on open flat
 *  ground at any turn, and each one's water on uneven ground standing wherever it can, with the ghost
 *  shown first telling the truth about what the placement skips. */
import { expect } from 'vitest';
import { spec } from '../../_support/spec';
import { placeBlueprint, previewBlueprint, BLUEPRINT_MAX_SIDE, type BlueprintBody, type BlueprintPreview } from '../../../tools/blueprint';
import { layBlueprint } from '../../../editor/editing/blueprint';
import { isLegalMap } from '../../../rules/legality';
import { decodeBlueprints, type BlueprintRecord } from '../../../io/blueprint';
import { EXAMPLE_BLUEPRINTS_FILE } from '../../../config/blueprints';
import { footprintTerrain } from '../../../core/grid/footprint';
import { cellKey } from '../../../core/grid/rect';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import type { MacroCoord } from '../../../core/model/types';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { plain, raise, shift } from './_blueprints';

/** The examples a new library starts with, as their file holds them. */
function examples(): BlueprintRecord[] {
  const read = decodeBlueprints(EXAMPLE_BLUEPRINTS_FILE);
  if ('error' in read) throw new Error(read.error);
  return read.records;
}

/** The examples that carry water, as their bodies. */
function waterExamples(): { name: string; body: BlueprintBody }[] {
  return examples().filter((r) => r.body.cells.some((c) => c?.type === TerrainType.Water)).map((r) => ({ name: r.name, body: r.body }));
}

/** Each test below lays a whole example several times, its objects included. */
const LAYS_TIMEOUT = 60_000;

spec('BLUE-13', 'together the examples carry mountain, water and objects', () => {
  const carried = new Set<string>();
  for (const { body } of examples()) {
    for (const c of body.cells) if (c) carried.add(c.type === TerrainType.Water ? 'water' : 'mountain');
    if (body.objects.length > 0) carried.add('objects');
  }
  expect([...carried].sort()).toEqual(['mountain', 'objects', 'water']);
});

for (const record of examples()) {
  spec('BLUE-13', `${record.name} is at most the largest blueprint and places whole on open flat ground at any turn`, () => {
    const { body } = record;
    expect(Math.max(body.w, body.h)).toBeLessThanOrEqual(BLUEPRINT_MAX_SIDE);
    for (const quarters of [0, 1, 2, 3]) {
      const w = world();
      const at = w.openGround(Math.max(body.w, body.h), Math.max(body.w, body.h));
      const { skips } = layBlueprint(w.sandbox.door(), record, { at, quarters }, null);
      expect({ quarters, skips }).toEqual({ quarters, skips: { ground: 0, objects: 0, capped: 0, unknown: 0 } });
      expect(isLegalMap(w.state, w.sandbox.kit.registry), `quarters ${quarters}`).toBe(true);
    }
  }, LAYS_TIMEOUT);
}

/** Uneven ground under a w by h patch whose top-left is `g`: two halves, layer 1 and layer 2, side by
 *  side; four bands stepping from bare ground down to layer 3; or bare ground with a hillock three
 *  layers high under the middle third. */
const GROUNDS: Record<string, (w: SpecWorld, g: MacroCoord, W: number, H: number) => void> = {
  halves: (w, g, W, H) => { raise(w, rect(g, W, H), 1); raise(w, rect(shift(g, Math.floor(W / 2), 0), W - Math.floor(W / 2), H), 2); },
  terraces: (w, g, W, H) => { for (let k = 1; k <= 3; k++) raise(w, rect(shift(g, 0, Math.floor((k * H) / 4)), W, H - Math.floor((k * H) / 4)), k); },
  hillock: (w, g, W, H) => raise(w, rect(shift(g, Math.floor(W / 3), Math.floor(H / 3)), Math.floor(W / 3), Math.floor(H / 3)), 3),
};

/** Each cell of `body` with its frame's top-left at `at`, where it lands on the map. */
function bodyCells(body: BlueprintBody, at: MacroCoord) {
  const area = footprintTerrain({ ...at, w: body.w, h: body.h });
  return body.cells.map((c, k) => ({ c, at: { x: area.x + (k % area.w), y: area.y + Math.floor(k / area.w) } }));
}

/** That the ghost shown before a placement told the truth about it: every terrain cell of the body
 *  it marked was skipped or laid short, every one it did not mark landed as the body asks, every
 *  block it showed stands where it showed it, and the placement counted what it marked. */
function expectGhostTold(w: SpecWorld, cells: ReturnType<typeof bodyCells>, preview: BlueprintPreview, skippedGround: number, label: string): void {
  const marked = new Set(preview.blocked.map((c) => cellKey(c.x, c.y)));
  for (const { c, at } of cells) {
    if (!c) continue;
    const landed = JSON.stringify(w.terrainAt(at)) === JSON.stringify({ type: c.type, elevation: preview.base + c.rise });
    expect(landed, `${label} ${at.x},${at.y} ${marked.has(cellKey(at.x, at.y)) ? 'marked but laid' : 'skipped unmarked'}`).toBe(!marked.has(cellKey(at.x, at.y)));
  }
  preview.cells.forEach((at, i) => {
    expect(w.terrainAt(at), `${label} built ${at.x},${at.y}`).toEqual({ type: preview.terrain[i]!.type, elevation: preview.terrain[i]!.elevation });
  });
  expect(skippedGround, label).toBe(preview.blocked.length);
}

/** Lays `body` on `ground` with its frame four cells inside the patch: the ghost shown first, what
 *  the placement reported, and each body cell with the surface it covered before. */
function layOn(body: BlueprintBody, ground: keyof typeof GROUNDS) {
  const w = world();
  const W = body.w + 8, H = body.h + 8;
  const g = w.openGround(W, H);
  GROUNDS[ground]!(w, g, W, H);
  const at = shift(g, 4, 4);
  const cells = bodyCells(body, at);
  const before = new Map(cells.map(({ at: p }) => [cellKey(p.x, p.y), surfaceElevation(w.state.cells[p.y]![p.x]!.terrain)]));
  const door = w.sandbox.door();
  const preview: BlueprintPreview = previewBlueprint(door, body, { at, quarters: 0 });
  const res = placeBlueprint(door, body, { at, quarters: 0 });
  return { w, cells, before, preview, res };
}

for (const { name, body } of waterExamples()) {
  spec('BLUE-08', `${name}'s water lands on uneven ground wherever it can stand, filling the lowest ground it needs, the map stays legal, and the ghost marks exactly the cells the placement skips`, () => {
    for (const ground of Object.keys(GROUNDS)) {
      const { w, cells, before, preview, res } = layOn(body, ground);
      const label = `${name} on ${ground}`;
      for (const { c, at } of cells) {
        if (c?.type !== TerrainType.Water) continue;
        const height = preview.base + c.rise;
        const higher = before.get(cellKey(at.x, at.y))! > height;
        // Water stands wherever the ground under it is not higher than the water; over a higher block it is skipped.
        expect(w.terrainAt(at), `${label} ${at.x},${at.y}`).toEqual(higher ? { type: TerrainType.Mountain, elevation: before.get(cellKey(at.x, at.y)) } : { type: TerrainType.Water, elevation: height });
      }
      expect(isLegalMap(w.state, w.sandbox.kit.registry), label).toBe(true);
      expectGhostTold(w, cells, preview, res.skips.ground, label);
    }
  }, LAYS_TIMEOUT);
}

spec('BLUE-08', 'a waterfall whose cap cannot land keeps the rest of its water, standing legal, with the ghost marking what it skips', () => {
  const garden = waterExamples().find((e) => e.body.cells.some((c) => c?.type === TerrainType.Water && c.rise > 1))!.body;
  const { w, at } = plain(1, Math.max(garden.w, garden.h) + 7);
  const cells = bodyCells(garden, at);
  const cellAt = (p: MacroCoord) => cells.find((b) => b.at.x === p.x && b.at.y === p.y)?.c;
  // The upper pool's lip, the water with lower water south of it, ends against the block capping it.
  const lip = cells.filter(({ c, at: p }) => c?.type === TerrainType.Water && cellAt(shift(p, 0, 1))?.type === TerrainType.Water
    && cellAt(shift(p, 0, 1))!.rise < c.rise);
  const cap = shift(lip[lip.length - 1]!.at, 1, 0);
  expect(cellAt(cap)?.type).toBe(TerrainType.Mountain);
  // A pool already standing where the cap would go: water is never built over.
  expect(w.stroke([cap], TerrainType.Water, 1).ok).toBe(true);
  const door = w.sandbox.door();
  const preview = previewBlueprint(door, garden, { at, quarters: 0 });
  const res = placeBlueprint(door, garden, { at, quarters: 0 });
  expect(w.terrainAt(cap)).toEqual({ type: TerrainType.Water, elevation: 1 });
  const water = cells.filter(({ c }) => c?.type === TerrainType.Water);
  // Only the lip cell beside the missing cap gives way; every other water cell stands.
  expect(water.filter(({ at: p }) => w.terrainAt(p)?.type === TerrainType.Water).length).toBe(water.length - 1);
  expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  expectGhostTold(w, cells, preview, res.skips.ground, 'broken waterfall');
});
