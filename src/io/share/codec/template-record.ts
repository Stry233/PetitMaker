// The custom planet a frame-6 payload carries: fixed header fields, then zones, optional terrain and
// optional water range-coded in raster order with already decoded neighbours as context.
import { RangeEncoder, RangeDecoder, BitModel, TreeModel, encodeTree, decodeTree } from './bitio';
import { ByteWriter, ByteReader } from './bytes';
import { ShareError } from '../errors';
import { clampName } from '../../planet-codec';
import { CellZone, type MapTemplate, type Rotation } from '../../../core/model/types';
import { loadableWater, planetChunkGrid, planetTemplateId, PLANET_MAX_CELLS } from '../../../core/model/planet';
import { hasLandmark } from '../../../core/model/grid-model';
import { validatePlanetTemplate } from '../../../core/model/planet-validate';
import { ELEVATION_MAX } from '../../../core/model/game-profile';

const ZONE_VALUES = 5;
/** The plaza rotation byte holds quarter turns in its low two bits; this bit marks a water section. */
const WATER_FLAG = 4;

class Models {
  /** One tree per (W, N, NW, NE) zone context; out-of-grid neighbours read as Void. */
  zone = Array.from({ length: ZONE_VALUES ** 4 }, () => new TreeModel(3));
  hasTerrain = new BitModel();
  /** Context: cell is grass, W raised, N raised. */
  elevation = Array.from({ length: 8 }, () => new TreeModel(4));
  /** Context: cell is grass, W water, N water. */
  water = Array.from({ length: 8 }, () => new BitModel());
}

const zoneAt = (zones: readonly (readonly number[])[], x: number, y: number, w: number): number =>
  (x < 0 || y < 0 || x >= w ? CellZone.Void : zones[y]?.[x] ?? CellZone.Void);

function zoneCtx(zones: readonly (readonly number[])[], x: number, y: number, w: number): number {
  return zoneAt(zones, x - 1, y, w) * 125 + zoneAt(zones, x, y - 1, w) * 25 + zoneAt(zones, x - 1, y - 1, w) * 5 + zoneAt(zones, x + 1, y - 1, w);
}

/** Context: whether the cell is grass and its west and north neighbours are nonzero in `values`. */
function elevCtx(zone: number, values: Uint8Array, i: number, x: number, w: number): number {
  const west = x > 0 && values[i - 1]! > 0 ? 2 : 0;
  const north = i >= w && values[i - w]! > 0 ? 4 : 0;
  return (zone === CellZone.Grass ? 1 : 0) | west | north;
}

export function encodeTemplateRecord(t: MapTemplate): Uint8Array {
  const p = t.plaza;
  const hasPlaza = hasLandmark(p);
  const grid = planetChunkGrid(t);
  const w = new ByteWriter();
  w.u16(t.width);
  w.u16(t.height);
  w.u16(hasPlaza ? p.x * 2 : 0);
  w.u16(hasPlaza ? p.y * 2 : 0);
  w.u8(hasPlaza ? p.width : 0);
  w.u8(hasPlaza ? p.height : 0);
  const water = t.water?.some((e) => e > 0) ? t.water : undefined;
  w.u8((hasPlaza ? (p.rotation ?? 0) / 90 : 0) | (water ? WATER_FLAG : 0));
  w.u8(p.elevation);
  w.u8(grid.columns);
  w.u8(grid.rows);
  w.i16(grid.origin.x);
  w.i16(grid.origin.y);
  w.str8(clampName(t.name.en));

  const m = new Models();
  const enc = new RangeEncoder();
  for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
    encodeTree(enc, m.zone[zoneCtx(t.zones, x, y, t.width)]!, t.zones[y]![x]!);
  }
  const terrain = t.terrain?.some((e) => e > 0) ? t.terrain : undefined;
  enc.encodeBit(m.hasTerrain, terrain ? 1 : 0);
  if (terrain) {
    for (let i = 0; i < terrain.length; i++) {
      const x = i % t.width;
      encodeTree(enc, m.elevation[elevCtx(t.zones[Math.floor(i / t.width)]![x]!, terrain, i, x, t.width)]!, terrain[i]!);
    }
  }
  if (water) {
    for (let i = 0; i < water.length; i++) {
      const x = i % t.width;
      enc.encodeBit(m.water[elevCtx(t.zones[Math.floor(i / t.width)]![x]!, water, i, x, t.width)]!, water[i]! > 0 ? 1 : 0);
    }
  }
  w.raw(enc.finish());
  return w.toBytes();
}

/** Rebuilds and validates the planet, its id recomputed from content; a malformed record throws `ShareError('corrupt')`. */
export function decodeTemplateRecord(bytes: Uint8Array): MapTemplate {
  let t: MapTemplate;
  try {
    t = readRecord(bytes);
  } catch (e) {
    throw new ShareError('corrupt', `Malformed planet record: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (validatePlanetTemplate(t) !== null) throw new ShareError('corrupt', 'Invalid planet record.');
  return t;
}

function readRecord(bytes: Uint8Array): MapTemplate {
  const r = new ByteReader(bytes);
  const width = r.u16(), height = r.u16();
  if (width < 1 || height < 1 || width > PLANET_MAX_CELLS || height > PLANET_MAX_CELLS) throw new Error('size out of range');
  const px = r.u16() / 2, py = r.u16() / 2;
  const pw = r.u8(), ph = r.u8(), turn = r.u8(), elevation = r.u8();
  const columns = r.u8(), rows = r.u8();
  const ox = r.i16(), oy = r.i16();
  const name = r.str8();
  if (turn & ~(3 | WATER_FLAG)) throw new Error('plaza rotation out of range');
  const rot = turn & 3;

  const m = new Models();
  const dec = new RangeDecoder(r.rest());
  const zones: CellZone[][] = [];
  for (let y = 0; y < height; y++) {
    const row: CellZone[] = [];
    zones.push(row);
    for (let x = 0; x < width; x++) {
      const z = decodeTree(dec, m.zone[zoneCtx(zones, x, y, width)]!);
      if (z >= ZONE_VALUES) throw new Error('zone out of range');
      row.push(z as CellZone);
    }
  }
  let terrain: Uint8Array | undefined;
  if (dec.decodeBit(m.hasTerrain)) {
    terrain = new Uint8Array(width * height);
    for (let i = 0; i < terrain.length; i++) {
      const x = i % width;
      const e = decodeTree(dec, m.elevation[elevCtx(zones[Math.floor(i / width)]![x]!, terrain, i, x, width)]!);
      if (e > ELEVATION_MAX) throw new Error('elevation out of range');
      terrain[i] = e;
    }
  }
  let water: Uint8Array | undefined;
  if (turn & WATER_FLAG) {
    water = new Uint8Array(width * height);
    for (let i = 0; i < water.length; i++) {
      const x = i % width;
      water[i] = dec.decodeBit(m.water[elevCtx(zones[Math.floor(i / width)]![x]!, water, i, x, width)]!);
    }
  }

  const plaza = pw > 0 && ph > 0
    ? { x: px, y: py, width: pw, height: ph, elevation, ...(rot ? { rotation: (rot * 90) as Rotation } : {}) }
    : { x: 0, y: 0, width: 0, height: 0, elevation };
  const loadable = water && loadableWater({ width, zones, water });
  const body = { width, height, zones, plaza, chunkGrid: { origin: { x: ox, y: oy }, columns, rows }, ...(terrain ? { terrain } : {}), ...(loadable ? { water: loadable } : {}) };
  return { id: planetTemplateId(body), name: { en: clampName(name) }, ...body };
}
