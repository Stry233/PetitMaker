import { describe, it, expect } from 'vitest';
import { TerrainType, type MacroCell, type MapTemplate } from '../../../core/model/types';
import { CellZone, groundZone, isCellZone, isGrassZone, isLandZone, isSeaZone } from '../../../core/game/zones';
import { groundFrame, planetTemplateId, isCustomTemplate } from '../../../core/model/planet';
import { createGridState, seedPlanetTerrain } from '../../../core/model/template';
import { deriveBoundary, groundUnderRim, refreshBoundary, rimSandOf } from '../../../core/model/shore';
import { planetLandmarkObject, templateLandmarkObjects, hasLandmark, isLandmarkItem, templateLandmark } from '../../../core/model/landmarks';
import { createGrid } from '../../../core/model/grid-model';
import { PLANET_PROFILE } from '../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { getMapTemplate } from '../../../config/maps';
import { landmarkAt } from '../../_support/planet';

const V = CellZone.Void, G = CellZone.Grass, B = CellZone.Beach;
const grid = (w: number, h: number, fill = V) => Array.from({ length: h }, () => Array.from({ length: w }, () => fill));

describe('deriveBoundary', () => {
  it('marks sea and sand within one cell of grass as boundary and leaves the rest alone', () => {
    const z = grid(9, 9); z[4]![4] = G; z[4]![5] = B; z[4]![6] = B;
    const out = deriveBoundary(z);
    expect(out[3]![3]).toBe(CellZone.Boundary);
    expect(out[5]![5]).toBe(CellZone.Boundary);
    expect(out[4]![5]).toBe(CellZone.Boundary);
    expect(out[4]![6]).toBe(B);
    expect(out[2]![2]).toBe(V);
    expect(out[4]![4]).toBe(G);
    expect(z[4]![5]).toBe(B); // input untouched
  });
  it('marks exactly the sea and sand within the profile radius of grass, grid edges included', () => {
    const kinds = [V, V, V, G, B, CellZone.Boundary];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const z = Array.from({ length: 23 }, () => Array.from({ length: 31 }, () => kinds[Math.floor(next() * next() * kinds.length)]!));
    const ground = (x: number, y: number) => z[y]?.[x] === G;
    const r = PLANET_PROFILE.shoreRadius;
    const expected = z.map((row, y) => row.map((c, x) => {
      if (isGrassZone(c)) return c;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ground(x + dx, y + dy)) return CellZone.Boundary;
      return c === CellZone.Boundary ? V : c;
    }));
    expect(deriveBoundary(z)).toEqual(expected);
  });
  it.each(['hexia', 'tafa'])('reproduces %s: its Boundary cells are exactly the rim its grass derives', (id) => {
    const zones = getMapTemplate(id).zones;
    const rimless = zones.map((row) => row.map((z) => (z === CellZone.Boundary ? V : z)));
    expect(deriveBoundary(rimless)).toEqual(zones);
    expect(deriveBoundary(groundUnderRim(zones))).toEqual(zones);
  });
});

describe('groundUnderRim', () => {
  it('reads a rim cell as sand when any neighbour is sand, a diagonal one included, otherwise as sea', () => {
    const R = CellZone.Boundary;
    expect(groundUnderRim([
      [V, V, V, V],
      [V, R, R, G],
      [B, R, G, G],
      [V, V, R, R],
      [V, V, V, V],
    ])).toEqual([
      [V, V, V, V],
      [V, B, V, G],
      [B, B, G, G],
      [V, V, V, V],
      [V, V, V, V],
    ]);
  });
  it('reads the rim from the listed sand when a list is given, and rimSandOf lists what it reads back', () => {
    const R = CellZone.Boundary;
    const zones = [
      [R, R, R, B],
      [R, G, R, B],
      [R, R, R, B],
    ];
    const ground = groundUnderRim(zones, [0, 1, 4]);
    expect(ground).toEqual([
      [B, B, V, B],
      [B, G, V, B],
      [V, V, V, B],
    ]);
    expect(rimSandOf(ground, zones)).toEqual([0, 1, 4]);
  });

  // Tafa's rim cells that touch no sand: (110, 2) lies between grass and sea, (34, 6) and (35, 6) in a
  // notch enclosed by grass and rim.
  it.each([['hexia', []], ['tafa', ['34,6', '35,6', '110,2']]] as const)('finds sand under every rim cell of %s that touches sand', (id, enclosed) => {
    const zones = getMapTemplate(id).zones;
    const under = groundUnderRim(zones);
    const rim = zones.flatMap((row, y) => row.flatMap((z, x) => (z === CellZone.Boundary ? [{ at: `${x},${y}`, z: under[y]![x] }] : [])));
    expect(rim.length).toBeGreaterThan(0);
    expect(rim.filter((c) => c.z !== B).map((c) => c.at).sort()).toEqual([...enclosed].sort());
  });
});

describe('refreshBoundary', () => {
  const cellsOf = (z: CellZone[][]): MacroCell[][] => z.map((row) => row.map((zone) => ({ zone, terrain: null })));
  const zonesOf = (cells: MacroCell[][]) => cells.map((row) => row.map((c) => c.zone));
  const groundOf = (cells: MacroCell[][]) => cells.map((row) => row.map(groundZone));
  /** Cells with their rim derived from `ground`, keeping the sand under it. */
  const settled = (ground: CellZone[][]) => { const cells = cellsOf(ground); refreshBoundary(cells, [], 0); return cells; };

  it('re-derives the rim around changed cells to match a full derivation', () => {
    const z = grid(12, 12); z[5]![5] = G;
    const cells = cellsOf(deriveBoundary(z));
    cells[5]![8]!.zone = G;
    const changed = refreshBoundary(cells, [{ x: 8, y: 5 }]);
    z[5]![8] = G;
    expect(zonesOf(cells)).toEqual(deriveBoundary(z));
    expect(changed).toContainEqual({ x: 9, y: 6 });
    expect(changed).not.toContainEqual({ x: 6, y: 5 }); // already rim before the edit
  });

  it('returns rim cells to open sea when their ground goes', () => {
    const z = grid(9, 9); z[4]![4] = G;
    const cells = cellsOf(deriveBoundary(z));
    cells[4]![4]!.zone = V;
    const changed = refreshBoundary(cells, [{ x: 4, y: 4 }]);
    expect(zonesOf(cells).flat().every((zone) => zone === V)).toBe(true);
    expect(changed).toHaveLength(8);
  });

  it('lays the rim over sand beside grass and gives the sand back when the grass goes', () => {
    const z = grid(9, 9); z[4]![4] = G; z[4]![5] = B; z[4]![6] = B;
    const cells = settled(z);
    expect(cells[4]![5]).toEqual({ zone: CellZone.Boundary, terrain: null, under: B });
    expect(cells[4]![6]).toEqual({ zone: B, terrain: null });
    expect(cells[3]![4]).toEqual({ zone: CellZone.Boundary, terrain: null });
    cells[4]![4]!.zone = V;
    const changed = refreshBoundary(cells, [{ x: 4, y: 4 }]);
    expect(changed).toContainEqual({ x: 5, y: 4 });
    expect(cells[4]![5]).toEqual({ zone: B, terrain: null });
    expect(zonesOf(cells)).toEqual((() => { const w = grid(9, 9); w[4]![5] = B; w[4]![6] = B; return w; })());
  });

  it('accepts the half-cell anchor a half-step object announces', () => {
    const z = grid(9, 9); z[4]![4] = G;
    const cells = cellsOf(z);
    expect(() => refreshBoundary(cells, [{ x: 4.5, y: 3.5 }])).not.toThrow();
    expect(zonesOf(cells)).toEqual(deriveBoundary(z));
  });

  it('answers the same through the whole-grid pass it takes for a large change', () => {
    const z = grid(12, 12); z[5]![5] = G; z[5]![6] = B; z[5]![9] = B;
    const local = settled(z), full = settled(z);
    for (const cells of [local, full]) { cells[5]![8]!.zone = G; cells[5]![5]!.zone = V; }
    const edit = [{ x: 8, y: 5 }, { x: 5, y: 5 }];
    const a = refreshBoundary(local, edit, Infinity), b = refreshBoundary(full, edit, 0);
    expect(full).toEqual(local);
    expect(new Set(b.map((c) => `${c.x},${c.y}`))).toEqual(new Set(a.map((c) => `${c.x},${c.y}`)));
  });

  it('matches a full derivation of the ground under it after random ground edits at whole and half-cell anchors', () => {
    let seed = 11;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const z = grid(40, 30);
    const cells = cellsOf(deriveBoundary(z));
    const kinds = [G, B, V];
    for (let round = 0; round < 60; round++) {
      // A half coordinate announces the cells either side of it, as a half-step anchor does. A ground
      // command's apply sets the zone and drops the ground a rim kept.
      const ax = Math.floor(next() * 80) / 2, ay = Math.floor(next() * 60) / 2;
      const zone = kinds[Math.floor(next() * kinds.length)]!;
      for (let y = Math.floor(ay); y <= Math.min(29, Math.ceil(ay)); y++) for (let x = Math.floor(ax); x <= Math.min(39, Math.ceil(ax)); x++) {
        cells[y]![x]!.zone = zone;
        delete cells[y]![x]!.under;
      }
      refreshBoundary(cells, [{ x: ax, y: ay }], Infinity);
      expect(zonesOf(cells)).toEqual(deriveBoundary(groundOf(cells)));
      expect(cells).toEqual(settled(groundOf(cells)));
    }
  });

  it('never turns grass into rim and ignores cells off the grid', () => {
    const z = grid(4, 4); z[0]![0] = G; z[0]![2] = B;
    const cells = cellsOf(z);
    refreshBoundary(cells, [{ x: 0, y: 0 }, { x: -3, y: 9 }]);
    expect(cells[0]![0]!.zone).toBe(G);
    expect(cells[0]![2]!.zone).toBe(B);
    expect(cells[1]![1]!.zone).toBe(CellZone.Boundary);
    expect(cells[2]![2]!.zone).toBe(V);
  });
});

describe('groundZone', () => {
  it('reads a rim cell as the ground under it and any other cell as its zone', () => {
    expect(groundZone({ zone: CellZone.Boundary })).toBe(V);
    expect(groundZone({ zone: CellZone.Boundary, under: B })).toBe(B);
    expect([V, B, G].map((zone) => groundZone({ zone }))).toEqual([V, B, G]);
  });
});

describe('isSeaZone', () => {
  it('is open sea and its shore rim', () => {
    expect([V, CellZone.Boundary].every(isSeaZone)).toBe(true);
    expect([G, B].some(isSeaZone)).toBe(false);
  });
});

describe('zone kinds', () => {
  it('names land as grass or sand and grass as grass', () => {
    expect([G, B].every(isLandZone)).toBe(true);
    expect([V, CellZone.Boundary].some(isLandZone)).toBe(false);
    expect(isGrassZone(G)).toBe(true);
    expect([V, B, CellZone.Boundary].some(isGrassZone)).toBe(false);
  });
  it('recognises every zone a map may hold and nothing else, the retired plaza zone included', () => {
    expect([V, B, G, CellZone.Boundary].every(isCellZone)).toBe(true);
    expect([3, 5, -1, 1.5, '2', null].some(isCellZone)).toBe(false);
  });
});

describe('template landmark', () => {
  it('is the plaza a map seeds from its template, sized by the profile on a custom planet', () => {
    const plaza = planetLandmarkObject(ANCHOR_LANDMARK, { x: 2.5, y: 3 }, 90);
    const { width, height } = ANCHOR_LANDMARK;
    expect(plaza).toMatchObject({ width: height, height: width, elevation: 0, rotation: 90, locked: false });
    expect(isLandmarkItem(plaza.catalogId)).toBe(true);
    expect(templateLandmark({ objects: new Map([[plaza.id, plaza]]) })).toBe(plaza);
  });
  it('treats a zero width or height as no plaza', () => {
    const { width, height } = ANCHOR_LANDMARK;
    expect(hasLandmark({ width, height })).toBe(true);
    expect([{ width: 0, height }, { width, height: 0 }, {}].some(hasLandmark)).toBe(false);
  });
});

describe('the ground frame', () => {
  it('snaps the ground bounding box to whole chunks', () => {
    const z = grid(64, 64); z[20]![17] = G; z[40]![50] = B;
    expect(groundFrame(z, [])).toEqual({ x0: 16, y0: 16, cols: 3, rows: 2 });
  });
  it('is null for an all-sea grid', () => { expect(groundFrame(grid(32, 32), [])).toBeNull(); });
});

describe('planetTemplateId', () => {
  const base = { width: 2, height: 1, zones: [[G, V]], landmarks: [] };
  it('is stable for the same shape and changes with any cell', () => {
    expect(planetTemplateId(base)).toBe(planetTemplateId({ ...base, zones: [[G, V]] }));
    expect(planetTemplateId(base)).not.toBe(planetTemplateId({ ...base, zones: [[G, G]] }));
    expect(planetTemplateId(base)).toMatch(/^custom-[0-9a-f]{8}$/);
    expect(isCustomTemplate({ id: planetTemplateId(base) })).toBe(true);
    expect(isCustomTemplate({ id: 'hexia' })).toBe(false);
  });
});

describe('seedPlanetTerrain', () => {
  it('lays the template terrain as mountains on grass', () => {
    const t: MapTemplate = { id: 'custom-x', name: { en: 'X' }, width: 2, height: 1, zones: [[G, G]], landmarks: [], terrain: Uint8Array.from([0, 2]) };
    const cells = createGrid(t);
    seedPlanetTerrain(t, cells);
    expect(cells[0]![0]!.terrain).toBeNull();
    expect(cells[0]![1]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });
});

describe('createGridState', () => {
  it('opens a template with its zones, seeded terrain and landmark, and nothing else', () => {
    const t: MapTemplate = { id: 'custom-x', name: { en: 'X' }, width: 40, height: 40, zones: grid(40, 40, G), landmarks: [landmarkAt(3.5, 4, 0)], terrain: Uint8Array.from({ length: 1600 }, (_, i) => (i === 1599 ? 2 : 0)) };
    const state = createGridState(t);
    expect(state.template).toBe(t);
    expect(state.cells[39]![39]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect([...state.objects.values()]).toEqual([(templateLandmarkObjects(t)[0] ?? null)]);
    expect(state.lockedLayers.size).toBe(0);
    expect(state.provenance).toBeUndefined();
  });
});

describe('templateLandmarkObjects', () => {
  it('carries the template plaza rotation and stays locked', () => {
    const t: MapTemplate = { id: 'custom-x', name: { en: 'X' }, width: 40, height: 40, zones: grid(40, 40, G), landmarks: [landmarkAt(3.5, 4, 90)]};
    const p = (templateLandmarkObjects(t)[0] ?? null)!;
    expect(p.rotation).toBe(90);
    expect(p.position).toEqual({ x: 3.5, y: 4 });
    expect(p.locked).toBe(true);
  });
});

describe('planetTemplateId canonical form', () => {
  it('hashes an all-zero terrain like an absent one', () => {
    const body = { width: 4, height: 4, zones: grid(4, 4, G), landmarks: [] };
    expect(planetTemplateId({ ...body, terrain: new Uint8Array(16) })).toBe(planetTemplateId(body));
    const raised = new Uint8Array(16); raised[3] = 2;
    expect(planetTemplateId({ ...body, terrain: raised })).not.toBe(planetTemplateId(body));
  });
});
