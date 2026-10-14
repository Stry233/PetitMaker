/**
 * Config-driven low-poly archetypes. Each ArchetypeKey (a category, drawn as the stand-in shape its
 * catalog category entry names, or the platform) → one cached, unit-sized
 * BufferGeometry whose base sits at y=0 and whose footprint fits inside a 1×1
 * cell (centred on origin in X/Z). Instances later scale/rotate/translate it.
 *
 * All proportions live in ARCHETYPE_TUNING — the single source of truth that
 * keeps every rendered object consistent. Adding/retuning a shape is one edit
 * here, never scattered magic numbers.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER_HEIGHT, PLATFORM_UNIT_H } from '../geometry/coords';
import type { ArchetypeKey } from '../geometry/types';
import { CATEGORIES, CATEGORY_BY_ID, type StandInShape } from '../../../config/catalog/categories';
import { isCoating } from '../../../core/model/traits';
import { markPersistentGround } from '../draw/proximity-fade';

/** X/Z use cells; object heights use terrain levels, except surface slabs. */
const ARCHETYPE_TUNING = {
  tree:     { trunkR: 0.07, trunkH: 0.176, foliageR: 0.34, foliageH: 0.56 },
  bush:     { r: 0.18, h: 0.176 },
  house:    { w: 0.74, d: 0.74, wallH: 0.4, roofH: 0.272 },
  kiosk:    { r: 0.3, h: 0.4, capH: 0.096 },
  deck:     { deckH: 0.08, deckW: 0.7, postR: 0.06, postH: 0.24 },
  slab:     { h: 0.05, w: 1.0 },   // full cell so adjacent surface tiles read continuous
  platform: { h: PLATFORM_UNIT_H, w: 1.0 }, // full footprint: a landmark floor must fill its exact 2D rect,
                                   // not a per-cell margin scaled up into a ~1-micro-block inset per side
} as const;

export const ARCHETYPE_KEYS: ArchetypeKey[] = [...CATEGORIES.map((c) => c.id), 'platform'];

/** Translate a primitive (built centred at origin) so its base sits at y=0. */
function onGround(g: THREE.BufferGeometry, height: number): THREE.BufferGeometry {
  g.translate(0, height / 2, 0);
  return g;
}

function buildTree(): THREE.BufferGeometry {
  const t = ARCHETYPE_TUNING.tree;
  const trunk = onGround(new THREE.CylinderGeometry(t.trunkR, t.trunkR, t.trunkH, 6), t.trunkH);
  const foliage = new THREE.ConeGeometry(t.foliageR, t.foliageH, 7);
  foliage.translate(0, t.trunkH + t.foliageH / 2, 0);
  return mergeGeometries([trunk, foliage])!;
}

function buildBush(): THREE.BufferGeometry {
  const f = ARCHETYPE_TUNING.bush;
  return onGround(new THREE.IcosahedronGeometry(f.r, 0), f.r * 2).scale(1, f.h / (f.r * 2), 1);
}

function buildHouse(): THREE.BufferGeometry {
  const b = ARCHETYPE_TUNING.house;
  const walls = onGround(new THREE.BoxGeometry(b.w, b.wallH, b.d), b.wallH);
  // 4-sided pyramid roof via a low cone, rotated so a flat face fronts the box.
  const roof = new THREE.ConeGeometry(b.w * 0.78, b.roofH, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, b.wallH + b.roofH / 2, 0);
  return mergeGeometries([walls, roof])!;
}

function buildKiosk(): THREE.BufferGeometry {
  const f = ARCHETYPE_TUNING.kiosk;
  const body = onGround(new THREE.CylinderGeometry(f.r, f.r, f.h, 8), f.h);
  const cap = new THREE.ConeGeometry(f.r * 1.1, f.capH, 8);
  cap.translate(0, f.h + f.capH / 2, 0);
  return mergeGeometries([body, cap])!;
}

function buildDeck(): THREE.BufferGeometry {
  const b = ARCHETYPE_TUNING.deck;
  const deck = new THREE.BoxGeometry(1, b.deckH, b.deckW);
  deck.translate(0, b.postH, 0);
  const parts: THREE.BufferGeometry[] = [deck];
  for (const sx of [-0.42, 0.42]) for (const sz of [-b.deckW / 2 + 0.06, b.deckW / 2 - 0.06]) {
    const p = onGround(new THREE.CylinderGeometry(b.postR, b.postR, b.postH, 5), b.postH);
    p.translate(sx, 0, sz);
    parts.push(p);
  }
  return mergeGeometries(parts)!;
}

function buildWedge(): THREE.BufferGeometry {
  // Unit wedge: footprint X,Z ∈ [-0.5, 0.5], height Y ∈ [0, 1]; the slope rises
  // toward +Z (low edge at -Z / y=0 → high edge at +Z / y=1). object-meshes scales
  // it to the real footprint + height-drop and rotates it so the high end faces the
  // correct side (mirroring the 2D high/low convention). DoubleSide covers winding.
  const P = [
    -0.5, 0, -0.5,   0.5, 0, -0.5,   // 0 A,  1 A2  (low, back)
    -0.5, 0,  0.5,   0.5, 0,  0.5,   // 2 B,  3 B2  (low, front — right-angle base)
    -0.5, 1,  0.5,   0.5, 1,  0.5,   // 4 C,  5 C2  (high, front — top edge)
  ];
  const I = [
    0, 1, 5, 0, 5, 4,   // sloped top (A,A2 → C2,C)
    0, 2, 3, 0, 3, 1,   // bottom
    2, 4, 5, 2, 5, 3,   // front wall (z = +0.5)
    0, 2, 4,            // left triangle  (x = -0.5)
    1, 5, 3,            // right triangle (x = +0.5)
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

function buildFlat(h: number, w: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, w);
  g.translate(0, h / 2, 0);
  return g;
}

const SHAPES: Record<StandInShape, () => THREE.BufferGeometry> = {
  tree: buildTree,
  bush: buildBush,
  house: buildHouse,
  kiosk: buildKiosk,
  deck: buildDeck,
  wedge: buildWedge,
  slab: () => buildFlat(ARCHETYPE_TUNING.slab.h, ARCHETYPE_TUNING.slab.w),
};

/** Shapes whose unit height is one terrain level; a wedge's instance supplies its height and a
 *  slab is a surface decal. */
const LEVEL_SCALED: ReadonlySet<StandInShape> = new Set<StandInShape>(['tree', 'bush', 'house', 'kiosk', 'deck']);

// Archetype geometries are immutable and shared by every InstancedMesh of every scene; the last
// scene's lease (`cache-lease.ts`) frees them.
const cache = new Map<ArchetypeKey, THREE.BufferGeometry>();

/** Archetypes drawn as flat ground surfaces: the coating categories' and the platform (a
 *  self-described footprint such as a landmark floor). They take the proximity fade's persistent-ground
 *  marker like any authored floor part, so the floor under a low camera stays whole. */
const GROUND_ARCHETYPES: ReadonlySet<ArchetypeKey> = new Set<ArchetypeKey>([
  ...CATEGORIES.filter((c) => c.items.some(isCoating)).map((c) => c.id), 'platform',
]);

/** The cached unit geometry for an archetype (built once on first use). */
export function archetypeGeometry(key: ArchetypeKey): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    // The platform is a surface decal sized by its own footprint.
    const shape = key === 'platform' ? null : CATEGORY_BY_ID.get(key)!.archetype;
    g = shape ? SHAPES[shape]() : buildFlat(ARCHETYPE_TUNING.platform.h, ARCHETYPE_TUNING.platform.w);
    if (shape && LEVEL_SCALED.has(shape)) g.scale(1, LAYER_HEIGHT, 1);
    if (GROUND_ARCHETYPES.has(key)) markPersistentGround(g);
    cache.set(key, g);
  }
  return g;
}

/** Dispose all cached geometries; scenes release them through `cache-lease.ts`. */
export function disposeArchetypes(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
