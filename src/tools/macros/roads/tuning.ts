/**
 * The road router's knobs, in cells and A* cost units. Every router file beside this one reads them
 * from here. Game regulations (the gate strip, crossing clearance) are the profile's, not knobs.
 */
export const TUNING = {
  /** A* step cost over flat ground. */
  roadCost: 1,
  /** A* step cost over an existing road (merge into streets), also the heuristic weight. */
  roadReuseCost: 0.25,
  /** A* cost per direction change at naturalness 0 (long straight runs). */
  styleTurnPenaltyMax: 2.5,
  /** A* expansion guard floor; the live cap scales up to the cell count. */
  networkMaxNodesFloor: 4000,
  /** Rings searched outward from a building for a routable door. */
  doorSearchRadius: 4,
  /** Cells probed across a gap or cliff for the far region (past the eroded shore). */
  portalScanReach: 5,
  /** Candidate portals kept per region pair. */
  maxPortalsPerPair: 2,
  /** Least Manhattan gap between portals of the same region pair. */
  portalMinSeparation: 10,
  /** Region-graph edge cost for crossing by a bridge. */
  portalBridgeCost: 6,
  /** Region-graph edge cost for crossing by a ramp. */
  portalRampCost: 4,
  /** Farthest distance between nodes a loop road joins (circuits, not spokes). */
  loopMaxDist: 30,
  /** No two bends of an aimed road within this many cells, and no run shorter except at the ends. */
  minRun: 3,
  /** How far a crossing's approach runs onto each bank. */
  approachDepth: 2,
  /** Two route offers are one offer when their cell sets differ by less than this Jaccard distance. */
  offerSame: 0.12,
} as const;
