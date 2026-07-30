/**
 * Declarative low-poly model for one catalog item: a list of coloured primitive
 * PARTS that compose a recognizable shape. A shared builder (build-model.ts)
 * instantiates + merges them with baked vertex colours. Agents author these from
 * each item's icon (top or side view) + its name.
 *
 * AUTHORING SPACE (important):
 *  - The model is authored in the item's OWN FOOTPRINT, centred on the origin:
 *    x ∈ [-width/2, +width/2], z ∈ [-height/2, +height/2] (width/height = the
 *    catalog footprint in cells). It is NOT scaled to fit afterwards, so parts
 *    should fill that footprint sensibly.
 *  - Y is UP, in cell units, starting at 0 (ground). Typical heights: flora ~0.3,
 *    a cabin ~1.2–1.8, a tree ~1.5–2.2. The whole model is auto-dropped so its
 *    lowest point rests on the ground.
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
  | 'wedge';     // a ramp/slope rising toward +Z

export interface ModelPart {
  shape: PrimitiveShape;
  /** Full extent along x, y (height), z, in cell units. */
  size: [number, number, number];
  /** Bottom-centre of the part: x,z = centre, y = base height (parts stack by base). */
  pos: [number, number, number];
  /** sRGB hex colour, e.g. '#c98a5a'. */
  color: string;
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
}

export interface ModelSpec { parts: ModelPart[]; }
