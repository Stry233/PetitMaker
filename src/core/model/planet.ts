import { fnv1a } from './hash';
import { createGrid, createPlazaObject, groundZone, hasLandmark, isBuildableZone, isGrassZone, isLandZone, landmarkObject, snapHalf } from './grid-model';
import { PLANET_PROFILE, CHUNK_SIZE, ELEVATION_MAX } from './game-profile';
import { CellZone, TerrainType, type GridState, type MacroCell, type MacroCoord, type MapTemplate, type PlacedObject, type Rotation, type PlazaConfig, type TerrainCell, turnRotation } from './types';

/** A custom planet is at most this many cells on each side: the profile's chunk cap in cells. */
export const PLANET_MAX_CELLS = PLANET_PROFILE.maxChunks * CHUNK_SIZE;
const SHORE = PLANET_PROFILE.shoreRadius;
/** On the full-size session canvas a full pass costs about 3.5 ms, and the local pass about 0.3 µs per
 *  changed cell in a compact stroke and up to 1.7 µs for cells spread five apart, so from this many
 *  changed cells the full pass bounds the cost at the full pass's own. */
const REFRESH_FULL_PASS_AT = 2000;

/** A custom planet without a plaza: a zero footprint at the profile's plaza elevation. Copy it before changing it. */
export const NO_PLANET_PLAZA: Readonly<PlazaConfig> = { x: 0, y: 0, width: 0, height: 0, elevation: PLANET_PROFILE.landmark.elevation };

/** The template's chunk grid, or whole chunks from its top-left cell when it records none. */
export function planetChunkGrid(t: Pick<MapTemplate, 'width' | 'height' | 'chunkGrid'>): NonNullable<MapTemplate['chunkGrid']> {
  return t.chunkGrid ?? { origin: { x: 0, y: 0 }, columns: Math.ceil(t.width / CHUNK_SIZE), rows: Math.ceil(t.height / CHUNK_SIZE) };
}

export function isCustomTemplate(t: Pick<MapTemplate, 'id'>): boolean {
  return t.id.startsWith(PLANET_PROFILE.templatePrefix);
}

/** The planet editor's scratch canvas ids carry this prefix and a per-session number, so a cache
 *  keyed by template id (a worker's template store) never serves one session's canvas to the next. */
export const PLANET_CANVAS_ID_PREFIX = 'planet-canvas-';

export function isPlanetCanvasId(id: string): boolean {
  return id.startsWith(PLANET_CANVAS_ID_PREFIX);
}

/** Whether grass or plaza lies within the shore radius of (x, y). */
function nearGround(zoneAt: (x: number, y: number) => CellZone | undefined, x: number, y: number): boolean {
  for (let dy = -SHORE; dy <= SHORE; dy++) for (let dx = -SHORE; dx <= SHORE; dx++) {
    const z = zoneAt(x + dx, y + dy);
    if (z !== undefined && isGrassZone(z)) return true;
  }
  return false;
}

/** Whether each cell has grass or plaza within the shore radius, by a row window then a column window. */
function groundNear(zones: readonly (readonly CellZone[])[]): (x: number, y: number) => boolean {
  // `across[y][x]` says whether row y holds ground within the radius of x, read off a running count
  // of the row's ground.
  const across = zones.map((row) => {
    const count = new Uint32Array(row.length + 1);
    row.forEach((z, x) => { count[x + 1] = count[x]! + (isGrassZone(z) ? 1 : 0); });
    const near = new Uint8Array(row.length);
    for (let x = 0; x < row.length; x++) near[x] = count[Math.min(row.length, x + SHORE + 1)]! > count[Math.max(0, x - SHORE)]! ? 1 : 0;
    return near;
  });
  return (x, y) => {
    for (let dy = -SHORE; dy <= SHORE; dy++) if (across[y + dy]?.[x]) return true;
    return false;
  };
}

/**
 * A new grid whose sea and sand within the shore radius of grass or plaza are Boundary. A Boundary
 * cell in the input is read as open sea, so a rim beyond the radius becomes Void.
 */
export function deriveBoundary(zones: CellZone[][]): CellZone[][] {
  const near = groundNear(zones);
  return zones.map((row, y) => row.map((z, x): CellZone => {
    if (isGrassZone(z)) return z;
    if (near(x, y)) return CellZone.Boundary;
    return z === CellZone.Boundary ? CellZone.Void : z;
  }));
}

/**
 * The ground under each Boundary cell of a stored template. `sand` lists, as row-major indices, the
 * rim cells whose ground is sand (`rimSandOf`); without it a rim cell reads as sand when any of its
 * eight neighbours is sand, otherwise sea. A rim cell in a concave corner meets the ground beyond only
 * diagonally.
 */
export function groundUnderRim(zones: readonly (readonly CellZone[])[], sand?: readonly number[]): CellZone[][] {
  const width = zones[0]?.length ?? 0;
  const listed = sand ? new Set(sand) : null;
  const sandNear = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (zones[y + dy]?.[x + dx] === CellZone.Beach) return true;
    return false;
  };
  const isSand = (x: number, y: number) => (listed ? listed.has(y * width + x) : sandNear(x, y));
  return zones.map((row, y) => row.map((z, x): CellZone => (z === CellZone.Boundary ? (isSand(x, y) ? CellZone.Beach : CellZone.Void) : z)));
}

/**
 * The row-major indices of the Boundary cells in `zones` whose ground in `ground` is sand: what a
 * stored template's rim hides and `groundUnderRim` restores. It is kept beside the template, outside
 * its id, which names the planet as it looks.
 */
export function rimSandOf(ground: readonly (readonly CellZone[])[], zones: readonly (readonly CellZone[])[]): number[] {
  const width = zones[0]?.length ?? 0;
  const out: number[] = [];
  zones.forEach((row, y) => row.forEach((z, x) => { if (z === CellZone.Boundary && ground[y]?.[x] === CellZone.Beach) out.push(y * width + x); }));
  return out;
}

/** Settles one cell's rim by `near`, keeping the ground under it; whether its zone changed. */
function settleRim(cell: MacroCell, near: boolean): boolean {
  if (isGrassZone(cell.zone)) return false;
  if (near) {
    if (cell.zone === CellZone.Boundary) return false;
    if (cell.zone === CellZone.Beach) cell.under = CellZone.Beach;
    cell.zone = CellZone.Boundary;
    return true;
  }
  if (cell.zone !== CellZone.Boundary) return false;
  cell.zone = groundZone(cell);
  delete cell.under;
  return true;
}

/**
 * Re-derives in place, by `deriveBoundary`'s rule, the rim of every sea or sand cell within the shore
 * radius of `changed`: the only cells whose rim a change of ground there can move. A cell that becomes
 * rim keeps its own ground in `under`, and one that leaves the rim gets that ground back. Returns the
 * cells whose zone changed. `fullPassAt` is the changed-cell count from which one pass over the whole
 * grid is used instead.
 */
export function refreshBoundary(cells: MacroCell[][], changed: readonly MacroCoord[], fullPassAt = REFRESH_FULL_PASS_AT): MacroCoord[] {
  const zoneAt = (x: number, y: number) => cells[y]?.[x]?.zone;
  const height = cells.length, width = cells[0]?.length ?? 0;
  const out: MacroCoord[] = [];
  if (changed.length >= fullPassAt) {
    const near = groundNear(cells.map((row) => row.map((c) => c.zone)));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (settleRim(cells[y]![x]!, near(x, y))) out.push({ x, y });
    }
    return out;
  }
  const seen = new Uint8Array(width * height);
  for (const c of changed) {
    // A half-step object announces its half-cell anchor; the window covers the cells either side of it.
    for (let y = Math.max(0, Math.floor(c.y) - SHORE); y <= Math.min(height - 1, Math.ceil(c.y) + SHORE); y++) {
      for (let x = Math.max(0, Math.floor(c.x) - SHORE); x <= Math.min(width - 1, Math.ceil(c.x) + SHORE); x++) {
        const cell = cells[y]![x]!;
        if (seen[y * width + x] || isGrassZone(cell.zone)) continue;
        seen[y * width + x] = 1;
        if (settleRim(cell, nearGround(zoneAt, x, y))) out.push({ x, y });
      }
    }
  }
  return out;
}

/** A planet's frame on a grid: x0/y0 in cells, cols/rows in whole chunks. */
export interface PlanetFrame { x0: number; y0: number; cols: number; rows: number }

/** The ground (grass and beach) bounding box snapped outward to whole chunks. */
export function derivePlanetFrame(zones: readonly (readonly CellZone[])[]): PlanetFrame | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  zones.forEach((row, y) => row.forEach((z, x) => {
    if (!isLandZone(z)) return;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }));
  if (x1 < 0) return null;
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

/** The whole chunks a grid's ground (each cell's own ground, no rim) and its landmark cover, or null
 *  when it has no ground. */
export function groundFrame(ground: readonly (readonly CellZone[])[], landmark: PlacedObject | null | undefined): PlanetFrame | null {
  const frame = derivePlanetFrame(ground);
  if (!frame || !hasLandmark(landmark)) return frame;
  const rect = { x: landmark.position.x, y: landmark.position.y, w: landmark.width, h: landmark.height };
  return frameWithRect(frame, rect, ground[0]?.length ?? 0, ground.length);
}

/** A planet cut out of a larger grid: the template and the sand its rim hides (`rimSandOf`). */
export interface PlanetCrop { template: MapTemplate; rimSand: number[] }

/** A crop and the frame of the grid it was cut from: template cell (x, y) is grid cell
 *  (frame.x0 + x, frame.y0 + y). */
export interface PlanetCut extends PlanetCrop { frame: PlanetFrame }

/**
 * The planet a grid holds: its ground (each cell's own ground, no rim) and landmark cropped to their
 * chunk frame, the shore derived from that ground, mountain elevations and water from `terrainAt`
 * (grid coordinates) on the cells that can hold them, and the plaza translated into the crop, with
 * the sand under the rim, and the frame it was cut at. The id is the content's. Null when the grid
 * has no ground.
 */
export function cropPlanet(
  ground: readonly (readonly CellZone[])[],
  landmark: PlacedObject | null | undefined,
  terrainAt: (x: number, y: number) => TerrainCell | null | undefined,
  name: string,
): PlanetCut | null {
  const frame = groundFrame(ground, landmark);
  if (!frame) return null;
  const width = frame.cols * CHUNK_SIZE, height = frame.rows * CHUNK_SIZE;
  const cropped = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ground[frame.y0 + y]?.[frame.x0 + x] ?? CellZone.Void));
  const zones = deriveBoundary(cropped);
  const terrain = new Uint8Array(width * height);
  const water = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = terrainAt(frame.x0 + x, frame.y0 + y);
    if (!t || !isBuildableZone(zones[y]![x]!)) continue;
    if (t.type === TerrainType.Mountain) terrain[y * width + x] = t.elevation;
    else if (t.type === TerrainType.Water) { terrain[y * width + x] = t.elevation; water[y * width + x] = 1; }
  }
  const plaza = plazaConfig(landmark, { x: frame.x0, y: frame.y0 });
  const body = {
    width, height, zones, plaza,
    ...(terrain.some((e) => e > 0) ? { terrain } : {}),
    ...(water.some((e) => e > 0) ? { water } : {}),
    chunkGrid: { origin: { x: 0, y: 0 }, columns: frame.cols, rows: frame.rows },
  };
  return { template: { id: planetTemplateId(body), name: { en: name }, ...body }, rimSand: rimSandOf(cropped, zones), frame };
}

/** A template array worth storing: one that holds any nonzero cell. */
const anySet = (a: Uint8Array | undefined): a is Uint8Array => !!a?.some((e) => e > 0);

/** Whether a template lays any terrain, mountain or water, on a fresh state. */
export function templateHasTerrain(t: Pick<MapTemplate, 'terrain' | 'water'>): boolean {
  return anySet(t.terrain) || anySet(t.water);
}

/** The template's water on cells that can hold it, the only water `seedPlanetTerrain` lays; undefined
 *  when none is left. Readers store this, so a planet's water and id are what loads. */
export function loadableWater(t: Pick<MapTemplate, 'width' | 'zones' | 'water'>): Uint8Array | undefined {
  if (!anySet(t.water)) return undefined;
  const water = t.water.map((v, i) => (v && isBuildableZone(t.zones[Math.floor(i / t.width)]?.[i % t.width] ?? CellZone.Void) ? v : 0));
  return anySet(water) ? water : undefined;
}

/** Content-addressed id over size, zones, plaza, terrain and loadable water; an all-zero array hashes like none,
 *  so a planet without water keeps the id it had before templates carried water. */
export function planetTemplateId(t: Omit<MapTemplate, 'id' | 'name'>): string {
  const p = t.plaza;
  const parts = [t.width, t.height, p.x * 2, p.y * 2, p.width, p.height, p.rotation ?? 0, t.zones.map((r) => r.join('')).join('/'), anySet(t.terrain) ? t.terrain.join(',') : ''];
  const water = loadableWater(t);
  if (water) parts.push(`w${water.join('')}`);
  return `${PLANET_PROFILE.templatePrefix}${fnv1a(parts.join('|'))}`;
}

/** Lays the template's terrain onto grass cells of a freshly built grid: water where `water` marks a
 *  cell, at the elevation `terrain` gives it, and mountain elsewhere above layer 0. */
export function seedPlanetTerrain(template: MapTemplate, cells: MacroCell[][]): void {
  const { terrain, water } = template;
  if (!terrain && !water) return;
  for (let y = 0; y < template.height; y++) for (let x = 0; x < template.width; x++) {
    const i = y * template.width + x;
    const e = terrain?.[i] ?? 0;
    const cell = cells[y]?.[x];
    if (!cell || !isBuildableZone(cell.zone) || e > ELEVATION_MAX) continue;
    if (water?.[i]) cell.terrain = { type: TerrainType.Water, elevation: e };
    else if (e > 0) cell.terrain = { type: TerrainType.Mountain, elevation: e };
  }
}

/** A fresh map of `template` as a new map opens: its zones, its seeded terrain and its landmark, with
 *  no edits, no locked layers and no provenance. */
export function createGridState(template: MapTemplate): GridState {
  const state = bareGridState(template);
  seedPlanetTerrain(template, state.cells);
  const plaza = createPlazaObject(template);
  if (plaza) state.objects.set(plaza.id, plaza);
  return state;
}

/** `template`'s zones alone: no seeded terrain, no landmark and no locked layers. */
export function bareGridState(template: MapTemplate): GridState {
  return { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set() };
}

/** The template plaza `landmark` stands as, measured from `origin`, or the empty plaza when there is
 *  none: the inverse of `landmarkObject` for a planet cut out of a larger canvas. */
export function plazaConfig(landmark: PlacedObject | null | undefined, origin: MacroCoord = { x: 0, y: 0 }): PlazaConfig {
  if (!hasLandmark(landmark)) return { ...NO_PLANET_PLAZA };
  return {
    x: landmark.position.x - origin.x, y: landmark.position.y - origin.y,
    width: landmark.width, height: landmark.height, elevation: landmark.elevation,
    ...(landmark.rotation ? { rotation: landmark.rotation } : {}),
  };
}

/** An unlocked landmark with its top-left at `at`, sized by the profile; width and height are the laid footprint for `rotation`. */
export function planetPlazaObject(at: MacroCoord, rotation: Rotation): PlacedObject {
  const { width, height, elevation } = PLANET_PROFILE.landmark;
  const across = rotation === 90 || rotation === 270;
  return landmarkObject({ x: at.x, y: at.y, width: across ? height : width, height: across ? width : height, elevation, rotation }, false);
}

/** `plaza` a quarter turn clockwise: footprint swapped about the same centre, anchored on the half-cell grid. */
export function turnedPlaza(plaza: PlacedObject): PlacedObject {
  const w = plaza.width ?? 0, h = plaza.height ?? 0;
  return {
    ...plaza,
    position: { x: snapHalf(plaza.position.x + (w - h) / 2), y: snapHalf(plaza.position.y + (h - w) / 2) },
    width: h, height: w,
    rotation: turnRotation(plaza.rotation, 1),
  };
}
