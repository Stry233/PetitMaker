import { describe, it, expect } from 'vitest';
import { LANDMARKS, landmarkSpec } from '../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { isLaidLandmark, landmarkCells, planetLandmarkObject, templateAnchor, templateLandmarkObjects, landmarkGroundHolds, zonesReader } from '../../../core/model/landmarks';
import { planetTemplateId, upgradeLandmarks } from '../../../core/model/planet';
import { createGridState } from '../../../core/model/template';
import { type MapTemplate } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { getRotatedSize } from '../../../core/grid/footprint';
import { getMapTemplate } from '../../../config/maps';
import { getCatalogItem } from '../../../state/catalog';
import { CATALOG_MODELS } from '../../../config/catalog/models';
import { landmarkAt, planetFixture } from '../../_support/planet';

const STATION = LANDMARKS.find((l) => !l.anchor)!;

/** The landmark `id` of built-in planet `planet`, measured on the chunk grid: template cells less
 *  the chunk grid's origin, the coordinates the layout sheet is dimensioned in. */
function onChunkGrid(planet: string, id: string) {
  const t = getMapTemplate(planet);
  const l = t.landmarks.find((c) => c.id === id)!;
  const o = t.chunkGrid!.origin;
  return { x0: l.x - o.x, y0: l.y - o.y, x1: l.x - o.x + l.width, y1: l.y - o.y + l.height };
}

describe('the game profile landmarks', () => {
  it('lists the plaza as the one anchor and the station beside it', () => {
    expect(LANDMARKS.filter((l) => l.anchor)).toEqual([ANCHOR_LANDMARK]);
    expect(landmarkSpec(ANCHOR_LANDMARK.id)).toBe(ANCHOR_LANDMARK);
    expect(STATION.ground).toBe('coast');
    expect(ANCHOR_LANDMARK.ground).toBe('grass');
  });

  it('gives every landmark item the profile footprint', () => {
    for (const spec of LANDMARKS) {
      const item = getCatalogItem(spec.id)!;
      expect({ width: item.width, height: item.height, maxCount: item.maxCount }).toEqual({ width: spec.width, height: spec.height, maxCount: 1 });
    }
    expect(CATALOG_MODELS[ANCHOR_LANDMARK.id]!.deckModel3d!.footprint).toEqual([ANCHOR_LANDMARK.width, ANCHOR_LANDMARK.height]);
  });

  it('authors the station model inside its footprint', () => {
    const parts = CATALOG_MODELS[STATION.id]!.model3d!.parts;
    for (const p of parts) {
      expect(Math.abs(p.pos[0]) + p.size[0] / 2).toBeLessThanOrEqual(STATION.width / 2 + 1e-9);
      expect(Math.abs(p.pos[2]) + p.size[2] / 2).toBeLessThanOrEqual(STATION.height / 2 + 1e-9);
    }
  });
});

describe('the built-in planets follow the layout sheet', () => {
  it.each(['hexia', 'tafa'])('%s lays the plaza half a cell inside the sheet frame on every side', (id) => {
    expect(onChunkGrid(id, ANCHOR_LANDMARK.id)).toEqual({ x0: 94, y0: 87, x1: 114, y1: 114 });
  });

  it.each(['hexia', 'tafa'])('%s lays the station in its reserved frame, from the north edge the sheet draws', (id) => {
    const at = onChunkGrid(id, STATION.id);
    expect(at).toEqual({ x0: 41.5, y0: 156.5, x1: 57.5, y1: 176.5 });
  });

  it.each(['hexia', 'tafa'])('%s stands each landmark on the ground its profile names', (id) => {
    const t = getMapTemplate(id);
    for (const l of t.landmarks) expect(landmarkGroundHolds(landmarkSpec(l.id)!, l, l.rotation ?? 0, zonesReader(t.zones)), l.id).toBe(true);
  });

  it.each(['hexia', 'tafa'])('%s records grass under every cell the plaza covers and no retired plaza zone', (id) => {
    const t = getMapTemplate(id);
    const p = templateAnchor(t)!;
    for (let y = Math.floor(p.y); y < Math.ceil(p.y + p.height); y++) {
      for (let x = Math.floor(p.x); x < Math.ceil(p.x + p.width); x++) expect(t.zones[y]![x], `${x},${y}`).toBe(CellZone.Grass);
    }
    expect(t.zones.flat()).not.toContain(3);
  });

  it('opens a fresh map with every landmark locked, the station reaching past the saved cells', () => {
    const t = getMapTemplate('tafa');
    const state = createGridState(t);
    for (const spec of LANDMARKS) expect(state.objects.get(spec.id)).toMatchObject({ locked: true, catalogId: spec.id });
    const station = state.objects.get(STATION.id)!;
    expect(station.position.y + station.height!).toBeGreaterThan(t.height);
  });
});

describe('landmark ids and upgrades', () => {
  it('names a planet by its landmarks, in profile order whatever order they are listed in', () => {
    const coast = { ...planetFixture(), landmarks: [] as MapTemplate['landmarks'] };
    const station = landmarkAt(10, 20, undefined, STATION);
    const plaza = landmarkAt(12.5, 3);
    const a = planetTemplateId({ ...coast, landmarks: [plaza, station] });
    expect(planetTemplateId({ ...coast, landmarks: [station, plaza] })).toBe(a);
    expect(planetTemplateId({ ...coast, landmarks: [plaza] })).not.toBe(a);
  });

  it('regrows a plaza stored at an earlier footprint about its centre and renames the planet', () => {
    const base = planetFixture();
    const old = { ...landmarkAt(12, 3), width: ANCHOR_LANDMARK.width + 1, height: ANCHOR_LANDMARK.height + 1 };
    const body = { ...base, landmarks: [old] };
    const stored = { ...body, id: planetTemplateId(body) };
    const up = upgradeLandmarks(stored);
    expect(templateAnchor(up)).toMatchObject({ x: 12.5, y: 3.5, width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height });
    expect(up.id).toBe(planetTemplateId(up));
    expect(up.id).not.toBe(stored.id);
    expect(upgradeLandmarks(up)).toBe(up);
  });

  it('anchors the regrowth at a corner where the centred one would leave the grass', () => {
    const base = planetFixture();
    // Grass rows 3 to 30: a plaza one row short of the profile's from row 3 can only grow downwards.
    const old = { ...landmarkAt(12.5, 3), width: ANCHOR_LANDMARK.width - 1, height: ANCHOR_LANDMARK.height - 1 };
    const stored = { ...base, landmarks: [old] };
    const up = upgradeLandmarks({ ...stored, id: planetTemplateId(stored) });
    const p = templateAnchor(up)!;
    expect(p.y).toBe(3);
    expect(getRotatedSize(ANCHOR_LANDMARK, 0)).toEqual({ w: p.width, h: p.height });
    expect(landmarkGroundHolds(ANCHOR_LANDMARK, p, 0, zonesReader(up.zones))).toBe(true);
  });

  it('lays the landmarks a template places, in profile order', () => {
    expect(templateLandmarkObjects(getMapTemplate('hexia')).map((o) => o.id)).toEqual(LANDMARKS.map((l) => l.id));
  });
});

describe('laid landmarks', () => {
  it('counts a locked landmark object and neither an unlocked one nor a locked ordinary item', () => {
    const laid = templateLandmarkObjects({ landmarks: [{ id: ANCHOR_LANDMARK.id, x: 2, y: 3, width: 2, height: 1 }] })[0]!;
    expect(isLaidLandmark(laid)).toBe(true);
    expect(isLaidLandmark({ ...laid, locked: false })).toBe(false);
    expect(isLaidLandmark({ ...laid, catalogId: 'not-a-landmark' })).toBe(false);
  });

  it('lists every cell a laid landmark covers, part-covered cells included', () => {
    const objects = new Map(templateLandmarkObjects({ landmarks: [{ id: ANCHOR_LANDMARK.id, x: 2.5, y: 3, width: 2, height: 1 }] }).map((o) => [o.id, o]));
    expect(landmarkCells({ objects })).toEqual([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }]);
    const planet = planetLandmarkObject(ANCHOR_LANDMARK, { x: 0, y: 0 }, 0);
    expect(landmarkCells({ objects: new Map([[planet.id, planet]]) })).toEqual([]);
  });
});
