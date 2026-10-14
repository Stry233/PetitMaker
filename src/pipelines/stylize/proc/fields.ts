/*
 * The map becomes typed arrays a pack can draw from.
 *
 * This is the bake every procedural pack shares, and it is the reason the procedural path can draw
 * pictures the image path cannot: a model restyling a screenshot has pixels, while a pack has the
 * species of every plant, the footprint and rotation of every building, which strip is a bridge
 * rather than a path, and the exact silhouette of solid ground at each elevation. Everything here
 * is a pure function of GridState, so it is testable without a canvas and identical on every run.
 */
import { TerrainType } from '../../../core/model/types';
import { CellZone, isOpenSeaZone, isSandZone } from '../../../core/game/zones';
import type { GridState, PlacedObject, CatalogItem } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { getCatalogItem, itemRole } from '../../../state/catalog';
import { isCoatingItem, isCrossing, isPlantRole, isStructureRole, type CategoryRole } from '../../../core/model/traits';
import { CATALOG_MODELS } from '../../../config/catalog/models';
import { objectRect } from '../../../state/object-geometry';
import { signedDistanceField } from '../../../core/base/fields';

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
  /** The role the item's category plays, undefined for a surface, a crossing or an unknown item. */
  role: CategoryRole | undefined;
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
  /** 1 where the cell is not water. The planet, including its beach ring. */
  land: Uint8Array;
  /** 1 on the template's beach ring. Identical on every map of a template, so a pack should
   *  usually absorb it as a mount or margin rather than draw it as a feature of this planet. */
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


/** Highest-first among parts whose footprint is at least 35% of the largest: a chimney or a finial
 *  never speaks for a roof, and a stem never speaks for a crown. */
function topColors(item: CatalogItem | undefined, obj: PlacedObject): [string, string] {
  const parts = CATALOG_MODELS[obj.catalogId]?.model3d?.parts;
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
    role: itemRole(item),
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
      // Open sea is the template's ocean; a Water tile is a pond or lake cut into the planet.
      const isWater = type === TerrainType.Water || isOpenSeaZone(z);
      water[i] = isWater ? 1 : 0;
      land[i] = isWater ? 0 : 1;
      beach[i] = !isWater && isSandZone(z) ? 1 : 0;
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
    // A surface or a crossing draws as a road strip; an unknown item draws as a structure.
    if (isCoatingItem(o.item) || isCrossing(o.item)) {
      stamp(road, width, height, o);
      const color = o.item?.color ?? o.topColor;
      let index = materialIndex.get(color);
      if (index === undefined) {
        index = roadMaterials.length;
        roadMaterials.push(color);
        roadMaterialIds.push(o.catalogId);
        materialIndex.set(color, index);
      }
      const x0 = Math.max(0, Math.floor(o.x));
      const y0 = Math.max(0, Math.floor(o.y));
      const x1 = Math.min(width, Math.ceil(o.x + o.w));
      const y1 = Math.min(height, Math.ceil(o.y + o.h));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) roadMaterial[y * width + x] = index;
    }
    // The procedural packs draw every standing structure as building mass, facilities and unknown
    // items included, which is wider than the prompt's 'building' (`scene/element.ts`).
    else if (!o.item || isStructureRole(o.role)) {
      stamp(building, width, height, o);
      buildings.push(o);
    } else if (isPlantRole(o.role)) {
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
