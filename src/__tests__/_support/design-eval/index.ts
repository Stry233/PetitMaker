/**
 * The evaluator's door: every reading of a finished map asked for from outside. No pipeline stage
 * reads it, since a generator that scored itself while building would tune to its own scorer; the
 * offline harness and the design-quality probes come through here.
 *
 *   grid.ts          road widths and region symmetry, over the map's masks (`tools/reading`)
 *   reference.ts     the style target as numbers, and the band scoring against it
 *   streets.ts       ramp discipline, straightness, and where a street ends
 *   junctions.ts     how the streets meet, how far they run, which 1-wide pavement is a garden
 *   districts.ts     whether the blocks read as blocks and front onto streets
 *   climb.ts         what the walk stands on and what it can see from there
 *   water.ts         whether the water is a system: the ledger, the courts, the course
 *   figure.ts        the map's one set piece, and where the best street ends go
 *   decor.ts         the grain of the planting
 *   composition.ts   where a map's mass sits, and whether a batch of them varies
 *   scorecard.ts     the three ledgers, and `evaluateMap` that gathers them
 */
export { mirrorScore, openingWidths, runWidths, REGION_MIN_DECOR, SYMMETRY_MATCH_MIN, UNITY_SHARE_MIN, type RegionDecor } from './grid';
export {
  bandScore, referenceDistance,
  DEAD_END_MAX, DECOR_DENSITY_BAND, ONE_WIDE_MAX, PROFILE_RANGE_REF, REACHABLE_MIN, REFERENCE,
  WIDTH_BANDS, type ReferenceDistance,
} from './reference';
export {
  compositionVariety, sampleComposition, varietyModeLimit,
  MASS_OFFSET_MIN, VARIETY_DOMINANT_MAX, VARIETY_MIN_SAMPLES,
  type CompositionSample, type CompositionVariety, type MassReading,
} from './composition';
export { bridgeAlignment, rampDiscipline, streetArrivals, streetStraightness, ARRIVAL_DEAD_END_FLOOR, ARRIVAL_DEAD_END_MAX, ARRIVAL_REACH, RAMP_COUNT_MAX, RAMP_ON_PAVEMENT_MAX, TURN_SHARE_REFERENCE, type BridgeAlignment, type RampDiscipline, type StreetArrivals, type StreetStraightness } from './streets';
export {
  networkOneWide, networkShape, LATTICE_SHARE_MAX, LATTICE_SPAN,
  type NetworkShape, type OneWideReading,
} from './junctions';
export {
  districtFrontage, districtLegibility,
  DISTRICT_COUNT_BAND, DISTRICT_MEDIAN_BAND, FRONTAGE_REACH, FRONTED_SHARE_MIN,
  type DistrictFrontage, type DistrictLegibility,
} from './districts';
export {
  climbReading, walkRhythm,
  ABOVE_MID_LEVEL, FORM_MASS_LEVEL, FORM_SIGHT_REACH,
  type ClimbReading, type WalkRhythm,
} from './climb';
export {
  courtBoxes, fountainPresence, streamShape, waterComposition, waterStoryLedger,
  CONGRUENT_MAX, STREAM_STRAIGHT_MAX,
  type FountainPresence, type StreamShape, type WaterComposition, type WaterStoryLedger,
} from './water';
export {
  figureReading, singularArrivals,
  FIGURE_GAP, SET_PIECE_CELLS_MIN, SET_PIECE_FLOOR,
  type FigureReading, type SingularArrivals,
} from './figure';
export { placeArrivals, PLACE_REACH, type PlaceArrivals } from './arrivals';
export {
  bankDressing, decorGrain, GRAIN_MASS, GRAIN_SPECIMEN,
  type BankDressing, type GrainReading,
} from './decor';
export {
  terraceShape, BOXY_FILL, TERRACE_FILL_MAX, TERRACE_MIN_CELLS, type TerraceShape,
} from './terraces';
export {
  anchorCatalogIds, evaluateMap,
  type EvalOptions, type HardLedger, type LegibilityReadings, type MapEvaluation, type MapMetrics,
  type MethodologyScores,
} from './scorecard';
