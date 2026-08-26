/**
 * Shared data shapes for the 3D preview. These are plain data (no three.js) so
 * the geometry builders stay pure and unit-testable; scene.ts converts them into
 * three.js objects. Keeping the heavy dependency out of the build/* modules is
 * what lets us test the hard logic in jsdom without a GPU.
 */
import type { ItemCategory } from '../../../core/model/types';

/** A renderable mesh as flat arrays. positions/colors are xyz / rgb triples
 *  (colors in 0..1). `index` is the triangle index list. `alpha` (one value per
 *  vertex, 0..1) is present only on meshes that fade — the road decal's feather.
 *  `uv` (two per vertex) only on meshes that carry a texture — the road decal's
 *  tile art, where 1 unit is one macro cell so the map repeats per cell. */
export interface MeshData {
  positions: number[];
  colors: number[];
  index: number[];
  alpha?: number[];
  uv?: number[];
}

/** The terrain split by material / animation. */
export interface TerrainMeshes {
  /** Opaque mountain mass (vertex-coloured by elevation). */
  solid: MeshData;
  /** Opaque land slabs + their underground shoreline skirt (vertex-coloured by zone). */
  ground: MeshData;
  /** Translucent still water: surfaces, sea, short pond rims. */
  water: MeshData;
  /** Translucent VERTICAL water drops (pond cliffs + waterfalls); gets the
   *  downward-flowing cascade animation so the falling side reads clearly. */
  fall: MeshData;
}

/** Which low-poly proxy an object renders as: the 7 catalog categories plus a
 *  flat 'platform' for off-catalog footprints (the central plaza). */
export type ArchetypeKey = ItemCategory | 'platform';

/** One placed-object instance: a world transform + tint for an InstancedMesh.
 *  scale is applied to the unit-authored archetype geometry; rotationY orients it. */
export interface ObjectInstance {
  x: number; y: number; z: number;        // world position of the footprint centre / base
  rotationY: number;                       // radians
  scaleX: number; scaleY: number; scaleZ: number;
  color: [number, number, number];         // rgb 0..1 — the fallback (category) tint
  /** Icon basename for icon-sprite items; the scene refines `color` to this icon's
   *  dominant colour once it loads. Undefined for colour-bearing items (roads/plaza). */
  icon?: string;
}
