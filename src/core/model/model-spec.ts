/**
 * Declarative low-poly model for one catalog item: a list of coloured primitive
 * PARTS that compose a recognizable shape. A shared builder (build-model.ts)
 * instantiates + merges them with baked vertex colours. Agents author these from
 * each item's icon (top or side view) + its name.
 *
 * AUTHORING SPACE (important):
 *  - An uncalibrated model is authored in the item's OWN FOOTPRINT, centred on the origin:
 *    x ∈ [-width/2, +width/2], z ∈ [-height/2, +height/2] (width/height = the
 *    catalog footprint in cells). It is NOT scaled to fit afterwards, so parts
 *    should fill that footprint sensibly.
 *  - Y is UP, starting at 0 (ground). `heightInLayers` scales the complete model
 *    uniformly against terrain elevation height, preserving its authored proportions.
 *    `heightScale: 'vertical'` keeps authored X/Z dimensions, including unit spans.
 *    With `fitToFootprint`, X/Z fit catalog width/depth independently of that height.
 *    All calibrated objects share the terrain's vertical scale. The groundY plane
 *    (or lowest point when omitted) aligns with the supporting ground.
 *  - Parts STACK by base height: `pos` is a part's BOTTOM-centre (x,z = centre,
 *    y = the height its base sits at), so a roof at pos.y = wallHeight sits on the
 *    walls.
 */
export type PrimitiveShape =
  | 'box'        // rectangular block (walls, slabs, chimneys)
  | 'pyramid'    // 4-sided hip roof / pointed top
  | 'prism'      // triangular gable roof, ridge along local X (rotate with rotY)
  | 'cylinder'   // posts, trunks, barrels, towers
  | 'cone'       // pine foliage, spires, pointed tops
  | 'sphere'     // round foliage, blobs, domes (low-poly icosphere)
  | 'leaf'       // pointed blade with a raised central ridge, root at y=0 and tip at y=1
  | 'petal'      // rounded blade with the same root, tip and ridge convention as a leaf
  | 'wedge'      // a ramp/slope rising toward +Z
  | 'mesh';      // authored indexed surfaces with the same unit-space convention

export interface ModelPart {
  shape: PrimitiveShape;
  /** Full extent along x, y (height), z, in cell units. */
  size: [number, number, number];
  /** Bottom-centre of the part: x,z = centre, y = base height (parts stack by base). */
  pos: [number, number, number];
  /** sRGB hex colour, e.g. '#c98a5a'. */
  color: string;
  /** Surface decoration backed by a complete shell; omitted at lite quality. Never structural. */
  fullOnly?: boolean;
  /** Optional rotation about the Y axis, in degrees (e.g. gable ridge orientation). */
  rotY?: number;
  /** Optional tilt about X / Z, in degrees, applied BEFORE rotY (order: Z, X, Y).
   *  Use to splay or droop a part off vertical — e.g. agave sword leaves leaning
   *  out, a bamboo leaf-spray drooping, a palm frond. */
  rotX?: number;
  rotZ?: number;
  /** Radial segments for cylinder/cone (default 8 — keep it low-poly). */
  seg?: number;
  /** CYLINDER only: top-radius ratio (default 1 = straight). <1 makes a frustum —
   *  e.g. 0.6 for a trunk that flares wider at its base. */
  taper?: number;
  /** SPHERE only: icosphere subdivision (default 0 = 20 faces). 1 ≈ 80 faces — a
   *  rounder foliage clump / dome that still reads low-poly. Keep ≤1 for canopies. */
  detail?: number;
  /** MESH only: unit-space vertices and outward-wound triangle indices. */
  mesh?: {
    vertices: [number, number, number][];
    triangles: [number, number, number][];
  };
}

export interface ModelSpec {
  parts: ModelPart[];
  /** Authored ground-contact plane; omitted to rest the lowest vertex on the ground. */
  groundY?: number;
  /** Total silhouette height in terrain layers; omitted for cell- or span-authored geometry. */
  heightInLayers?: number;
  /** Height calibration scales Y only when vertical; uniform is the default. */
  heightScale?: 'uniform' | 'vertical';
  /** Fit X/Z to the catalog footprint; true stretches, contain preserves horizontal proportions.
   *  Insets reserve empty cells on each X/Z edge. Requires an independent heightInLayers calibration. */
  fitToFootprint?: boolean | {
    mode: 'contain';
    inset?: [number, number];
    /** X/Z alignment inside the insets: -1 negative edge, 0 centre (default), 1 positive edge. */
    align?: [-1 | 0 | 1, -1 | 0 | 1];
  };
}

/**
 * Parts standing on the deck of a platform object (one that carries its own footprint, such as the
 * template landmark). Authored at the unturned `footprint` in cells around its centre, with y = 0 at
 * the deck top and X/Z as the map's at rotation 0 (-Z is the map's top edge). A placed object turns
 * the parts with its rotation and scales them to its own unturned footprint.
 */
export interface DeckModelSpec extends ModelSpec {
  footprint: [number, number];
}
