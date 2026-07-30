// generation/types.ts
import type { MacroCoord } from '../../core/model/types';
export type { MacroCoord, MapTemplate } from '../../core/model/types';

/** Config for the 'random' algorithm. */
export interface GenConfig {
  mode: 'earth' | 'water' | 'mixed';
  relief: number;       // 0..1 — height intensity / max tier scale
  naturalness: number;  // 0..1 — geometry style: 1 organic seams/winding rivers (current look), 0 axis-aligned rectilinear ("lego stacks")
  waterAmount: number;  // 0..1 — lake/sea coverage bias
  rivers: number;       // 0..1 — river network density
  flatness: number;     // 0..1 — target connected buildable-flat fraction
  settlement: number;   // 0..1 — building/road density (placement populator)
  nature: number;       // 0..1 — vegetation density
  seed: number;
  maxElevation: number; // hard cap (<= ELEVATION_MAX); derived from mode
  region: MacroCoord[] | null;
}

export interface ShapingParams {
  // Relief drives the elevation→tier mapping directly + monotonically:
  mtnThreshold: number;    // 0..1 — normalized height above which a cell becomes mountain (lower = more coverage)
  mtnCapTier: number;      // tallest land tier (0 in water mode); grows with relief
  waterCoverage: number;   // 0..1 fraction of the map flooded as ground-level sea/lakes (mode-driven)
  maxTier: number;         // resolved max elevation
  riverDensity: number;    // 0..1
  targetFlat: number;      // 0..1 target connected buildable-flat fraction
  naturalness: number;     // 0..1 geometry style (see GenConfig); consumed via geoStyle()
}

/** A continuous height field over the map, masked to grass. NaN = non-grass (never touched). */
export interface Field {
  width: number; height: number;
  grass: Uint8Array;        // 1 = buildable grass cell, 0 = not
}

/** The final, certified-valid terrain plan handed to commit. */
export interface TerrainPlan {
  width: number; height: number;
  tier: Int8Array;   // mountain elevation 1..maxTier, or 0 = ground (no terrain)
  water: Int8Array;  // water elevation, or -1 = none (mutually exclusive with tier>0)
}

// ── zone-graph generator (the designed-island pipeline; see docs/ARCHITECTURE.md, Generation System) ──

export type ZoneTheme =
  | 'town' | 'waterfront' | 'peak' | 'garden' | 'orchard' | 'farm' | 'hamlet' | 'park' | 'lake';

export interface Zone {
  id: number;
  cells: number[];        // flat indices (y*width+x)
  centroid: MacroCoord;
  level: number;          // terrace level 0..levelCap
  theme: ZoneTheme;
  bordersMap: boolean;    // touches the map border (waterfront candidate)
  riverside: boolean;     // the river touches this zone (set by zone-water)
  crown?: boolean;        // a nested terrace of a climbed massif (scenic; skipped by crossing planning)
}

export interface PlannedCrossing {
  kind: 'ramp' | 'bridge' | 'gorge-bridge';
  a: number; b: number;   // zone ids it joins
  at: MacroCoord;         // seam anchor for realization
  deckLevel: number;      // bridge: ends level; ramp: the UPPER level
}

export interface ZonePlan {
  width: number; height: number;
  zoneOf: Int16Array;     // cell -> zone id, -1 = non-grass
  zones: Zone[];
  adjacency: Map<number, Set<number>>;
  river: { x: number; y: number; level: number; fall: boolean }[];
  crossings: PlannedCrossing[];
  town: MacroCoord;
  levelCap: number;
}
