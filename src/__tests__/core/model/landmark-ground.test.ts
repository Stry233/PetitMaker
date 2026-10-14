import { describe, it, expect } from 'vitest';
import { templateAnchor, templateLandmarkObjects } from '../../../core/model/landmarks';
import { footprintTerrain } from '../../../core/grid/footprint';
import { LANDMARKS } from '../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { createGridState } from '../../../core/model/template';
import { parseTemplate, serializeTemplate } from '../../../io/save/planet-codec';
import { isTrustedPlanet } from '../../../core/model/planet-validate';
import { TerrainType } from '../../../core/model/types';
import { getMapTemplate } from '../../../config/maps';
import { objectElevation } from '../../../state/object-geometry';
import { landmarkAt, planetFixture } from '../../_support/planet';

const cellsOf = (r: { x: number; y: number; w: number; h: number }) => {
  const out: string[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(`${x},${y}`);
  return out;
};

describe('the terrain cells a footprint rests on', () => {
  it('reach half a cell past each edge of a footprint on whole cells', () => {
    // Terrain cell c spans [c - 0.5, c + 0.5]: a footprint over [79, 99) x [64, 91) rests on x 79 to 99 and y 64 to 91.
    expect(footprintTerrain({ x: 79, y: 64, w: 20, h: 27 })).toEqual({ x: 79, y: 64, w: 21, h: 28 });
  });

  it('coincide with a footprint on half cells', () => {
    expect(footprintTerrain({ x: 79.5, y: 64.5, w: 20, h: 27 })).toEqual({ x: 80, y: 65, w: 20, h: 27 });
  });
});

describe('the built-in planets', () => {
  it.each(['hexia', 'tafa'])('%s lays an ordinary layer-1 mountain on the cells the plaza rests on, and the plaza stands on it', (id) => {
    const t = getMapTemplate(id);
    const plaza = templateAnchor(t)!;
    expect(plaza).toMatchObject({ x: 79, y: 64, width: 20, height: 27 });
    const ground = new Set(cellsOf(footprintTerrain({ x: plaza.x, y: plaza.y, w: plaza.width, h: plaza.height })));
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
      const e = t.terrain?.[y * t.width + x] ?? 0;
      expect(e, `${x},${y}`).toBe(ground.has(`${x},${y}`) ? 1 : 0);
    }
    const state = createGridState(t);
    for (const key of ground) {
      const [x, y] = key.split(',').map(Number);
      expect(state.cells[y!]![x!]!.terrain, key).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    }
    expect(objectElevation(state, state.objects.get(ANCHOR_LANDMARK.id)!)).toBe(1);
    for (const o of templateLandmarkObjects(t).filter((o) => o.id !== ANCHOR_LANDMARK.id)) expect(objectElevation(state, o), o.id).toBe(0);
  });

  it('carry no landmark height in the profile or the templates', () => {
    for (const spec of LANDMARKS) expect(spec).not.toHaveProperty('elevation');
    for (const id of ['hexia', 'tafa']) for (const l of getMapTemplate(id).landmarks) expect(l, `${id} ${l.id}`).not.toHaveProperty('elevation');
  });
});

describe('a landmark on a custom planet', () => {
  it('stands on flat ground at layer 0 and on a mountain built under it at that mountain', () => {
    const flat = createGridState(planetFixture({ plaza: landmarkAt(12.5, 3.5) }));
    const plaza = flat.objects.get(ANCHOR_LANDMARK.id)!;
    expect(objectElevation(flat, plaza)).toBe(0);
    for (const key of cellsOf(footprintTerrain({ x: plaza.position.x, y: plaza.position.y, w: plaza.width!, h: plaza.height! }))) {
      const [x, y] = key.split(',').map(Number);
      flat.cells[y!]![x!]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    }
    expect(objectElevation(flat, plaza)).toBe(2);
  });

  it('opens from a planet file that stored a landmark height, the height ignored', () => {
    const t = planetFixture({ plaza: landmarkAt(12.5, 3) });
    const stored = serializeTemplate(t);
    const legacy = { ...stored, landmarks: stored.landmarks!.map((l) => ({ ...l, elevation: 1 })) };
    const back = parseTemplate(JSON.parse(JSON.stringify(legacy)));
    expect(back.id).toBe(t.id);
    expect(templateAnchor(back)).not.toHaveProperty('elevation');
    expect(isTrustedPlanet(back)).toBe(true);
  });
});
