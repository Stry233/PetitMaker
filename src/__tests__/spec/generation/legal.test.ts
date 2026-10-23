/** Every generated map is one the game can build: the map rules hold, and the landmark and the
 *  ground under it stay as the planet has them. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { TerrainType, world } from '../_world';
import { isLandmarkItem } from '../../../core/model/landmarks';
import { isGrassZone } from '../../../core/game/zones';
import { customPlanet, freshPage, generate, landmarkGround, mapValue, maze, planet, ruleFindings } from './_generation';

describe('every generated map', () => {
  spec('GEN-06', 'obeys every map rule on a built-in planet, designed or a maze, and leaves the landmark and the ground under it', async () => {
    for (const [kind, recipe] of [['a designed planet', planet(4)], ['a maze', maze(9)]] as const) {
      freshPage();
      const w = world();
      const ground = landmarkGround(w.state);
      const bare = mapValue(w.state);
      await generate(w, recipe);
      expect(mapValue(w.state), `${kind} built something`).not.toBe(bare);
      expect(ruleFindings(w), kind).toEqual([]);
      expect(landmarkGround(w.state), kind).toBe(ground);
    }
  });

  spec('GEN-06', 'obeys every map rule on a custom planet and keeps to its own grass, its landmark and its pond', async () => {
    freshPage();
    const kit = customPlanet();
    const ground = landmarkGround(kit.state);
    expect((await generate(kit, planet(7))).placed).toBeGreaterThan(0);
    expect(ruleFindings(kit)).toEqual([]);
    expect(landmarkGround(kit.state)).toBe(ground);
    for (const obj of kit.state.objects.values()) {
      if (isLandmarkItem(obj.id)) continue;
      const zone = kit.state.cells[Math.floor(obj.position.y)]?.[Math.floor(obj.position.x)]?.zone;
      expect(zone !== undefined && isGrassZone(zone), obj.id).toBe(true);
    }
    for (const [x, y] of [[30, 20], [31, 21]] as const) expect(kit.state.cells[y]![x]!.terrain?.type, `pond ${x},${y}`).toBe(TerrainType.Water);
  });
});
