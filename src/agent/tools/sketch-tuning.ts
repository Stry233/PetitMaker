/**
 * When the idle sketchbook proposes work on a map, in cells at the game's map scale. Bridge spans
 * come from the catalog's bridges rather than from here.
 */
export const SKETCH_PROFILE = {
  /** An unpaved region at least this large is worth a lane to it. */
  laneRegionMin: 40,
  /** How far off the straight line a lane bows, as a share of its length. */
  laneBow: 0.16,
  /** The pavement a lane proposes, in cells. */
  laneWidth: 2,
  /** A pond wants an open region at least this large, at most this share of it under objects. */
  pondRegionMin: 120,
  pondCoverMax: 0.04,
  /** The pond's extent as a share of the region's box, held within these radii. */
  pondShare: 0.22,
  pondRadiusMin: 2,
  pondRadiusMax: 9,
  /** How much of the pond must stand on the region's own ground. */
  pondFitShare: 0.85,
  /** How far a bridge's approach runs onto each bank. */
  bridgeApproach: 2,
  /** A stand of this many trees is a grove worth thickening, its trees this close, with at most this
   *  many more offered. */
  groveTreesMin: 2,
  groveTreesMax: 4,
  groveSpan: 6,
  groveInfillMax: 3,
  /** Inside this share of the map's half-width a feature is in the middle rather than a quarter. */
  middleShare: 0.22,
} as const;
