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

export type RoadMaterialPattern = 'aggregate' | 'slabs' | RoadInlayPattern | RoadMasonryPattern | RoadFanPattern;

export function roadPatternRepeat(pattern?: RoadMaterialPattern): number {
  return typeof pattern === 'object' ? pattern.repeat : 1;
}

const patternKeys = new WeakMap<object, string>();

/** Equal keys for equal patterns. Catalog patterns are immutable, so an object's key is computed once. */
export function roadPatternKey(pattern?: RoadMaterialPattern): string {
  if (typeof pattern !== 'object') return pattern ?? 'plain';
  let key = patternKeys.get(pattern);
  if (key === undefined) {
    key = JSON.stringify(pattern);
    patternKeys.set(pattern, key);
  }
  return key;
}

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
