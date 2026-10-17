import { CHUNK_SIZE, PLANET_PROFILE } from '../../core/game/profile';
import calibrationData from './calibration.json';
import type { Homography, PixelRect, Rectification, TileSpec } from './types';

// The game's map view as the scan pipeline reads it. Screen coordinates are pixels of a
// frame decoded at `frame` size; ground coordinates are rectified pixels. Stages read these facts
// here and hard-code none of them. Measured values (the rectification, the cell size, the trusted
// region and the tile) live in calibration.json, their source of truth.

function homography(coef: readonly number[]): Homography {
  if (coef.length !== 9) throw new Error('a calibration homography has nine coefficients');
  return coef as unknown as Homography;
}

/** The map view at its maximum zoom, a plain perspective view of the flat ground, measured from the
 *  region load lines of recordings. */
export const MAP_VIEW_RECTIFICATION: Rectification = {
  frame: calibrationData.frame,
  toScreen: homography(calibrationData.toScreen),
  toGround: homography(calibrationData.toGround),
};

/** One cell of the ground in rectified pixels: the unit the calibration draws the ground in, which
 *  every pixel setting below is tuned to. */
const CELL = calibrationData.cell;

/** The game's view: 16:10, fit to the window's height and centred. */
const VIEW_ASPECT = 16 / 10;

/** Which edges of the HUD's layout a probe keeps its distance from: the left or right edge, or
 *  both (`span`: its left side from the left edge, its right side from the right); the top or
 *  bottom edge, or the window's middle row. */
export interface HudAnchor {
  readonly x: 'left' | 'right' | 'span';
  readonly y: 'top' | 'middle' | 'bottom';
}

export const SCAN_PROFILE = {
  /** Frames are decoded at this size; every screen coordinate below is in its pixels. */
  frame: MAP_VIEW_RECTIFICATION.frame,
  /** The game window the HUD's probes were measured in: 16:10 and as tall as the frame, from frame
   *  column `x0` (picture columns 95 to 1823 of 1920 x 1080 recordings, half a frame pixel left of
   *  the centre; the rectification's 2304 x 1440 recordings put it at 48, within `window.snap`). The game draws the world at a scale that follows the window's height (a fixed vertical field
   *  of view), so a window of any shape is placed with its height on the frame's, or its width on
   *  the frame's where it is wider than the frame (`framing.ts:placeWindow`). */
  view: { aspect: VIEW_ASPECT, x0: 47.5 },
  /** Finding the game window in a decoded picture (`framing.ts:WindowSurvey`), over `frames`
   *  pictures spread across the recording. A column or row of the picture is dark and plain in a
   *  picture when the brightest channel of its pixels, sampled every `step` pixels, averages at
   *  most `level` (limited-range black decoded as full range is 16) and varies by at most
   *  `spread`; it is margin when it is dark and plain in `share` of the pictures and its average
   *  stays within `steady` across them, which the game's dark vignette does not as the camera
   *  moves. The HUD's bottom bar is plain but far brighter. A placement within `snap` frame pixels
   *  of the picture's centred fit keeps that fit (`framing.ts:placeWindow`). A window smaller than
   *  `minWidth` x `minHeight` picture pixels draws the ground too coarsely to read. */
  window: {
    frames: 16,
    level: 16,
    spread: 3,
    steady: 4,
    step: 4,
    share: 0.9,
    snap: 1,
    minWidth: 480,
    minHeight: 360,
    /** Window aspects between these, give or take the share `aspectSlack`, were recorded and
     *  their world scale measured; outside them the scale follows the fitted rule, and a period
     *  that disagrees means the rule failed. */
    measuredAspect: [VIEW_ASPECT, 16 / 9] as const,
    aspectSlack: 0.01,
  },
  /** The part of the screen the ground is read in: clear of the HUD. */
  trustedRegion: calibrationData.trustedRegion satisfies PixelRect,
  /** The flat tile, the largest ground rectangle of even sides inside the trusted region. */
  tile: calibrationData.tile satisfies TileSpec,
  cell: CELL,
  /** One chunk's period on the ground, in rectified pixels; the region load display draws its lines. */
  chunk: {
    cells: CHUNK_SIZE,
    width: CHUNK_SIZE * CELL.width,
    height: CHUNK_SIZE * CELL.height,
  },
  /** The map view's HUD, whose presence tells a map-view recording from anything else. Every
   *  value was measured on the reference recordings, the map view and other screens alike; the
   *  checks read plain colours of the HUD's structure, never its artwork. Probe rectangles are in
   *  the calibrated window's frame pixels, and each carries the edges of the HUD it is anchored to;
   *  `hud.ts:placeProbe` keeps its offset from them, scaled, in any window's layout. */
  hud: {
    /** The HUD is drawn at the scale a reference-resolution canvas scaler gives the window: it fits
     *  the reference's width or its height, whichever is smaller, so the scale is proportional to
     *  min(width / aspect, height) for the reference `aspect`. Its left and right edges sit an
     *  inset inside the window that the scaling does not predict; the survey measures it from the
     *  bottom bar's ends (`hud.ts:InsetSurvey`), searching up to `max` calibrated pixels, and
     *  `calibrated` is its value in the calibrated recordings. */
    reference: { aspect: 16 / 9 },
    inset: { max: 40, calibrated: 12 },
    /** The opaque bottom bar, sampled every `sampleStep` pixels. */
    bar: { region: { x0: 120, y0: 505, x1: 840, y1: 530 } satisfies PixelRect, anchor: { x: 'span', y: 'bottom' } as HudAnchor, sampleStep: 4 },
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
        { rect: { x0: 89, y0: 168, x1: 95, y1: 173 }, anchor: { x: 'left', y: 'middle' } },
        { rect: { x0: 89, y0: 325, x1: 95, y1: 331 }, anchor: { x: 'left', y: 'middle' } },
        { rect: { x0: 842, y0: 26, x1: 848, y1: 31 }, anchor: { x: 'right', y: 'top' } },
      ] satisfies { rect: PixelRect; anchor: HudAnchor }[],
      color: [54, 48, 45] as const,
      tolerance: 6,
      spread: 4,
    },
    /** The zoom slider's track between the zoom buttons, read row by row as the mean of columns
     *  x0..x1: a row is track when it lies within `barTolerance` of `barColor`, knob when within
     *  `knobTolerance` of `knobColor`. The column matches when `minShare` of its rows are one or
     *  the other and at least `knobRows` are knob. */
    zoom: {
      anchor: { x: 'left', y: 'middle' } as HudAnchor,
      x0: 89,
      x1: 95,
      y0: 204,
      y1: 303,
      knobColor: [245, 210, 95] as const,
      knobTolerance: 35,
      minShare: 0.9,
      knobRows: 8,
      /** The knob's centre row at the calibration's zoom, the maximum, where the knob's colour fills
       *  the track from its zoom-in end; a knob more than `knobDrift` rows away stands at another zoom. */
      knobCentre: 251,
      knobDrift: 6,
    },
    /** A frame shows the map view when this many of the three structures (bar, discs, zoom column)
     *  match: the cursor or a name tag can cover one. The scan starts at the first frame where
     *  all three match with the knob at the calibrated zoom (`frame/scan-gate.ts`). */
    required: 2,
    /** A scan ends once the map view has been gone, or its knob off the calibrated zoom, this many
     *  seconds (30 frames at 60 fps); frames before the scan starts are skipped. */
    endAfter: 0.5,
    /** A recording with fewer map-view frames at the calibrated zoom is not a map-view recording at
     *  that zoom. */
    minFrames: 60,
    /** A recording that shows no map-view frame at the calibrated zoom within this many seconds of
     *  its first frame (600 frames at 60 fps) is read no further. */
    startWithin: 10,
  },
  /** A frame is a repeat of the previous one below this mean absolute grey difference, sampled
   *  every `sampleStep` tile pixels on both axes. */
  repeat: { meanAbsDiff: 0.6, sampleStep: 4 },
  /** Consecutive repeat frames needed for a still run: its deviation is a per-pixel spread over
   *  its frames, too noisy over fewer. */
  stillRunMinFrames: 6,
  /** A still run pins the lattice once its lines have animated this long, from its first frame to
   *  its last: ten frames of the 60 fps recordings the comb gates were set on. It is a time, since
   *  the animation, not the frame count, shows the lines; a recorder at 30 fps or a variable rate
   *  holds a pause in half as many frames or fewer. */
  latticeMinSeconds: 9 / 60,
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
    /** Distinct frames tracking keeps (`thin.ts`). A frame that starts no still run is dropped only
     *  when the next distinct frame, measured against the last kept frame, lies within `maxShift`
     *  of the tile's size from it on each axis: kept neighbours then overlap by far more than phase
     *  correlation needs, and every cell is still seen by many kept frames. A frame is measured
     *  only when it is at most `maxGap` distinct frames after the last kept one and the camera's
     *  speed puts it within `maxShift`, which spares the measurement where it cannot pay off and
     *  keeps the colour evidence sampled across a slow pan. */
    thinning: { maxShift: { x: 0.05, y: 0.05 }, maxGap: 4 },
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
    /** A consecutive step's neighbours move the camera when each shifts it by at least this share
     *  of a chunk (`lattice.ts:resolveChunkSlips`): the map view pans in steps of one game frame,
     *  0.21 chunk a step on every maximum-zoom recording, and a camera at rest shifts under 0.01.
     *  A lost step is placed on its frames' lines (`lattice.ts:bridgeLostSteps`) only within
     *  `bridge` of a chunk of the steps around it, off the midpoint between two chunks: tracked
     *  steps lie at most 0.43 chunk from their neighbours' mean on the maximum-zoom recordings. */
    chunkSlip: { moving: 1 / 8, bridge: 0.45 },
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
      /** A still run's lattice pin has this weight, so it counts as nine edges, and a pin is rejected
       *  beyond `pinReject` rectified pixels from the lattice. */
      pinWeight: 3,
      /** A kept frame's own lines (`lattice.ts:frameLines`) pin it at this weight, that of one edge;
       *  between still runs they hold the path where the tracked motion's scale drifts. */
      framePinWeight: 1,
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
    /** A kept frame's own lines are searched within `window` tile pixels of where its tracked
     *  position predicts them: the circular median of the scan phases (line plus tracked position)
     *  of the last `history` frames read, dropped after a step tracking could not verify and after
     *  `patience` frames in a row the prediction found nothing. */
    framePrior: { window: 4, history: 7, patience: 5 },
    /** A kept frame's own lines are read from its dash plane at tile resolution (`frameLines`):
     *  the still run's phase step, line window, detrend sigma and spread gate, in tile pixels. */
    frame: { phaseStep: 0.5, lineRadius: 6, detrendSigma: 20, maxSpread: 3 },
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
    /** The colour palette is fitted to a coarse centre-weighted mosaic of the kept distinct frames, one
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
    /** The sand centres fitted again per region (`ground/color.ts:localPalette`): regions of
     *  `regionChunks` chunks a side, from the mosaic bins at most `margin` times as far from the
     *  centre as from any other, drawn towards the recording's centre by `prior` bins, refitted
     *  `iterations` times. */
    localPalette: { regionChunks: 2, prior: 20, iterations: 2, margin: 0.5 },
    /** Reading the ground by its structure (`ground/surfaces.ts`): runs of one cluster no step over
     *  `split` (objects: `objectSplit`) times the median step between clusters crosses, specks under
     *  `speck` cells and ribbons under `ribbon` thick merged; sea seeds hold `seaBorder` of the edge,
     *  grass seeds `deepShare` of the pixels `deep` into the interior; a cut across a step read `reach`
     *  cells out costs 1 / (1 + (step / sigma)^2) a pixel pair (sigma `contrast` times the median),
     *  sea beside grass `touch`. Pass 1 names a cluster sea by `seaPart`, `seaShare` and `sandShare`,
     *  grass under `offGrass` off it (`blend`, `edge`). Objects lie under `paving` (sand-like) or
     *  `water` (sea-like) times as far from that surface as from the grass, enclosed (`enclosed`) or
     *  under `object` of the grass; decks between `deckApart` and `deckColour` of the water's
     *  distance from the sand, moored when over `moored` of their edge is sea. Votes blend across an
     *  edge between the pixels `blendReach` cells out. */
    surfaces: {
      speck: 12, ribbon: 1, split: 3, reach: 0.6, seaBorder: 0.1, deep: 0.7, deepShare: 0.1, contrast: 0.5, touch: 100, seaPart: 0.15,
      seaShare: 0.2, sandShare: 0.125, offGrass: 0.2, edge: 1, blend: 0.25, paving: 0.5,
      objectSplit: 0.4, enclosed: 0.1, object: 0.05, water: 0.5, deckColour: 0.75, deckApart: 0.25, moored: 0.6, blendReach: 1,
    },
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
    /** Water the open sea does not reach is read as grass in a body at least this many cells across,
     *  odd (`ground/classify.ts:inlandWater`); a narrower one keeps its vote. */
    waterBody: 3,
    /** A cell is also certainly not grass when its grass vote is below `grassVote` and its colour lies
     *  within `distance` Lab units of the mean of the confidently sandy cells within `radius` cells. */
    localSand: { radius: 6, grassVote: 0.2, distance: 12 },
    /** Reading a recording's grass edge offset (`ground/grass-shift.ts:GrassShiftSettings`), in cells. */
    grassShift: { vote: 0.8, sea: 0.5, clear: 0.4, straight: 0.15, span: 2, minEdges: 20, maxShift: 0.35, eastWestTolerance: 0.2 },
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
    /** The game draws the beach past the land by at most about this many cells (most on the south
     *  coast, whose slope faces the north-looking camera), so a cell this far or further inside the
     *  observed coast is land whatever its colour: a beach slope facing away from the light reads
     *  dark enough for the shore model to call it sea. */
    beachReach: 3,
  },
  /** Reading the landmarks (`ground/landmark.ts`): a contrast fit of the footprint's vote for a
   *  colour that is neither the cell's reading nor sea, then the footprint laid on the landmark's
   *  outline from colour steps. */
  landmarkSearch: {
    /** Width in cells of the ring round the footprint the vote is compared with. */
    ring: 2,
    /** A landmark is read where its vote exceeds the ring's by this much. */
    minContrast: 0.15,
    /** A coast landmark's vote leaves out the sea within this many cells of land. */
    shoreGap: 2,
    /** The outline is searched within this many cells of the contrast fit. */
    refine: 5,
    /** A side pair lies at least this share of the footprint's width apart. */
    minFill: 0.6,
    /** Colour steps compare the mean colours of this many cells of sample points either side. */
    edgeSpan: 0.4,
    /** Side edges are compared over this many cells either side of the south edge. */
    sideBand: 2,
    /** The pair's weaker edge steps at least this many times the median step between the sides. */
    outlineContrast: 2,
    /** The colour this many cells north of the south edge is compared with the sides'. */
    rimOffset: 1.2,
    /** A landmark with a recorded structure (`LandmarkSpec.structure`) is placed by it when its side
     *  pair lies within this many cells of the structure's width. */
    structureTolerance: 0.5,
  },
  /** What the import accepts and what it reports. */
  import: {
    /** Fewer distinct frames than this cover too little of a planet to read. */
    minDistinct: 12,
    /** One import keeps at most this many distinct frames for tracking, which bounds the tracking
     *  tiles held until the path is solved (23 KB each, 121 MB at the cap); a thinned scan of the
     *  largest planet and its overscan, continuously panned, needs about 3,000 (the Hexia recording
     *  kept 1,379 over the 36,500 cells it saw). */
    maxDistinct: 5200,
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
