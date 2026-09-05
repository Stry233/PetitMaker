/*
 * fields.ts — the map becomes typed arrays a pack can draw from.
 *
 * This is the bake every procedural pack shares, and it is the reason the procedural path can draw
 * pictures the image path cannot: a model restyling a screenshot has pixels, while a pack has the
 * species of every plant, the footprint and rotation of every building, which strip is a bridge
 * rather than a path, and the exact silhouette of solid ground at each elevation. Everything here
 * is a pure function of GridState, so it is testable without a canvas and identical on every run.
 */
import { TerrainType, CellZone } from '../../../core/model/types';
import type { GridState, PlacedObject, CatalogItem } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { getCatalogItem } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { distanceField, signedDistanceField } from './geom';
import { hexToRgb, oklabToRgb, rgbToHex, rgbToOklab } from './oklab';

/** One placed object, resolved against its catalog entry and reduced to what a pack draws. */
export interface ProcObject {
  catalogId: string;
  /** Footprint origin in cells (top-left), and the size after rotation. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  elevation: number;
  category: string;
  item: CatalogItem | undefined;
  /** The authored colour this object shows from above, read off its own model parts: the highest
   *  large part's colour (a roof, a crown), which is what a top-down mark should wear. Falls back
   *  to the item's surface colour (paths) and then to a neutral, so it always holds a value. */
  topColor: string;
  /** The second large colour under the top one (walls under a roof, the darker crown layer). */
  midColor: string;
}

export interface ProcFields {
  width: number;
  height: number;
  /** Per-cell zone id from the template. */
  zone: Uint8Array;
  /** Per-cell terrain type and elevation, 0 where the cell carries no terrain. */
  terrain: Uint8Array;
  elevation: Uint8Array;
  /** 1 where the cell reads as water: a water tile, or template ocean. */
  water: Uint8Array;
  /** 1 where the cell is not water. The island, including its beach ring. */
  land: Uint8Array;
  /** 1 on the template's beach ring. Identical on every map of a template, so a pack should
   *  usually ABSORB it as a mount or margin rather than draw it as a feature of this island. */
  beach: Uint8Array;
  /** 1 under a path, bridge or ramp footprint. */
  road: Uint8Array;
  /** The distinct path surface colours on this map, and per cell the index into them (-1 off
   *  road). A pack that lays each material its own course reads these two together. */
  roadMaterials: string[];
  /** One catalog id per material (the first road item seen with that colour), for packs that key
   *  texture off the material's identity rather than its colour. */
  roadMaterialIds: string[];
  roadMaterial: Int16Array;
  /** 1 under a building or facility footprint. */
  building: Uint8Array;
  /** 1 under a tree or flora footprint. */
  plant: Uint8Array;
  /** Signed distance in cells to land, to water and to the road network. */
  landSdf: Float32Array;
  waterSdf: Float32Array;
  roadSdf: Float32Array;
  /** Highest elevation present. 0 means the map is flat, which is the common case. */
  maxElevation: number;
  objects: ProcObject[];
  plants: ProcObject[];
  buildings: ProcObject[];
  /** Stable across runs and machines: the seed every mark in a pack descends from. */
  seed: number;
  /** An item's display name in the bake's locale, English where the locale has none, the id where
   *  nothing is authored. What a pack that letters a schedule prints. */
  labelOf: (catalogId: string) => string;
}

const CAT_ROAD = new Set(['road', 'bridge', 'ramp']);
const CAT_BUILDING = new Set(['building', 'facility']);
const CAT_PLANT = new Set(['tree', 'flora']);

/** Highest-first among parts whose footprint is at least 35% of the largest: a chimney or a finial
 *  never speaks for a roof, and a stem never speaks for a crown. */
function topColors(item: CatalogItem | undefined, obj: PlacedObject): [string, string] {
  const parts = item?.model3d?.parts;
  const fallback = obj.color ?? item?.color ?? '#7a9a5a';
  if (!parts || parts.length === 0) return [fallback, fallback];
  let maxArea = 0;
  for (const p of parts) maxArea = Math.max(maxArea, Math.abs(p.size[0]! * p.size[2]!));
  const big = parts
    .filter((p) => Math.abs(p.size[0]! * p.size[2]!) >= maxArea * 0.35)
    .sort((a, b) => (b.pos[1]! + b.size[1]!) - (a.pos[1]! + a.size[1]!));
  const top = big[0]?.color ?? fallback;
  return [top, big[1]?.color ?? top];
}

function resolve(obj: PlacedObject): ProcObject {
  const item = getCatalogItem(obj.catalogId);
  const rect = objectRect(obj, item);
  const [topColor, midColor] = topColors(item, obj);
  return {
    catalogId: obj.catalogId,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    rotation: obj.rotation,
    elevation: obj.elevation,
    category: item?.category ?? 'facility',
    item,
    topColor,
    midColor,
  };
}

function stamp(mask: Uint8Array, w: number, h: number, o: ProcObject): void {
  const x0 = Math.max(0, Math.floor(o.x));
  const y0 = Math.max(0, Math.floor(o.y));
  const x1 = Math.min(w, Math.ceil(o.x + o.w));
  const y1 = Math.min(h, Math.ceil(o.y + o.h));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
}

/** Bake a map into the arrays every pack reads. Pure, and linear in cells plus objects. */
export function buildProcFields(state: GridState, seed: number, locale = 'en'): ProcFields {
  const width = state.template.width;
  const height = state.template.height;
  const n = width * height;
  const zone = new Uint8Array(n);
  const terrain = new Uint8Array(n);
  const elevation = new Uint8Array(n);
  const water = new Uint8Array(n);
  const land = new Uint8Array(n);
  const beach = new Uint8Array(n);
  let maxElevation = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const cell = getCell(state.cells, x, y);
      const z = cell?.zone ?? CellZone.Grass;
      zone[i] = z;
      const t = cell?.terrain ?? null;
      const type = t?.type ?? TerrainType.None;
      terrain[i] = type;
      // Zone Void is the template's ocean; a Water tile is a pond or lake cut into the island.
      const isWater = type === TerrainType.Water || z === CellZone.Void;
      water[i] = isWater ? 1 : 0;
      land[i] = isWater ? 0 : 1;
      beach[i] = !isWater && z === CellZone.Beach ? 1 : 0;
      const e = type === TerrainType.Mountain ? (t?.elevation ?? 0) : 0;
      elevation[i] = e;
      if (e > maxElevation) maxElevation = e;
    }
  }

  const road = new Uint8Array(n);
  const roadMaterial = new Int16Array(n).fill(-1);
  const roadMaterials: string[] = [];
  const roadMaterialIds: string[] = [];
  const materialIndex = new Map<string, number>();
  const building = new Uint8Array(n);
  const plant = new Uint8Array(n);
  const objects: ProcObject[] = [];
  const plants: ProcObject[] = [];
  const buildings: ProcObject[] = [];
  for (const raw of state.objects.values()) {
    const o = resolve(raw);
    objects.push(o);
    if (CAT_ROAD.has(o.category)) {
      stamp(road, width, height, o);
      const colour = o.item?.color ?? o.topColor;
      let index = materialIndex.get(colour);
      if (index === undefined) {
        index = roadMaterials.length;
        roadMaterials.push(colour);
        roadMaterialIds.push(o.catalogId);
        materialIndex.set(colour, index);
      }
      const x0 = Math.max(0, Math.floor(o.x));
      const y0 = Math.max(0, Math.floor(o.y));
      const x1 = Math.min(width, Math.ceil(o.x + o.w));
      const y1 = Math.min(height, Math.ceil(o.y + o.h));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) roadMaterial[y * width + x] = index;
    }
    else if (CAT_BUILDING.has(o.category)) {
      stamp(building, width, height, o);
      buildings.push(o);
    } else if (CAT_PLANT.has(o.category)) {
      stamp(plant, width, height, o);
      plants.push(o);
    }
  }

  return {
    width, height, zone, terrain, elevation, water, land, beach, road, roadMaterials, roadMaterialIds, roadMaterial, building, plant,
    landSdf: signedDistanceField(land, width, height),
    waterSdf: signedDistanceField(water, width, height),
    roadSdf: signedDistanceField(road, width, height),
    maxElevation, objects, plants, buildings, seed,
    labelOf: (catalogId: string): string => {
      const name = getCatalogItem(catalogId)?.name;
      if (!name) return catalogId;
      return (name as Record<string, string | undefined>)[locale] ?? name.en ?? catalogId;
    },
  };
}

/** The solid mask at one elevation tier: every cell standing at or above `tier`. Tier 0 is the
 *  island itself. On a flat map only tier 0 is non-empty, which is what makes an elevation-driven
 *  pack draw nothing there. */
export function elevationMask(f: ProcFields, tier: number): Uint8Array {
  const m = new Uint8Array(f.width * f.height);
  if (tier <= 0) return Uint8Array.from(f.land);
  for (let i = 0; i < m.length; i++) m[i] = f.elevation[i]! >= tier ? 1 : 0;
  return m;
}

/** A planting drift: one 8-connected run of the same genus.
 *
 *  Grouped by GENUS rather than by catalog id, because cultivars of one flower are one bed to a
 *  reader and separate ids to the catalog. Beds are a bonus and never the backbone: on a dense map
 *  most planting is single stamps in rows, and the rows are the plan. */
export interface PlantDrift {
  /** Position in the drift list, stable for a given map: a seed ingredient, never an identity. */
  id: number;
  genus: string;
  mask: Uint8Array;
  cells: number;
  centroidX: number;
  centroidY: number;
}

export const genusOf = (catalogId: string): string => catalogId.split('-').slice(0, 2).join('-');

export function plantDrifts(f: ProcFields, minCells = 4): PlantDrift[] {
  const { width: w, height: h } = f;
  const owner = new Int32Array(w * h).fill(-1);
  const genera: string[] = [];
  for (const o of f.plants) {
    const g = genusOf(o.catalogId);
    let gi = genera.indexOf(g);
    if (gi < 0) {
      gi = genera.length;
      genera.push(g);
    }
    const x0 = Math.max(0, Math.floor(o.x));
    const y0 = Math.max(0, Math.floor(o.y));
    const x1 = Math.min(w, Math.ceil(o.x + o.w));
    const y1 = Math.min(h, Math.ceil(o.y + o.h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) owner[y * w + x] = gi;
  }
  const seen = new Uint8Array(w * h);
  const out: PlantDrift[] = [];
  const stack: number[] = [];
  for (let start = 0; start < owner.length; start++) {
    if (owner[start]! < 0 || seen[start] === 1) continue;
    const g = owner[start]!;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const cells: number[] = [];
    while (stack.length > 0) {
      const p = stack.pop()!;
      cells.push(p);
      const px = p % w;
      const py = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (seen[q] === 0 && owner[q] === g) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (cells.length < minCells) continue;
    const mask = new Uint8Array(w * h);
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      mask[c] = 1;
      sx += c % w;
      sy += (c / w) | 0;
    }
    out.push({
      id: out.length, genus: genera[g]!, mask, cells: cells.length,
      centroidX: sx / cells.length, centroidY: sy / cells.length,
    });
  }
  return out.sort((a, b) => b.cells - a.cells);
}

/** Planting density, smoothed over about a cell and a half. Drives anything that wants "how much
 *  planting is here" rather than "is there a plant in this cell". */
export function plantingDensity(f: ProcFields): Float32Array {
  const d = distanceField(f.plant, f.width, f.height);
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = Math.exp(-(d[i]! * d[i]!) / 4.5);
  return out;
}

/** A genus's own colour: the mean of its members' authored top colours, in OKLab. A hash of the
 *  genus name would be arbitrary, and arbitrary colour is the fastest way to look generated. */
const genusColorCache = new WeakMap<ProcFields, Map<string, string>>();
export function genusColor(fields: ProcFields, genus: string): string {
  let cache = genusColorCache.get(fields);
  if (!cache) {
    cache = new Map();
    genusColorCache.set(fields, cache);
  }
  const hit = cache.get(genus);
  if (hit) return hit;
  let L = 0;
  let a = 0;
  let b = 0;
  let count = 0;
  for (const o of fields.plants) {
    if (genusOf(o.catalogId) !== genus) continue;
    const lab = rgbToOklab(hexToRgb(o.topColor));
    L += lab[0];
    a += lab[1];
    b += lab[2];
    count += 1;
  }
  const hex = count === 0 ? '#6f8a4e' : rgbToHex(oklabToRgb([L / count, a / count, b / count]));
  cache.set(genus, hex);
  return hex;
}
