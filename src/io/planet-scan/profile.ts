import { CHUNK_SIZE, PLANET_PROFILE } from '../../core/model/game-profile';
import calibrationData from './calibration.json';
import type { PixelRect, Polynomial2, Rectification, TileSpec } from './types';

// The game's map view as the scan pipeline reads it. Screen coordinates are pixels of a
// frame decoded at `frame` size; ground coordinates are rectified pixels. Stages read these facts
// here and hard-code none of them. Measured values (the rectification polynomials and the cell
// size) live in calibration.json, their source of truth.

function polynomial(terms: readonly (readonly number[])[], coef: readonly number[]): Polynomial2 {
  if (terms.length !== coef.length) throw new Error('calibration polynomial terms and coefficients differ in length');
  return { terms: terms.map((t) => [t[0]!, t[1]!] as const), coef };
}

/** The rectification polynomials of the map view at its minimum zoom, measured from recordings. */
export const MAP_VIEW_RECTIFICATION: Rectification = {
  frame: calibrationData.frame,
  origin: calibrationData.origin,
  scale: calibrationData.scale,
  toScreen: {
    u: polynomial(calibrationData.toScreen.terms, calibrationData.toScreen.u),
    v: polynomial(calibrationData.toScreen.terms, calibrationData.toScreen.v),
  },
  toGround: {
    x: polynomial(calibrationData.toGround.terms, calibrationData.toGround.x),
    y: polynomial(calibrationData.toGround.terms, calibrationData.toGround.y),
  },
};

/** One cell of the ground in rectified pixels, measured from the region load lines. */
const CELL = calibrationData.cell;

export const SCAN_PROFILE = {
  /** Frames are decoded at this size; every screen coordinate below is in its pixels. */
  frame: MAP_VIEW_RECTIFICATION.frame,
  /** The game draws its view at 16:10, fit to the screen and centred, so a 16:9 screen shows it
   *  between bars; the calibrated frame is such a screen. A picture whose shape is off both by more
   *  than `shapeTolerance` (as a log ratio) and shows no map view is refused as framed wrong. */
  view: { aspect: 16 / 10, shapeTolerance: 0.02 },
  /** The part of the screen that shows the ground undistorted enough to read, free of the HUD. */
  trustedRegion: { x0: 146, y0: 66, x1: 810, y1: 369 } satisfies PixelRect,
  /** The flat tile the trusted region rectifies to. The view is curved, so the tile's top corners
   *  fall inside the region and its bottom corners on the region's corners. */
  tile: { width: 680, height: 300, originX: 340, originY: 170 } satisfies TileSpec,
  cell: CELL,
  /** One chunk's period on the ground, in rectified pixels; the region load display draws its lines. */
  chunk: {
    cells: CHUNK_SIZE,
    width: CHUNK_SIZE * CELL.width,
    height: CHUNK_SIZE * CELL.height,
  },
  /** The landmark's footprint in cells. */
  landmark: PLANET_PROFILE.landmark,
  /** The map view's HUD, whose presence tells a map-view recording from anything else. Every
   *  value was measured on the reference recordings, the map view and other screens alike; the
   *  checks read plain colours of the HUD's structure, never its artwork. */
  hud: {
    /** The opaque bottom bar, sampled every `sampleStep` pixels. */
    bar: { region: { x0: 120, y0: 505, x1: 840, y1: 530 } satisfies PixelRect, sampleStep: 4 },
    /** As browsers and BT.709 decode it; the tolerances also admit ffmpeg's darker default
     *  decoding and the drift of re-encoded recordings. */
    barColor: [68, 66, 62] as const,
    /** The bar's mean may differ from `barColor` by this much per channel, and vary by `barSpread`. */
    barTolerance: 4,
    barSpread: 3,
    /** Plain dark patches of the round buttons: beside the zoom-in and zoom-out glyphs and on the
     *  close button's rim at the top. Each matches when its mean lies within `tolerance` of
     *  `colour` per channel and no channel varies by more than `spread`. */
    discs: {
      regions: [
        { x0: 89, y0: 168, x1: 95, y1: 173 },
        { x0: 89, y0: 325, x1: 95, y1: 331 },
        { x0: 842, y0: 26, x1: 848, y1: 31 },
      ] satisfies PixelRect[],
      colour: [54, 48, 45] as const,
      tolerance: 6,
      spread: 4,
    },
    /** The zoom slider's track between the zoom buttons, read row by row as the mean of columns
     *  x0..x1: a row is track when it lies within `barTolerance` of `barColor`, knob when within
     *  `knobTolerance` of `knobColour`. The column matches when `minShare` of its rows are one or
     *  the other and at least `knobRows` are knob. */
    zoom: {
      x0: 89,
      x1: 95,
      y0: 204,
      y1: 303,
      knobColour: [245, 210, 95] as const,
      knobTolerance: 35,
      minShare: 0.9,
      knobRows: 8,
      /** The knob's centre row at the calibration's zoom, the minimum, with the knob at the track's
       *  zoom-out end; a scan whose median knob row lies more than `knobDrift` rows away was
       *  recorded at another zoom. */
      knobCentre: 291,
      knobDrift: 6,
    },
    /** A frame shows the map view when this many of the three structures (bar, discs, zoom column)
     *  match: the cursor or a name tag can cover one. The scan starts at the first frame where
     *  all three match, past the view's fade-in, whose frames show another picture. */
    required: 2,
    /** A scan ends after this many consecutive frames that do not show the map view; frames before the
     *  scan starts are skipped. */
    endAfter: 30,
    /** A recording with fewer map-view frames is not a map-view recording. */
    minFrames: 60,
    /** A recording that shows no map-view frame within this many frames is read no further. */
    startWithin: 600,
  },
  /** A frame is a repeat of the previous one below this mean absolute grey difference, sampled
   *  every `sampleStep` tile pixels on both axes. */
  repeat: { meanAbsDiff: 0.6, sampleStep: 4 },
  /** Consecutive repeat frames needed for a still run, and for a still run to place the lattice. */
  stillRunMinFrames: 6,
  latticeMinFrames: 10,
  tracking: {
    /** Tiles are high-passed by subtracting a Gaussian blur of this sigma, in rectified pixels, so the
     *  static vignette does not pin the correlation at zero. */
    highPassSigma: 6,
    correlation: {
      /** Peaks verified per correlation. Periodic ground (chunk lines, repeating ground textures)
       *  puts several peaks a period apart, and the true one need not be highest. */
      candidates: 5,
      /** Peaks within this many pixels of a higher one are the same peak. */
      suppressRadius: 6,
      /** Sigma in pixels of the Gaussian that smooths the correlation surface. It damps the
       *  whitened high frequencies, which carry mostly noise, and keeps a peak split between two
       *  pixels by a half-pixel shift ranked as one. */
      smoothSigma: 1,
      /** Overlap shares of the tile on each axis below which the windowed true peak is unreliable. */
      minOverlapWidth: 0.4,
      minOverlapHeight: 0.4,
      /** A verified match correlates above this over the overlap. */
      minNcc: 0.7,
    },
    /** Consecutive frames show the same ground moments apart, so their match is accepted above
     *  this overlap correlation; motion blur and washed-out ground push it well below `minNcc`. */
    consecutiveMinNcc: 0.3,
    /** A consecutive pair that does not match on the whole tiles is retried at every combination
     *  of these shares of the tile, either sign or none, on the two axes: hitches jump the camera
     *  by up to two thirds of a view. */
    recovery: [0.25, 0.5, 0.625],
    /** High-passed tiles are kept as signed bytes of this many steps per grey level; values beyond
     *  127 steps clip. */
    storeScale: 4,
    closures: {
      /** Every `stride`-th frame looks for revisits among later frames. */
      stride: 2,
      /** Revisits tried per frame, those with the largest predicted overlap first. */
      candidates: 6,
      /** A revisit is at least this many frames later; nearer frames are consecutive matches. */
      minGap: 4,
      /** Predicted overlap, as a share of the tile area, below which a revisit is not tried. */
      minOverlap: 0.35,
      /** A revisit whose verified shift is this many rectified pixels from the tracked path is a
       *  periodic alias: the chunk lines and ground textures repeat every 110 to 128 pixels, while
       *  the tracked path drifts by well under this. */
      gate: 50,
      /** The smallest pre-cropped overlap correlated, in tile pixels. */
      minCropWidth: 64,
      minCropHeight: 32,
      /** Gated revisits whose offsets from the tracked path agree within this many pixels point at
       *  a tracking error rather than at aliases, which scatter. */
      agreement: 3,
      /** This many agreeing gated revisits mark the tracked path as wrong. */
      agreeingFailure: 2,
    },
    /** A recovered consecutive match must beat the best match at a different shift by this much
     *  overlap correlation; on periodic ground the true shift and its aliases correlate alike. */
    recoveryMargin: 0.1,
    solve: {
      /** Solves per robust least-squares path solve, each but the first after reweighting. */
      iterations: 5,
      /** An edge residual beyond `outlierScale` robust scales is rejected; the scale is 1.4826
       *  median absolute residual on the axis, at least `minScale` rectified pixels. */
      outlierScale: 3,
      minScale: 1,
      /** Weights multiply residuals. A rejected edge, or a step tracking could not verify, keeps
       *  this weight, which constrains nothing yet keeps the path connected. */
      outlierWeight: 0.02,
      /** A still run's lattice pin has this weight, so it counts as nine edges, and is rejected
       *  beyond `pinReject` rectified pixels from the lattice. */
      pinWeight: 3,
      pinReject: 3,
      /** The line through the pins' residuals on the unpinned path is refitted to the pins within
       *  this many pixels of the first line. */
      scaleInlier: 5,
      /** The first pinned round takes only pins within this share of the period of that refitted
       *  line, which keeps out pins read off an alias of the lines; later rounds take every pin
       *  within `pinReject` of the path they solved. */
      pinFirstReject: 0.25,
    },
  },
  /** The animated region load lines inside still runs, which give the chunk lattice. */
  lattice: {
    /** Sigma in rectified pixels of the blur before the line ridge filter. */
    ridgeSigma: 1,
    /** Ridge responses are averaged over this many pixels along the line before profiling. */
    lineSmooth: 31,
    /** A line profile is the median across the tile plus this share of its mean; the median holds
     *  against animated foam, the mean keeps lines seen over only part of the tile. */
    meanShare: 0.3,
    /** Sigma in pixels of the trend removed from a profile. */
    detrendSigma: 10,
    /** A single still run: phase search step, and the window in pixels around each comb tooth
     *  where its line is located. */
    run: { phaseStep: 0.25, lineRadius: 3 },
    /** The whole scan: the same, finer. */
    scan: { phaseStep: 0.1, lineRadius: 5 },
    /** A still run pins the lattice when its comb score (mean tooth height over profile spread)
     *  exceeds `minScore` and its lines deviate from the comb by under `maxSpread` pixels. */
    minScore: 2.5,
    maxSpread: 1.5,
    /** Weight of a tile position in the scan profile: a Gaussian centred at the shares `centreX`
     *  and `centreY` of the tile, sigma `sigma` tile lengths. Depth of field blurs the view's edges. */
    weight: { centreX: 0.5, centreY: 0.45, sigma: 0.3 },
    /** Scan profile samples with less accumulated weight (frames times position weight) are 0. */
    minWeight: 2,
  },
  /** Per-cell evidence of the ground, gathered from every frame on the solved path. */
  evidence: {
    /** Each cell is sampled on a grid of this many points per axis, at the centres of equal
     *  sub-cells; with 5 the central 3 x 3 are exactly the `inner` area. */
    subsamples: 5,
    /** Weight of a tile position in the colour evidence: a Gaussian centred at the shares
     *  `centreX` and `centreY` of the tile, sigmas `sigmaX` and `sigmaY` tile lengths. */
    weight: { centreX: 0.5, centreY: 0.45, sigmaX: 0.25, sigmaY: 0.3 },
    /** A cell's inner area, as a share of its side centred on its centre: colour and votes are read
     *  there, clear of the blur and beach mixing at its edges. */
    inner: 0.6,
    /** Positions weighted above this count toward a cell's temporal lightness variance. */
    trust: 0.25,
    /** A cell is seen when its centre's accumulated weight exceeds this. */
    known: 0.3,
    /** Still-run deviation images are kept at this fraction of the tile's resolution (a 2 x 2 box)
     *  as bytes of `deviationScale` steps per grey level, until the path places them. */
    deviationStep: 2,
    deviationScale: 4,
    /** The colour palette is fitted to a coarse centre-weighted mosaic of the distinct frames, one
     *  bin every `paletteStep` ground pixels on both axes, taking the bins whose accumulated weight
     *  exceeds `paletteMinWeight`, at most `paletteSamples` of them. */
    paletteSamples: 40_000,
    paletteStep: 4,
    paletteMinWeight: 0.2,
    /** The evidence grid is at most this many chunks per side: the largest planet and the overscan
     *  past its coast that the recording protocol asks for. A wider scan is refused. */
    maxChunks: PLANET_PROFILE.maxChunks + 6,
  },
  /** Reading sea, sand and grass from the evidence. */
  ground: {
    /** Lab k-means of the pixel palette. */
    palette: { clusters: 8, restarts: 4, iterations: 100, seed: 1 },
    /** A palette colour whose Lab hue angle lies strictly inside this range, in degrees, is sea. */
    seaHue: [138, 300] as const,
    /** Land colours split into sand and grass at an Otsu threshold on the land pixels' hue
     *  histogram over this range in 1-degree bins (sand is warmer than grass even when washed
     *  out); `fallbackSplit` when the histogram cannot be split. */
    hueRange: [40, 140] as const,
    fallbackSplit: 90,
    /** The import's live preview splits land at this hue before any palette is fitted, between
     *  sand's (80 to 92 degrees) and grass's (about 125); it never decides a cell of the planet. */
    previewSplit: 105,
    /** A vote share above this decides a cell or sample. */
    vote: 0.5,
    /** Sigma in rectified pixels of the blur on the sea vote before the coast is located. */
    seaBlur: 1,
    /** The grass blob closes gaps narrower than twice this radius in rectified pixels. */
    blobClose: 4,
    /** Local contrast: the absolute difference between the lightness and its blur of this sigma in
     *  rectified pixels, averaged over the central `contrastArea` share of the cell's side. */
    contrastSigma: 1.5,
    contrastArea: 0.8,
    /** The grass blob may add a cell to the observed grass only above this contrast, which marks
     *  builds; smooth or washed-out sand stays out. */
    blobTexture: 0.5,
    /** The row and column profile may add a cell only above this contrast and at most this sea vote. */
    profileTexture: 1.2,
    profileSea: 0.5,
    /** A cell is certainly not grass when sand and sea outvote grass, its colour lies within
     *  `sandDistance` Lab units of the scan's sand and its contrast is below `cleanTexture`; or its
     *  sea vote exceeds `waterVote`. */
    cleanTexture: 1,
    sandDistance: 20,
    waterVote: 0.6,
    /** A sand cell is one whose sand vote exceeds this and whose centre weight exceeds `sandWeight`,
     *  used to find the scan's sand colour. */
    sandVote: 0.9,
    sandWeight: 1,
    /** The profile interpolates a hidden grass edge from certain rows or columns within this many. */
    profileWindow: 15,
    /** Cells within this chessboard distance of the observed coast are decided by the shore model;
     *  elsewhere land lies more than `inland` cells inside the observed sea's edge. */
    coastBand: 4,
    inland: 1,
  },
  /** The landmark's paving: low chroma, bright, not grass, enclosed by grass. */
  landmarkSearch: {
    /** Candidate cells are below this percentile of the grass area's chroma and above this
     *  percentile of its lightness. */
    chromaPercentile: 15,
    lightPercentile: 50,
    /** Candidates are closed and then opened by 3 x 3 squares this many times. */
    close: 2,
    open: 1,
    /** A blob of fewer candidate cells is not the landmark. */
    minArea: 150,
    /** The footprint is searched this many cells around the blob's centre in half-cell steps and
     *  accepted at this overlap (intersection over union) with the blob. */
    search: 3,
    minOverlap: 0.5,
  },
  /** What the import accepts and what it reports. */
  import: {
    /** Fewer distinct frames than this cover too little of a planet to read. */
    minDistinct: 12,
    /** One import reads at most this many distinct frames, which bounds the tracking tiles held
     *  until the path is solved (51 KB each); a steady scan of the largest planet needs fewer. */
    maxDistinct: 1800,
    /** Each axis needs this many still runs whose lines pin the lattice; with fewer, the region
     *  load display was off, or the zoom differs when the runs' lines fit another period. */
    minPins: 6,
    /** The path solve must keep this share of each axis's pins; a recording whose soft lines put
     *  the cells off by a cell or more keeps far fewer, and is refused as blurry. */
    minPinShare: 0.75,
    /** The zoom check tries line periods of these scales of the calibrated one, in `scaleStep`
     *  steps, and calls the zoom different when the runs' median best scale is off by more than
     *  `scaleTolerance`. The range stays inside half and double the period, whose combs also fit. */
    scaleRange: [0.7, 1.45] as const,
    scaleStep: 0.01,
    scaleTolerance: 0.06,
    /** The share of the land's outline that borders seen ground. Below `minCoast` the scan covers
     *  too little of the planet; below `fullCoast` the planet is read but reported as partly
     *  covered. */
    minCoast: 0.5,
    fullCoast: 0.9,
    /** A scan with fewer land cells covers too little of a planet. */
    minLand: CHUNK_SIZE * CHUNK_SIZE,
    /** The most frames a recording's sample table may list for the decoder to read it: half an
     *  hour at 120 fps. Longer files go to playback, which ends once the scan leaves the map view. */
    maxFrames: 30 * 60 * 120,
  },
  /** The review overlay: inferred cells within this chessboard distance of the grass outline, on
   *  either side. Inferred cells deep inside the grass (enclosed builds) are left out. */
  review: { outlineDistance: 2 },
} as const;
