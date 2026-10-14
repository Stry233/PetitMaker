import { type LandmarkConfig, type MapTemplate, type Rotation } from '../../core/model/types';
import { CellZone } from '../../core/game/zones';
import { planetTemplateId, PLANET_MAX_CELLS } from '../../core/model/planet';
import { deriveBoundary } from '../../core/model/shore';
import { PLANET_PROFILE, type LandmarkSpec } from '../../core/game/profile';
import { ANCHOR_LANDMARK } from './anchor';
import { templateAnchor } from '../../core/model/landmarks';
import { validatePlanetTemplate } from '../../core/model/planet-validate';
import { getMapTemplate } from '../../config/maps';

/** A fixture option for a planet without a plaza. */
export const NO_PLAZA = null;

const HEXIA_PLAZA = templateAnchor(getMapTemplate('hexia'))!;
/** A plaza body at Hexia's footprint, anchored half a cell up and left of Hexia's on the half grid. */
export const PLAZA_RECT = { x: HEXIA_PLAZA.x - 0.5, y: HEXIA_PLAZA.y - 0.5, w: HEXIA_PLAZA.width, h: HEXIA_PLAZA.height } as const;

/** Landmark `spec` (the plaza by default) as a template landmark at (x, y); a 90 or 270 turn swaps its footprint. */
export function landmarkAt(x: number, y: number, rotation?: Rotation, spec: LandmarkSpec = ANCHOR_LANDMARK): LandmarkConfig {
  const { width, height } = spec;
  const turned = rotation === 90 || rotation === 270;
  return { id: spec.id, x, y, width: turned ? height : width, height: turned ? width : height, ...(rotation === undefined ? {} : { rotation }) };
}

/** A valid 48 x 32 custom planet with one terrain cell set and a plaza (`plaza: NO_PLAZA` for none);
 *  `landmarks` adds others; `water` adds a pond. */
export function planetFixture(
  over: { plaza?: LandmarkConfig | null; landmarks?: LandmarkConfig[]; terrain?: Uint8Array | null; water?: Uint8Array } = {},
): MapTemplate {
  const zones = Array.from(
    { length: 32 }, (_, y) => Array.from({ length: 48 }, (_, x) => (x > 4 && x < 44 && y > 2 && y < 31 ? CellZone.Grass : CellZone.Void)),
  );
  const terrain = new Uint8Array(48 * 32); terrain[10 * 48 + 10] = 3;
  const plaza = over.plaza === undefined ? landmarkAt(12.5, 3) : over.plaza;
  const landmarks = [...(plaza ? [plaza] : []), ...(over.landmarks ?? [])];
  const t = over.terrain === null ? undefined : over.terrain ?? terrain;
  const body = {
    width: 48, height: 32, zones, landmarks, ...(t ? { terrain: t } : {}), ...(over.water ? { water: over.water } : {}),
    chunkGrid: { origin: { x: 0, y: 0 }, columns: 3, rows: 2 },
  };
  return { id: planetTemplateId(body), name: { en: 'Bay' }, ...body };
}

/** Where the built-in planets laid their plaza before they followed the game's layout sheet: a 20 by
 *  27 footprint, and no station. */
const EARLIER_PLAZA: Record<string, { x: number; y: number }> = { hexia: { x: 76.5, y: 58.5 }, tafa: { x: 76.5, y: 59.5 } };

/** Built-in planet `id` laid out as it was before the layout sheet, for maps saved on it then and
 *  read as they were built: the earlier plaza alone, on the same grass. */
export function earlierLayout(id: 'hexia' | 'tafa'): MapTemplate {
  const t = getMapTemplate(id);
  const plaza = { ...landmarkAt(EARLIER_PLAZA[id]!.x, EARLIER_PLAZA[id]!.y), width: 20, height: 27, color: templateAnchor(t)!.color };
  return { ...t, landmarks: [plaza] };
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
  const body = {
    width: size, height: size, zones, landmarks: [landmarkAt(118.5, 114.5)],
    chunkGrid: { origin: { x: 0, y: 0 }, columns: PLANET_PROFILE.maxChunks, rows: PLANET_PROFILE.maxChunks },
  };
  const t: MapTemplate = { id: planetTemplateId(body), name: { en: 'Archipelago' }, ...body };
  if (validatePlanetTemplate(t) !== null) throw new Error('worstCasePlanet: invalid fixture');
  return t;
}
