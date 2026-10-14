import { fnv1a } from '../base/hash';
import { hasLandmark, landmarkConfig, landmarkGroundHolds, landmarksOf, zonesReader } from './landmarks';
import { cellsBounds, snapHalf } from '../grid/rect';
import { getRotatedSize } from '../grid/footprint';
import { OFF_MAP_ZONE, isBuildableZone, isLandZone, type CellZone } from '../game/zones';
import { ANCHOR_LANDMARK, LANDMARKS, PLANET_PROFILE, CHUNK_SIZE, landmarkSpec } from '../game/profile';
import { deriveBoundary, rimSandOf } from './shore';
import { anySet, loadableWater } from './template';
import { TerrainType, type LandmarkConfig, type MapTemplate, type PlacedObject, type TerrainCell } from './types';

/** A custom planet is at most this many cells on each side: the profile's chunk cap in cells. */
export const PLANET_MAX_CELLS = PLANET_PROFILE.maxChunks * CHUNK_SIZE;
/** The template's chunk grid, or whole chunks from its top-left cell when it records none. */
export function planetChunkGrid(t: Pick<MapTemplate, 'width' | 'height' | 'chunkGrid'>): NonNullable<MapTemplate['chunkGrid']> {
  return t.chunkGrid ?? { origin: { x: 0, y: 0 }, columns: Math.ceil(t.width / CHUNK_SIZE), rows: Math.ceil(t.height / CHUNK_SIZE) };
}

export function isCustomTemplate(t: Pick<MapTemplate, 'id'>): boolean {
  return t.id.startsWith(PLANET_PROFILE.templatePrefix);
}

/** A planet's frame on a grid: x0/y0 in cells, cols/rows in whole chunks. */
export interface PlanetFrame { x0: number; y0: number; cols: number; rows: number }

/** The ground (grass and beach) bounding box snapped outward to whole chunks. */
function derivePlanetFrame(zones: readonly (readonly CellZone[])[]): PlanetFrame | null {
  const land = zones.flatMap((row, y) => row.flatMap((z, x) => (isLandZone(z) ? [{ x, y }] : [])));
  const box = cellsBounds(land);
  if (!box) return null;
  const x0 = box.x, y0 = box.y, x1 = box.x + box.w - 1, y1 = box.y + box.h - 1;
  const cx0 = Math.floor(x0 / CHUNK_SIZE), cy0 = Math.floor(y0 / CHUNK_SIZE);
  return { x0: cx0 * CHUNK_SIZE, y0: cy0 * CHUNK_SIZE, cols: Math.floor(x1 / CHUNK_SIZE) - cx0 + 1, rows: Math.floor(y1 / CHUNK_SIZE) - cy0 + 1 };
}

/** `frame` grown to whole chunks that also cover the rect, clamped to a `width` by `height` grid. */
function frameWithRect(frame: PlanetFrame, rect: { x: number; y: number; w: number; h: number }, width: number, height: number): PlanetFrame {
  const x0 = Math.max(0, Math.min(frame.x0, Math.floor(rect.x / CHUNK_SIZE) * CHUNK_SIZE));
  const y0 = Math.max(0, Math.min(frame.y0, Math.floor(rect.y / CHUNK_SIZE) * CHUNK_SIZE));
  const x1 = Math.min(width, Math.max(frame.x0 + frame.cols * CHUNK_SIZE, Math.ceil((rect.x + rect.w) / CHUNK_SIZE) * CHUNK_SIZE));
  const y1 = Math.min(height, Math.max(frame.y0 + frame.rows * CHUNK_SIZE, Math.ceil((rect.y + rect.h) / CHUNK_SIZE) * CHUNK_SIZE));
  return { x0, y0, cols: (x1 - x0) / CHUNK_SIZE, rows: (y1 - y0) / CHUNK_SIZE };
}

/** The whole chunks a grid's ground (each cell's own ground, no rim) and its landmarks cover, or null
 *  when it has no ground. */
export function groundFrame(ground: readonly (readonly CellZone[])[], landmarks: readonly PlacedObject[]): PlanetFrame | null {
  let frame = derivePlanetFrame(ground);
  if (!frame) return null;
  for (const landmark of landmarks) {
    if (!hasLandmark(landmark)) continue;
    const rect = { x: landmark.position.x, y: landmark.position.y, w: landmark.width, h: landmark.height };
    frame = frameWithRect(frame, rect, ground[0]?.length ?? 0, ground.length);
  }
  return frame;
}

/** A planet cut out of a larger grid: the template and the sand its rim hides (`rimSandOf`). */
export interface PlanetCrop { template: MapTemplate; rimSand: number[] }

/** A crop and the frame of the grid it was cut from: template cell (x, y) is grid cell
 *  (frame.x0 + x, frame.y0 + y). */
export interface PlanetCut extends PlanetCrop { frame: PlanetFrame }

/**
 * The planet a grid holds: its ground (each cell's own ground, no rim) and landmark cropped to their
 * chunk frame, the shore derived from that ground, mountain elevations and water from `terrainAt`
 * (grid coordinates) on the cells that can hold them, and the landmarks translated into the crop, with
 * the sand under the rim, and the frame it was cut at. The id is the content's. Null when the grid
 * has no ground.
 */
export function cropPlanet(
  ground: readonly (readonly CellZone[])[],
  landmarks: readonly PlacedObject[],
  terrainAt: (x: number, y: number) => TerrainCell | null | undefined,
  name: string,
): PlanetCut | null {
  const frame = groundFrame(ground, landmarks);
  if (!frame) return null;
  const width = frame.cols * CHUNK_SIZE, height = frame.rows * CHUNK_SIZE;
  const cropped = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ground[frame.y0 + y]?.[frame.x0 + x] ?? OFF_MAP_ZONE));
  const zones = deriveBoundary(cropped);
  const terrain = new Uint8Array(width * height);
  const water = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = terrainAt(frame.x0 + x, frame.y0 + y);
    if (!t || !isBuildableZone(zones[y]![x]!)) continue;
    if (t.type === TerrainType.Mountain) terrain[y * width + x] = t.elevation;
    else if (t.type === TerrainType.Water) { terrain[y * width + x] = t.elevation; water[y * width + x] = 1; }
  }
  const origin = { x: frame.x0, y: frame.y0 };
  const body = {
    width, height, zones, landmarks: landmarksOf(landmarks).map((o) => landmarkConfig(o, origin)),
    ...(terrain.some((e) => e > 0) ? { terrain } : {}),
    ...(water.some((e) => e > 0) ? { water } : {}),
    chunkGrid: { origin: { x: 0, y: 0 }, columns: frame.cols, rows: frame.rows },
  };
  return { template: { id: planetTemplateId(body), name: { en: name }, ...body }, rimSand: rimSandOf(cropped, zones), frame };
}

/**
 * Content-addressed id over size, zones, landmarks, terrain and loadable water. An all-zero array
 * hashes like none, so a planet without water keeps the id it had before templates carried water.
 * The anchor landmark hashes in a fixed slot, as a zero footprint when absent; every other landmark
 * hashes only when present, so a planet holding the anchor alone keeps the id it had before
 * templates carried more than one landmark.
 */
export function planetTemplateId(t: Omit<MapTemplate, 'id' | 'name'>): string {
  const anchor = t.landmarks.find((l) => l.id === ANCHOR_LANDMARK?.id && hasLandmark(l));
  const [ax, ay, aw, ah, ar] = anchor ? [anchor.x * 2, anchor.y * 2, anchor.width, anchor.height, anchor.rotation ?? 0] : [0, 0, 0, 0, 0];
  const parts = [t.width, t.height, ax, ay, aw, ah, ar, t.zones.map((r) => r.join('')).join('/'), anySet(t.terrain) ? t.terrain.join(',') : ''];
  const water = loadableWater(t);
  if (water) parts.push(`w${water.join('')}`);
  for (const spec of LANDMARKS) {
    const l = spec.anchor ? undefined : t.landmarks.find((c) => c.id === spec.id && hasLandmark(c));
    if (l) parts.push(`l${l.id}:${l.x * 2},${l.y * 2},${l.width},${l.height},${l.rotation ?? 0}`);
  }
  return `${PLANET_PROFILE.templatePrefix}${fnv1a(parts.join('|'))}`;
}

/**
 * `t` with every landmark at the profile's footprint for its turn, regrown about its centre on the
 * half-cell grid, and the id its content then hashes to; `t` itself when every landmark already has
 * it. When the regrown footprint would leave the template or its ground, the regrowth anchored at each
 * corner is tried in turn, and a landmark none of them fits keeps the footprint it had.
 */
export function upgradeLandmarks(t: MapTemplate): MapTemplate {
  let changed = false;
  const zoneAt = zonesReader(t.zones);
  const landmarks = t.landmarks.map((l): LandmarkConfig => {
    const spec = landmarkSpec(l.id);
    if (!spec || !hasLandmark(l)) return l;
    const want = getRotatedSize(spec, l.rotation ?? 0);
    if (want.w === l.width && want.h === l.height) return l;
    const dw = want.w - l.width, dh = want.h - l.height;
    const shifts: [number, number][] = [[dw / 2, dh / 2], [0, 0], [dw, 0], [0, dh], [dw, dh]];
    for (const [sx, sy] of shifts) {
      const rect = { x: snapHalf(l.x - sx), y: snapHalf(l.y - sy), width: want.w, height: want.h };
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > t.width || rect.y + rect.height > t.height) continue;
      if (!landmarkGroundHolds(spec, rect, l.rotation ?? 0, zoneAt)) continue;
      changed = true;
      return { ...l, ...rect };
    }
    return l;
  });
  if (!changed) return t;
  const body = { ...t, landmarks };
  return { ...body, id: planetTemplateId(body) };
}
