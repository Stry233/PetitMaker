// The custom planet a frame-6 payload carries: fixed header fields (the anchor landmark among them),
// the other landmarks when the planet has any, then zones, optional terrain and optional water
// range-coded in raster order with already decoded neighbours as context.
import { RangeEncoder, RangeDecoder, BitModel, TreeModel, encodeTree, decodeTree } from './bitio';
import { ByteWriter, ByteReader } from './bytes';
import { ImportError } from '../../save/import-error';
import { clampName } from '../../save/planet-codec';
import { type LandmarkConfig, type MapTemplate, type Rotation } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { planetChunkGrid, planetTemplateId, PLANET_MAX_CELLS } from '../../../core/model/planet';
import { loadableWater } from '../../../core/model/template';
import { hasLandmark, templateAnchor } from '../../../core/model/landmarks';
import { isTrustedPlanet } from '../../../core/model/planet-validate';
import { ANCHOR_LANDMARK, ELEVATION_MAX, LANDMARKS, ZONE_ID_BITS } from '../../../core/game/profile';

/** Zone ids 0 to 4 the record's zone context spans, the retired plaza id 3 among them. Frozen with
 *  the frame: a record a released build wrote decodes against exactly these contexts, whatever
 *  zones the game profile later adds. */
const ZONE_VALUES = 5;
/** The anchor's rotation byte holds quarter turns in its low two bits; this bit marks a water section. */
const WATER_FLAG = 4;
/** This bit of the rotation byte marks a list of the other landmarks after the name: a count, then
 *  per landmark its index in `LANDMARKS`, its corner in half cells, its laid size, its quarter turns
 *  and a layer byte. A planet with the anchor alone writes the bytes it wrote before the list. A
 *  landmark carries no height, standing on the terrain under it, so the layer bytes are written 0
 *  and read past. */
const LANDMARKS_FLAG = 8;

class Models {
  /** One tree per (W, N, NW, NE) zone context; out-of-grid neighbours read as Void. */
  zone = Array.from({ length: ZONE_VALUES ** 4 }, () => new TreeModel(ZONE_ID_BITS));
  hasTerrain = new BitModel();
  /** Context: cell is grass, W raised, N raised. */
  elevation = Array.from({ length: 8 }, () => new TreeModel(4));
  /** Context: cell is grass, W water, N water. */
  water = Array.from({ length: 8 }, () => new BitModel());
}

const zoneAt = (zones: readonly (readonly number[])[], x: number, y: number, w: number): number =>
  (x < 0 || y < 0 || x >= w ? CellZone.Void : zones[y]?.[x] ?? CellZone.Void);

/** The (W, N, NW, NE) neighbour zones as one base-`ZONE_VALUES` context index. */
function zoneCtx(zones: readonly (readonly number[])[], x: number, y: number, w: number): number {
  const neighbours = [zoneAt(zones, x - 1, y, w), zoneAt(zones, x, y - 1, w), zoneAt(zones, x - 1, y - 1, w), zoneAt(zones, x + 1, y - 1, w)];
  return neighbours.reduce((ctx, zone) => ctx * ZONE_VALUES + zone, 0);
}

/** Context: whether the cell is grass and its west and north neighbours are nonzero in `values`. */
function elevCtx(zone: number, values: Uint8Array, i: number, x: number, w: number): number {
  const west = x > 0 && values[i - 1]! > 0 ? 2 : 0;
  const north = i >= w && values[i - w]! > 0 ? 4 : 0;
  return (zone === CellZone.Grass ? 1 : 0) | west | north;
}

/** The landmarks other than the anchor that `t` lays, in profile order. */
function otherLandmarks(t: MapTemplate): LandmarkConfig[] {
  return LANDMARKS.flatMap((spec) => (spec.anchor ? [] : t.landmarks.filter((l) => l.id === spec.id && hasLandmark(l)).slice(0, 1)));
}

export function encodeTemplateRecord(t: MapTemplate): Uint8Array {
  const anchor = templateAnchor(t);
  const p: Omit<LandmarkConfig, 'id'> = anchor ?? { x: 0, y: 0, width: 0, height: 0 };
  const hasAnchor = hasLandmark(anchor);
  const others = otherLandmarks(t);
  const grid = planetChunkGrid(t);
  const w = new ByteWriter();
  w.u16(t.width);
  w.u16(t.height);
  w.u16(hasAnchor ? p.x * 2 : 0);
  w.u16(hasAnchor ? p.y * 2 : 0);
  w.u8(hasAnchor ? p.width : 0);
  w.u8(hasAnchor ? p.height : 0);
  const water = t.water?.some((e) => e > 0) ? t.water : undefined;
  w.u8((hasAnchor ? (p.rotation ?? 0) / 90 : 0) | (water ? WATER_FLAG : 0) | (others.length > 0 ? LANDMARKS_FLAG : 0));
  w.u8(0);
  w.u8(grid.columns);
  w.u8(grid.rows);
  w.i16(grid.origin.x);
  w.i16(grid.origin.y);
  w.str8(clampName(t.name.en));
  if (others.length > 0) {
    w.u8(others.length);
    for (const l of others) {
      w.u8(LANDMARKS.findIndex((spec) => spec.id === l.id));
      w.u16(l.x * 2);
      w.u16(l.y * 2);
      w.u8(l.width);
      w.u8(l.height);
      w.u8((l.rotation ?? 0) / 90);
      w.u8(0);
    }
  }

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

/** Rebuilds and validates the planet, its id recomputed from content; a malformed record throws `ImportError('corrupt')`. */
export function decodeTemplateRecord(bytes: Uint8Array): MapTemplate {
  let t: MapTemplate;
  try {
    t = readRecord(bytes);
  } catch (e) {
    throw new ImportError('corrupt', `Malformed planet record: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isTrustedPlanet(t)) throw new ImportError('corrupt', 'Invalid planet record.');
  return t;
}

function readRecord(bytes: Uint8Array): MapTemplate {
  const r = new ByteReader(bytes);
  const width = r.u16(), height = r.u16();
  if (width < 1 || height < 1 || width > PLANET_MAX_CELLS || height > PLANET_MAX_CELLS) throw new Error('size out of range');
  const px = r.u16() / 2, py = r.u16() / 2;
  const pw = r.u8(), ph = r.u8(), turn = r.u8();
  r.u8(); // the anchor's layer byte
  const columns = r.u8(), rows = r.u8();
  const ox = r.i16(), oy = r.i16();
  const name = r.str8();
  if (turn & ~(3 | WATER_FLAG | LANDMARKS_FLAG)) throw new Error('anchor rotation out of range');
  const rot = turn & 3;
  const others: LandmarkConfig[] = [];
  if (turn & LANDMARKS_FLAG) {
    const count = r.u8();
    for (let i = 0; i < count; i++) {
      const spec = LANDMARKS[r.u8()];
      if (!spec || spec.anchor) throw new Error('landmark out of range');
      const x = r.u16() / 2, y = r.u16() / 2, lw = r.u8(), lh = r.u8(), quarter = r.u8();
      r.u8(); // the landmark's layer byte
      if (quarter > 3) throw new Error('landmark rotation out of range');
      others.push({ id: spec.id, x, y, width: lw, height: lh, ...(quarter ? { rotation: (quarter * 90) as Rotation } : {}) });
    }
  }

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

  const landmarks: LandmarkConfig[] = pw > 0 && ph > 0 && ANCHOR_LANDMARK
    ? [{ id: ANCHOR_LANDMARK.id, x: px, y: py, width: pw, height: ph, ...(rot ? { rotation: (rot * 90) as Rotation } : {}) }, ...others]
    : others;
  const loadable = water && loadableWater({ width, zones, water });
  const body = {
    width, height, zones, landmarks, chunkGrid: { origin: { x: ox, y: oy }, columns, rows }, ...(terrain ? { terrain } : {}),
    ...(loadable ? { water: loadable } : {})
  };
  return { id: planetTemplateId(body), name: { en: clampName(name) }, ...body };
}
