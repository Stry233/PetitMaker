import { CellZone, type MapTemplate, type Rotation } from '../../core/model/types';
import { deriveBoundary, planetTemplateId, NO_PLANET_PLAZA, PLANET_MAX_CELLS } from '../../core/model/planet';
import { PLANET_PROFILE } from '../../core/model/game-profile';
import { validatePlanetTemplate } from '../../core/model/planet-validate';
import { getMapTemplate } from '../../config/maps';

export const NO_PLAZA = { ...NO_PLANET_PLAZA };

const HEXIA_PLAZA = getMapTemplate('hexia').plaza;
/** Hexia's plaza body: a rect anchored on the half grid. */
export const PLAZA_RECT = { x: HEXIA_PLAZA.x, y: HEXIA_PLAZA.y, w: HEXIA_PLAZA.width, h: HEXIA_PLAZA.height } as const;

/** The landmark as a template plaza at (x, y); a 90 or 270 turn swaps its footprint. */
export function landmarkAt(x: number, y: number, rotation?: Rotation, elevation: number = PLANET_PROFILE.landmark.elevation): MapTemplate['plaza'] {
  const { width, height } = PLANET_PROFILE.landmark;
  const turned = rotation === 90 || rotation === 270;
  return { x, y, width: turned ? height : width, height: turned ? width : height, elevation, ...(rotation === undefined ? {} : { rotation }) };
}

/** A valid 48 x 32 custom planet with one terrain cell set and a plaza; `water` adds a pond. */
export function planetFixture(over: { plaza?: MapTemplate['plaza']; terrain?: Uint8Array | null; water?: Uint8Array } = {}): MapTemplate {
  const zones = Array.from({ length: 32 }, (_, y) => Array.from({ length: 48 }, (_, x) => (x > 4 && x < 44 && y > 2 && y < 31 ? CellZone.Grass : CellZone.Void)));
  const terrain = new Uint8Array(48 * 32); terrain[10 * 48 + 10] = 3;
  const plaza = over.plaza ?? { x: 12.5, y: 3.5, ...PLANET_PROFILE.landmark };
  const t = over.terrain === null ? undefined : over.terrain ?? terrain;
  const body = { width: 48, height: 32, zones, plaza, ...(t ? { terrain: t } : {}), ...(over.water ? { water: over.water } : {}), chunkGrid: { origin: { x: 0, y: 0 }, columns: 3, rows: 2 } };
  return { id: planetTemplateId(body), name: { en: 'Bay' }, ...body };
}

/** A water mask for the fixture: a pond over the given cells of its grass. */
export function pondMask(cells: readonly [number, number][]): Uint8Array {
  const water = new Uint8Array(48 * 32);
  for (const [x, y] of cells) water[y * 48 + x] = 1;
  return water;
}

/** The largest planet: 256 x 256 cells of several noisy islands with a plaza on the main one. Deterministic. */
export function worstCasePlanet(): MapTemplate {
  const size = PLANET_MAX_CELLS;
  const blobs = [[128, 128, 70, 56], [210, 60, 30, 24], [50, 200, 26, 20], [40, 50, 22, 30], [215, 205, 28, 22]] as const;
  const noise = (x: number, y: number) => Math.sin(x * 0.31) * Math.cos(y * 0.27) * 6 + Math.sin((x + y) * 0.13) * 5 + Math.cos(x * 0.71 - y * 0.53) * 3;
  const ground = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x): CellZone => {
    let best = 9;
    for (const [cx, cy, rx, ry] of blobs) best = Math.min(best, Math.hypot((x - cx) / rx, (y - cy) / ry) - noise(x, y) / 60);
    return best < 0.86 ? CellZone.Grass : best < 1 ? CellZone.Beach : CellZone.Void;
  }));
  const zones = deriveBoundary(ground);
  const plaza = { x: 118.5, y: 114.5, ...PLANET_PROFILE.landmark };
  const body = { width: size, height: size, zones, plaza, chunkGrid: { origin: { x: 0, y: 0 }, columns: PLANET_PROFILE.maxChunks, rows: PLANET_PROFILE.maxChunks } };
  const t: MapTemplate = { id: planetTemplateId(body), name: { en: 'Archipelago' }, ...body };
  if (validatePlanetTemplate(t) !== null) throw new Error('worstCasePlanet: invalid fixture');
  return t;
}
