// src/tools/generation/tuning.ts
// Single home for every tunable knob. Stages read TUNING.*; they never hardcode numbers.
import { ELEVATION_MAX } from '../../core/model/constants';

export const TUNING = {
  repairMaxPasses: 64,        // safety cap for the repair fixpoint loop
  siteTerraceBonus: 1.2,      // hamlet site score bonus on ELEVATED ground (hillside living, not edge sprawl)
  siteWaterViewBonus: 0.7,    // hamlet site score bonus near the waterline (waterfront homes)
  siteSpreadCap: 2.5,         // spread term saturates at (hamletSpacing x this)^2 — then the view bonuses decide
  // terrace (max-slope-1 staircasing → broad bases, V-MTN-03 + no-floating by construction)
  terraceMaxPasses: 16,
  // usability
  usabilityMaxPasses: 50,     // safety cap for the usability relaxation loop
  // placement — village core + distributed hamlet network (hub + hamlets + civic + POIs, road-connected)
  buildingSeparation: 1,           // min empty-cell gap between building footprints
  placementEdgeMargin: 6,          // hamlets sampled only ≥ this many cells from the map border (stay inland)
  slotAngleJitter: 0.6,            // disc-slot angular wobble (rad)
  civicRadiusFrac: 0.25,           // facilities placed within this fraction of the hub-region radius
  coreBuildingsBase: 2,            // village-core homes ringing the plaza at settlement≈0
  coreBuildingsPerSettlement: 4,   // + settlement × this (the town has a CENTRE, not just satellites)
  coreRingPad: 3,                  // core ring extends this far beyond the plaza footprint
  coreRadius: 9,                   // core ring radius when there is no plaza to ring
  hamletCountBase: 3,              // hamlet sites at settlement≈0
  hamletCountPerArea: 0.0007,      // + buildable-cell-count × this × settlement
  hamletCountMax: 8,               // cap on hamlets (unzoned-path sites AND zone-path hamlet rooms)
  hamletRoomShare: 0.375,          // fraction of themed rooms picked (spread, farthest-point) as hamlets
  hamletSpacing: 12,               // farthest-point min separation between hamlet sites (cells)
  hamletClusterMin: 3,             // homes per hamlet (min)
  hamletClusterMax: 5,             // homes per hamlet (max)
  hamletClusterRadius: 5,          // disc radius for a hamlet's home slots
  // farmland — each hamlet may anchor a crop field (rows of one flora) and an orchard (grid of one tree),
  // so the land reads as DEVELOPED (an island town), not just decorated.
  fieldChance: 0.75,               // probability a hamlet gets a crop field
  fieldW: 5,                       // field width (cells)
  fieldH: 4,                       // field height (cells); rows planted on alternate y → walkable gaps
  fieldTries: 6,                   // anchor spots tried around the hamlet
  orchardChance: 0.55,             // probability a hamlet gets an orchard
  orchardSize: 3,                  // orchard grid (size × size trees)
  orchardStride: 2,                // cells between orchard trees (clears the exclusion radius)
  poiLookoutMinTier: 1,            // lookout POI chosen from regions at/above this tier
  // decoration — gardens around hamlets, lined roads, richer POI scenes (all flora/trees are 1x1)
  poiClusterMax: 7,                // decorative items marking a POI
  poiRadius: 3,                    // disc radius for POI decoration
  poiTreeChance: 0.4,              // of POI plants, fraction that are trees (rest flora)
  gardenRadius: 4,                 // flora/tree garden ring radius around a hamlet
  gardenDensity: 0.45,             // fraction of a hamlet garden's disc slots that get a plant
  gardenTreeChance: 0.3,           // of garden plants, fraction that are trees (rest flora)
  roadsideChance: 0.22,            // probability a road cell plants a roadside flora/tree beside it
  roadsideTreeChance: 0.25,        // of roadside plants, fraction that are trees
  roadCost: 1,                // A* step cost over flat ground
  roadReuseCost: 0.25,        // A* step cost over an existing road (merge into streets) + heuristic weight
  networkMaxNodesFloor: 4000, // A* expansion guard floor; the live cap scales up to the cell count (W*H)
  doorSearchRadius: 4,        // rings searched outward from a building for a routable door
  // region-portal router — ford/ramp portals between adjacent regions + node-connecting graph
  portalScanReach: 5,         // cells probed across a gap/cliff for the far region (past the eroded shore)
  maxPortalsPerPair: 2,       // candidate portals kept per region-pair
  portalMinSeparation: 10,    // min Manhattan gap between portals of the same region-pair
  portalBridgeCost: 6,        // region-graph edge cost for crossing via a bridge
  portalRampCost: 4,          // region-graph edge cost for crossing via a ramp
  scenicCrossingBudget: 4,    // extra bridges/ramps paved beyond the spanning tree (traversable terrain)
  loopMaxDist: 30,            // max distance (cells) between hamlets joined by a loop road (circuits, not spokes)
  // nature — layered ecology (forest stands + biome bands + ecotone flora), all seeded/deterministic
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
  // zone-graph generator — the designed-island pipeline (see docs/ARCHITECTURE.md, Generation System)
  zoneAreaPerSite: 290,        // one zone site per ~this many buildable cells
  zoneCountMin: 6,
  zoneCountMax: 70,            // real maps (~20k cells) get a full set of rooms, not 14 giant ones
  zoneBorderWobble: 6,         // noise-warp strength on the voronoi distance (organic seams)
  zoneBorderNoiseScale: 0.08,  // wobble noise frequency
  zoneMinArea: 40,             // zones smaller than this are reabsorbed (sliver cleanup)
  zoneLevelCap: ELEVATION_MAX, // max terrace level = the real elevation ceiling (still clamped per-map by maxTier)
  // CROWNS = relief-scaled terraced MASSIFS: the largest raised zones are climbed level-by-level (each
  // nested terrace a `crownInset`-wide step) toward the relief-scaled target peak. This is how a map
  // reaches the real Max-Height with mass on top — the wedding cake the shallow zone graph can't climb
  // on its own — while keeping every adjacent-zone delta <= 1 (crossing planning needs it).
  crownNavInset: 4,            // WIDE terrace step (cells) for the navigable lower massif — >=4 so the ramp rule's 4-deep landing fits and each step earns a ramp (a climbable stepped park)
  crownNavMax: 2,              // how many WIDE navigable steps before switching to the steep spire — few, so the spire still reaches the cap
  crownInset: 2,               // STEEP scenic step (cells) for the upper spire — reaches the cap with a small footprint; crossings skip these (the tip is a view)
  crownMinPeak: 6,             // only climb massifs when the target peak exceeds the zone graph's natural depth (~4); gentler maps stay crown-free
  crownMassifs: 3,             // max massifs climbed at relief=1 (scaled by relief → 0 at relief 0 = plains); few, tall heroes
  crownMinArea: 6,             // stop climbing a massif when its remaining core drops below this
  reliefFloorAt1: 0.7,         // min fraction of land RAISED at relief=1 (scaled down toward 0) — bolder relief
  riverSegMax: 18,             // validated elevated-water units (falls/cascades) per map
  headwaterMax: 2,             // headwater pools (ponds ON the mountain, each seeding a descending course)
  // terrain-following river course (zone-water-course)
  coursePerHeadwater: 6,       // max fall units per course (a pool descends at most this many steps)
  courseRunMax: 3,             // fall width jitter: run length 1..this (perpendicular water cells)
  courseSearchRadius: 6,       // how far the course looks for the next terrace lip
  courseChannelMax: 16,        // max dogleg length of a terrace channel (pool/fall → next lip)
  courseConnectMax: 12,        // max dogleg length tying the course's foot into the ground water
  courseFeederGap: 8,          // min Manhattan gap between falls (no curtain-of-falls banks)
  channelWidthPad: 1,          // channel width = spanMin + pad (stays under spanMax, spannable)
  loopCrossingBase: 2,         // loop crossings beyond the spanning tree at settlement = 0
  loopCrossingPerSettlement: 3,// + settlement × this (dense towns earn redundant paths)
  gorgeBridgeMax: 2,           // same-height bridges probed across lower seams
  sceneFloraPairs: 3,          // mirrored flora pairs per bridge/ramp scene
  boringFlatMax: 14,           // QA probe: max side of an undecorated flat square (cells)
  townAnchorOffset: 11,        // town zone anchors this far from the plaza centre (beside it, not under it)
  townEdgeMarginFrac: 0.18,    // ...and at least this fraction of min(W,H) from the island border
  // naturalness → geometry style (the geoStyle() mapping in style.ts; 1 = organic, 0 = rectilinear lego)
  styleBlockMax: 6,            // rectilinear snap lattice at naturalness 0 (zone seams quantize to this grid)
  styleStepMax: 3,             // terrace cliff height at naturalness 0 — the V-MTN-03 3-layer window
  styleRectBelow: 0.5,         // below this, erosion/dilation switch to Chebyshev (square lake/crown corners)
  styleCutsBelow: 0.25,        // below this, generation applies NO edge cuts (cuts are the only true diagonals)
  styleTurnPenaltyMax: 2.5,    // road A* per-turn cost at naturalness 0 (long straight streets)
  // themed-room decoration (themes.ts) — the per-room density/geometry knobs
  orchardCellsPerTree: 16,     // orchard target = room cells / this × (0.5 + nature)
  farmCellsPerCrop: 9,         // farm target = room cells / this × (0.5 + nature)
  hamletAnchorTries: 24,       // failed seats before the landmark cabin yields to stalls
  gardenRingInner: 4,          // garden ring: flora ring radius around the hamlet centroid...
  gardenRingOuter: 6,          // ...between these two distances
  gardenRingMax: 8,            // ...capped at this many plants
  crossingSeamTries: 14,       // seam cells probed for a legal crossing anchor
  // zone-water seed variety (zone-water.ts)
  waterDrySeamChance: 0.15,    // a seam stays dry (islets merge)
  waterBayChance: 0.5,         // one border zone floods into open sea
  waterBayFloodChance: 0.8,    // per-cell flood rate inside the bay zone
  waterSecondRiverChance: 0.5, // mixed mode: a second, narrower seam river
} as const;
