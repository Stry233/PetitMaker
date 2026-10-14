import type { MapTemplate } from '../../core/model/types';
import { fitPalette, paletteLookup, readGround } from './ground/classify';
import { PaletteSampler } from './ground/color';
import { ScanError, type ScanFailure } from './errors';
import { EvidenceAccumulator, evidenceGrid, reduceDeviation, type ReducedDeviation } from './ground/evidence';
import { hudLayout, readHud, zoomDiffers, type HudLayout, type HudReading } from './frame/hud';
import { latticePins, lineProfiles, periodScale, type FrameLines, type RunProfiles } from './track/lattice';
import { detectLandmarks } from './ground/landmark';
import { coveragePreview, type ScanPreview } from './ground/preview';
import { MAP_VIEW_RECTIFICATION, SCAN_PROFILE } from './profile';
import { buildSampleMap, rectifyGrey, rectifyRgba, rgbaToGrey, sampledRows, type SampleMap } from './frame/rectify';
import { CALIBRATED_FRAMING, worldMeasured, type ScanFraming } from './frame/framing';
import { coastCoverage, landCells, reviewCells } from './ground/review';
import { solveScan, type FramePosition, type ScanSolution } from './track/scan-solve';
import { StillRunGrouper, type StillRun } from './track/still-runs';
import { scannedPlanet } from './to-template';
import { KeptFrames } from './track/thin';
import { Tracker } from './track/track';
import type { RgbaImage } from './types';

// One scan from decoded frames to a planet, in the two passes the pipeline needs. Pass 1 reads
// every frame: the HUD check, the rectified grey tile for the still runs and, for the distinct
// frames motion thinning keeps (`thin.ts`), the half-resolution tracking tile and the palette
// mosaic. Between the passes the camera path and the lattice are solved and the tracker's tile
// store is let go. Pass 2 reads the kept frames again, and only those, into the ground evidence.
// Frames are never kept; the thinning holds the tiles of the one frame it has not decided yet.
//
// Memory on a 60 s, 60 fps scan (3600 frames, 600 to 900 kept, 150 to 250 still runs on the
// 680 x 300 tile): pass 1 holds the grouper's three float tiles (2.4 MB), the thinning's two frame
// slots (2.4 MB), the tracking tile store (51 KB a kept frame, 31 to 46 MB, 122 MB at
// `import.maxDistinct`) and its correlators (about 10 MB), each still run's line profiles (4 KB) and
// reduced deviation (51 KB, about 13 MB for 250 runs), and the palette mosaic (about 2 MB). Pass 2
// holds the evidence planes (about 25 MB for a 12 x 12-chunk scan, 83 MB at the grid cap) and the
// reduced deviations until they are placed.

const IMPORT = SCAN_PROFILE.import;

/** A scanned planet as the import hands it over, plain data a worker can post. */
export interface ScanOutcome {
  readonly template: MapTemplate;
  /** Row-major template indices of rim cells whose ground is sand. */
  readonly rimSand: number[];
  /** Row-major template indices of inferred cells near the grass outline, to check. */
  readonly review: number[];
  /** The landmark's origin: found in the scan, or placed at the grass's centre. Its turn is always
   *  read by inference. Null when no landmark fits the grass. */
  readonly landmark: { readonly detected: boolean } | null;
  /** Ids of the landmarks the planet editor places that the scan left for the person to place. */
  readonly unplaced: string[];
  /** Ids among `unplaced` that were read but would have widened the planet past the largest. */
  readonly tooFar: string[];
  /** Ids among `unplaced` that were read where the planet cannot hold them (`ScannedPlanet.blocked`). */
  readonly blocked: string[];
  /** `ScannedPlanet.estimated`, for the person to check. */
  readonly estimated: string[];
  /** The share of the land's outline the scan saw (`coastCoverage`). */
  readonly coverage: number;
  /** The scan stopped short of part of the coast. */
  readonly partial: boolean;
}

/** What pass 1 read, for `firstPassFailure`. */
export interface FirstPassReading {
  /** Frames that show the map view. */
  readonly mapFrames: number;
  /** The zoom knob's centre row in each map-view frame where it was read. */
  readonly knobRows: readonly number[];
  readonly distinct: number;
  readonly runs: readonly RunProfiles[];
  /** The survey found no game window large enough to read; false by default. */
  readonly unframed?: boolean;
  /** The world's scale was measured on recordings of the window's shape (`framing.ts:worldMeasured`);
   *  true by default. */
  readonly worldMeasured?: boolean;
}

export interface ScanSessionOptions {
  /** The recording's framing (`survey.ts:surveyFraming`): the calibrated one by default, null where
   *  the survey found no window to read. */
  readonly framing?: ScanFraming | null;
  /** Pass 1 refuses the scan as `too-long` past this many kept distinct frames. */
  readonly maxDistinct?: number;
}

/** Why pass 1's reading cannot make a planet, or null. The checks run in `SCAN_FAILURES` order. */
export function firstPassFailure(read: FirstPassReading): ScanFailure | null {
  if (read.unframed) return 'framing';
  if (read.mapFrames < SCAN_PROFILE.hud.minFrames) return 'not-map-view';
  if (zoomDiffers(read.knobRows)) return 'different-zoom';
  if (read.distinct < IMPORT.minDistinct) return 'too-little';
  const pins = latticePins(read.runs);
  if (pins.x.frame.length < IMPORT.minPins || pins.y.frame.length < IMPORT.minPins) {
    const seen = periodScale(read.runs);
    if (seen.fitted < IMPORT.minPins || Math.abs(seen.scale - 1) <= IMPORT.scaleTolerance) return 'region-load-off';
    // The lines fit another period. With the knob at the calibrated zoom in a window whose world
    // scale only the fitted rule gives, the rule is what failed.
    return read.worldMeasured === false && read.knobRows.length > 0 ? 'framing' : 'different-zoom';
  }
  return null;
}

/** What pass 1 reads off one frame on its own: the HUD, and for a map-view frame the rectified
 *  grey tile. */
export interface PreparedFrame {
  readonly hud: HudReading;
  readonly tile: Float32Array | null;
}

/**
 * Reads frames into `PreparedFrame`s. It keeps nothing between frames, so a decoding thread can
 * prepare frames for a session elsewhere; the grey conversion covers only the rows the tile reads.
 */
export class FramePrep {
  readonly map: SampleMap;
  private readonly layout: HudLayout;
  private readonly rows: { from: number; to: number };
  private readonly greyFrame = new Float32Array(SCAN_PROFILE.frame.width * SCAN_PROFILE.frame.height);

  /** Reads frames drawn under `framing`. */
  constructor(framing: ScanFraming = CALIBRATED_FRAMING) {
    this.map = buildSampleMap(MAP_VIEW_RECTIFICATION, SCAN_PROFILE.tile, 1, framing.world);
    this.layout = hudLayout(framing);
    this.rows = sampledRows(this.map);
  }

  /** Reads `frame`, writing its tile into `tile` when given. */
  prepare(frame: RgbaImage, tile?: Float32Array<ArrayBuffer>): PreparedFrame {
    const hud = readHud(frame, this.layout);
    if (!hud.mapView) return { hud, tile: null };
    return { hud, tile: rectifyGrey(this.map, rgbaToGrey(frame, this.greyFrame, this.rows), tile).data };
  }
}

/**
 * Adds the revisits to the tracked edges and solves the path and the lattice. Revisits are gated
 * against the chain path, which drifts from the solved path by as much as the gate, so revisits
 * that agree on one offset from it may only show that drift:
 * they are tried again on the solved path, and the camera moved too fast only if they still gate
 * there, or a jump no revisit joined remains. Throws `ScanError('too-fast')` then.
 */
export function solveTracked(tracker: Tracker, runs: readonly RunProfiles[], lines?: FrameLines): ScanSolution {
  const solve = () => {
    try {
      return solveScan(tracker.frames, tracker.edges, runs, {}, lines);
    } catch {
      // The tracked graph falls apart where the camera jumped and no revisit joined the parts.
      throw new ScanError('too-fast');
    }
  };
  let closures = tracker.addClosures();
  let solution = solve();
  if (closures.failed) {
    closures = tracker.addClosures({ x: solution.path.x, y: solution.path.y });
    solution = solve();
  }
  if (closures.failed || solution.path.unbridged.length > 0) throw new ScanError('too-fast');
  return solution;
}

/** `blurry` when the solve kept too few of an axis's lattice pins (`SCAN_PROFILE.import.minPinShare`):
 *  the still runs' lines were too soft to locate, and the cells may sit a whole cell off. */
export function latticeFailure(solution: ScanSolution): ScanFailure | null {
  for (const fit of [solution.path.lattice.x, solution.path.lattice.y]) {
    if (fit && fit.pins > 0 && fit.accepted < IMPORT.minPinShare * fit.pins) return 'blurry';
  }
  return null;
}

type Phase = 'first' | 'second' | 'done';

export class ScanSession {
  private phase: Phase = 'first';
  private readonly framing: ScanFraming | null;
  private readonly prep: FramePrep;
  private readonly map: SampleMap;
  private readonly W = SCAN_PROFILE.tile.width;
  private readonly H = SCAN_PROFILE.tile.height;
  private readonly greyTile: Float32Array<ArrayBuffer>;
  private readonly rgba: Uint8Array<ArrayBuffer>;
  private grouper: StillRunGrouper | null;
  private tracker: Tracker | null;
  private sampler: PaletteSampler | null;
  private kept: KeptFrames | null;
  private readonly runs: RunProfiles[] = [];
  private deviations: { distinct: number; frames: number; dev: ReducedDeviation }[] = [];
  private readonly knobRows: number[] = [];
  private mapFrames = 0;
  private miss = 0;
  private frames = 0;
  private ended = false;
  private positions: FramePosition[] = [];
  private evidence: EvidenceAccumulator | null = null;

  private readonly maxDistinct: number;

  constructor(options: ScanSessionOptions = {}) {
    this.framing = options.framing === undefined ? CALIBRATED_FRAMING : options.framing;
    this.prep = new FramePrep(this.framing ?? CALIBRATED_FRAMING);
    this.map = this.prep.map;
    // Without a window there is nothing to read.
    if (!this.framing) this.ended = true;
    this.maxDistinct = options.maxDistinct ?? IMPORT.maxDistinct;
    this.greyTile = new Float32Array(this.W * this.H);
    this.rgba = new Uint8Array(this.W * this.H * 4);
    this.grouper = new StillRunGrouper(this.W, this.H);
    this.tracker = new Tracker(this.W >> 1, this.H >> 1, { step: 2 });
    this.sampler = new PaletteSampler(this.W, this.H);
    this.kept = new KeptFrames(this.tracker, this.sampler, this.W, this.H, this.maxDistinct);
  }

  /** Whether pass 1 still takes frames: false once the recording has left the map view. */
  get accepting(): boolean {
    return this.phase === 'first' && !this.ended;
  }

  /** Distinct frames kept so far for tracking, the frames pass 2 reads. */
  get distinct(): number {
    return this.kept?.kept ?? this.positions.length;
  }

  /** The ground read so far, for the import's preview (`preview.ts`): pass 1's coverage with the
   *  camera's view, or pass 2's cells; null before any ground and after the passes. */
  preview(): ScanPreview | null {
    if (this.phase === 'first' && this.sampler && this.tracker) {
      const at = this.tracker.position;
      return coveragePreview(this.sampler, { x: at.x, y: at.y, w: this.W, h: this.H });
    }
    if (this.phase === 'second' && this.evidence) return this.evidence.preview();
    return null;
  }

  /** Pass 1: the next decoded frame at the profile's frame size, shown at `time` seconds. */
  push(frame: RgbaImage, time: number): void {
    if (this.phase !== 'first') throw new Error('pass 1 is over');
    if (this.ended) return;
    this.pushPrepared(frame, this.prep.prepare(frame, this.greyTile), time);
  }

  /** Pass 1: the next frame as `FramePrep` read it. The tile is not kept. */
  pushPrepared(frame: RgbaImage, prepared: PreparedFrame, time: number): void {
    if (this.phase !== 'first') throw new Error('pass 1 is over');
    if (this.ended) return;
    this.frames++;
    const { hud, tile } = prepared;
    if (!(this.mapFrames > 0 ? hud.mapView : hud.whole) || !tile) {
      // Frames before the map view are skipped; leaving it ends the scan, and so does a
      // recording that does not reach it soon.
      if (this.mapFrames > 0 ? ++this.miss >= SCAN_PROFILE.hud.endAfter : this.frames >= SCAN_PROFILE.hud.startWithin) this.ended = true;
      return;
    }
    this.miss = 0;
    this.mapFrames++;
    if (hud.knob !== null) this.knobRows.push(hud.knob);
    const grey = { width: this.W, height: this.H, data: tile };
    const verdict = this.grouper!.push(grey);
    // Each kept distinct frame holds a tracking tile until the path is solved.
    this.closeRun(this.kept!.push(verdict, grey, (out) => rectifyRgba(this.map, frame, out), time));
  }

  private closeRun(run: StillRun | null): void {
    if (!run) return;
    this.runs.push({ distinct: run.distinct, frames: run.frames, profiles: lineProfiles(run.deviation) });
    this.deviations.push({ distinct: run.distinct, frames: run.frames, dev: reduceDeviation(run.deviation) });
  }

  /**
   * Ends pass 1: checks what it read, solves the camera path and the lattice, fits the palette and
   * lets the tracking tiles go. Returns the times of the kept distinct frames, which pass 2 reads in
   * order. Throws `ScanError` for a recording that cannot make a planet.
   */
  endFirstPass(): number[] {
    if (this.phase !== 'first') throw new Error('pass 1 is over');
    const distinct = this.grouper!.distinct;
    this.closeRun(this.kept!.finish(this.grouper!.finish()));
    this.grouper = null;
    const failure = firstPassFailure({
      mapFrames: this.mapFrames, knobRows: this.knobRows, distinct, runs: this.runs,
      unframed: this.framing === null, worldMeasured: this.framing !== null && worldMeasured(this.framing),
    });
    if (failure) throw new ScanError(failure);
    const tracker = this.tracker!;
    const solution = solveTracked(tracker, this.runs, this.kept!.lines);
    if (!solution.lattice.x || !solution.lattice.y) throw new ScanError('region-load-off');
    const blurred = latticeFailure(solution);
    if (blurred) throw new ScanError(blurred);
    const n = tracker.frames;
    this.positions = Array.from({ length: n }, (_, k) => ({ x: solution.path.x[k]!, y: solution.path.y[k]! }));
    const lut = paletteLookup(fitPalette(this.sampler!.samples()));
    const times = this.kept!.times;
    this.tracker = null;
    this.sampler = null;
    this.kept = null;
    const grid = evidenceGrid(solution.lattice, this.positions, this.W, this.H);
    this.evidence = new EvidenceAccumulator(grid, solution.lattice, lut, this.W, this.H);
    this.phase = 'second';
    return times;
  }

  /** Pass 2: the frame of kept distinct frame `index`, in the order `endFirstPass` gave. */
  pushDistinct(index: number, frame: RgbaImage): void {
    if (this.phase !== 'second') throw new Error('pass 2 has not started');
    const at = this.positions[index];
    if (!at) throw new Error(`no distinct frame ${index}`);
    rectifyRgba(this.map, frame, this.rgba);
    this.evidence!.addFrame({ width: this.W, height: this.H, data: this.rgba }, at);
  }

  /** Reads the ground and builds the planet. Throws `ScanError` when the scan cannot make one. */
  finish(): ScanOutcome {
    if (this.phase !== 'second') throw new Error('pass 2 has not started');
    const acc = this.evidence!;
    for (const d of this.deviations) acc.addDeviation(d.dev, this.positions[d.distinct]!, d.frames);
    this.deviations = [];
    this.evidence = null;
    this.phase = 'done';
    const ev = acc.finish();
    const reading = readGround(ev);
    const coverage = coastCoverage(reading);
    if (landCells(reading) < IMPORT.minLand || coverage < IMPORT.minCoast) throw new ScanError('too-little');
    const planet = scannedPlanet(reading, detectLandmarks(ev, reading));
    return {
      template: planet.template,
      rimSand: planet.rimSand,
      review: reviewCells(planet),
      landmark: planet.plaza ? { detected: planet.plaza.detected } : null,
      unplaced: planet.unplaced,
      tooFar: planet.tooFar,
      blocked: planet.blocked,
      estimated: planet.estimated,
      coverage,
      partial: coverage < IMPORT.fullCoast,
    };
  }
}
