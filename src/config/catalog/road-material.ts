/** Decoded artwork repeats in macro-cell coordinates; transparent pixels preserve lower coatings. */
export interface RoadImagePattern {
  kind: 'image';
  repeat: number;
  image: string;
}

/** Pigment variation is periodic and keeps the artwork's alpha unchanged. */
export interface RoadSurfaceGrain {
  grain: number;
  clouds: number;
}

/** Vector artwork in unit-square coordinates, shared by both map renderers. */
export interface RoadVectorPattern {
  kind: 'vector';
  repeat: number;
  background?: string;
  detail?: RoadSurfaceGrain;
  paths: {
    d: string; fill?: string; stroke?: string; width?: number; opacity?: number;
    /** Local highlight and rim shading, in repeat coordinates. */
    relief?: { bounds: [number, number, number, number]; depth: number };
  }[];
}

export interface RoadInlayPattern {
  kind: 'inlay';
  /** Square repeat length in macro cells; motif coordinates and radii are fractions of it. */
  repeat: number;
  background: string;
  color: string;
  rim: string;
  motifs: { x: number; y: number; radius: number; rotation: number; shape: 'star' | 'dash' | 'clover' | 'pebble'; color?: string; rim?: string }[];
}

/** Repeat length is in macro cells; paving dimensions are fractions of that square repeat. */
interface RoadPavingFinish {
  detail?: RoadSurfaceGrain;
  repeat: number;
  mortar: string;
  /** Mortar width as a fraction of the repeat. */
  joint: number;
}

export interface RoadMasonryPattern extends RoadPavingFinish {
  kind: 'masonry';
  /** Periodic polygon vertices in repeat coordinates; vertices may cross a repeat seam. */
  stones: { points: [number, number][]; color: string }[];
}

export interface RoadFanPattern extends RoadPavingFinish {
  kind: 'fans';
  /** A square repeat contains an even number of staggered rows. */
  rowSpacing: number;
  stagger: number;
  rings: { radius: number; segments: number; colors: string[] }[];
}

export type RoadMaterialPattern = 'aggregate' | 'slabs' | RoadInlayPattern | RoadMasonryPattern | RoadFanPattern | RoadVectorPattern | RoadImagePattern;

export interface RoadMaterialFinish {
  color: string;
  pattern?: RoadMaterialPattern;
}

/** Distances are macro cells, measured inward from the connected surface boundary. */
export interface RoadMaterialSpec {
  feather: number;
  edge: RoadMaterialFinish;
  /** Mortar cuts confined to the outer finish, measured in macro cells. */
  edgeJoints?: { spacing: number; width: number; color: string };
  /** Ordered from the outside inward. Narrow regions may lose their inner layers entirely. */
  layers: (RoadMaterialFinish & { inset: number })[];
}
