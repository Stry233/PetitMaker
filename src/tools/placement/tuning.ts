// Single home for every tunable knob this module reads. Readers read TUNING.*; they never hardcode
// numbers. Its readers are the files beside it — the road router, the layered ecology, the themed
// room decorators — plus `macros/road-paving.ts`, which grows a lane out of the streets those built.
// (The island generator's own numbers live with the stage that means them: its plates, streets and
// dressing are calibrated against the reference maps rather than dialled here.)
export const TUNING = {
  // --- the road router (network.ts / route.ts / portals.ts) ---------------------------------------
  roadCost: 1,                // A* step cost over flat ground
  roadReuseCost: 0.25,        // A* step cost over an existing road (merge into streets) + heuristic weight
  styleTurnPenaltyMax: 2.5,   // A* cost per direction change at naturalness 0 (long straight runs)
  networkMaxNodesFloor: 4000, // A* expansion guard floor; the live cap scales up to the cell count (W*H)
  doorSearchRadius: 4,        // rings searched outward from a building for a routable door
  portalScanReach: 5,         // cells probed across a gap/cliff for the far region (past the eroded shore)
  maxPortalsPerPair: 2,       // candidate portals kept per region-pair
  portalMinSeparation: 10,    // min Manhattan gap between portals of the same region-pair
  portalBridgeCost: 6,        // region-graph edge cost for crossing via a bridge
  portalRampCost: 4,          // region-graph edge cost for crossing via a ramp
  scenicCrossingBudget: 4,    // extra bridges/ramps paved beyond the spanning tree (traversable terrain)
  loopMaxDist: 30,            // max distance (cells) between nodes joined by a loop road (circuits, not spokes)
  roadsideChance: 0.22,       // probability a road cell plants a roadside flora/tree beside it
  roadsideTreeChance: 0.25,   // of roadside plants, fraction that are trees

  // --- the layered ecology (nature.ts), all seeded and deterministic ------------------------------
  standNoiseScale: 0.055,     // forest-stand frequency (low → large contiguous stands, not map-wide speckle)
  standThreshold: 0.5,        // stand-noise above this = forest stand
  canopyNoiseScale: 0.17,     // within-stand clearing frequency
  clearingThreshold: 0.3,     // canopy-noise below this = glade (no trees) — carves clearings inside stands
  standEdgeSoft: 3,           // cells over which tree density ramps from a stand edge (sparse) to its core (dense)
  treeDensity: 0.95,          // tree fill at a stand core at nature=1 (exclusionRadius caps realized density)
  treeSpeciesScale: 0.03,     // species-selection noise frequency (a stand reads as mostly one species)
  highlandTier: 3,            // elevTier >= this → highland conifers (fir/ginkgo) regardless of moisture
  moistureNoiseScale: 0.045,  // humidity field frequency (blended with distance-to-water)
  floraEcotoneReach: 3,       // cells from a forest within which ecotone (forest-edge) flora concentrates
  floraEcotone: 0.4,          // flora density at the forest edge at nature=1
  floraWater: 0.35,           // flora density at the waterline at nature=1
  floraMeadow: 0.10,          // wildflower density INSIDE a meadow drift at nature=1
  meadowDriftScale: 0.085,    // drift noise frequency (patches of wildflowers, not uniform confetti)
  meadowDriftThreshold: 0.63, // drift noise above this = a flower drift; elsewhere the meadow stays clear
  floraSpeciesScale: 0.05,    // flora species-patch frequency (nearby flora share a species)
  wildFalloffRadius: 8,       // cells over which nature thins toward the village (the clearing)
  waterFloraReach: 6,         // water/moisture influence radius (cells)

  // --- the themed room decorators (themes.ts) ----------------------------------------------------
  orchardCellsPerTree: 16,    // orchard target = room cells / this × (0.5 + nature)
  orchardStride: 2,           // cells between orchard trees (clears the exclusion radius)
  farmCellsPerCrop: 9,        // farm target = room cells / this × (0.5 + nature)
  hamletAnchorTries: 24,      // failed seats before the landmark cabin yields to stalls
  gardenRingInner: 4,         // garden ring: flora ring radius around the room centroid...
  gardenRingOuter: 6,         // ...between these two distances
  gardenRingMax: 8,           // ...capped at this many plants
  sceneFloraPairs: 3,         // mirrored flora pairs per bridge/ramp scene
} as const;
