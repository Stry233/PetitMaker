import type { PaletteSampler } from '../ground/color';
import { ScanError } from '../errors';
import { SCAN_PROFILE } from '../profile';
import type { FrameVerdict, StillRun } from './still-runs';
import { frameLines, lineScratch, type LineScratch } from './lattice';
import { halveTile, type Tracker, type TrackProbe } from './track';
import type { GreyImage } from '../types';

// Motion thinning of the distinct frames. A camera panning steadily makes nearly every frame
// distinct, each a few pixels from the last, and tracking, the palette and pass 2 need far fewer
// of them. A distinct frame is dropped only when the frame after it is measured close enough to the
// last kept frame, so no kept step grows beyond the limit; it is kept when a still run starts at it
// (the lattice pins and the deviations are placed at that frame), when the camera's motion is
// unknown or too fast, and at the end of the scan. The still-run grouper and the HUD checks still
// read every frame; only what tracking holds is thinned. A frame is measured by the one
// correlation tracking would spend on it anyway, which tracking reuses when the frame is kept; the
// camera's speed decides beforehand whether measuring may pay off.

const THIN = SCAN_PROFILE.tracking.thinning;

type Motion = { readonly dx: number; readonly dy: number };

/** Which distinct frames tracking keeps, from the camera's motion since the last kept frame. */
export class MotionThinner {
  private lastKept = -1;
  /** Rectified pixels per distinct frame on each axis since the last kept frame; null when unknown. */
  private speed: { x: number; y: number } | null = null;
  private readonly limitX: number;
  private readonly limitY: number;

  /** `tileWidth` and `tileHeight` in rectified pixels. */
  constructor(tileWidth: number, tileHeight: number) {
    this.limitX = THIN.maxShift.x * tileWidth;
    this.limitY = THIN.maxShift.y * tileHeight;
  }

  /**
   * Records that distinct frame `index` was kept. `motion` is its verified shift from the kept
   * frame before it in rectified pixels, null when tracking could not verify one; `stillRun` says a
   * still run starts at it, after which the camera's motion is unknown again.
   */
  kept(index: number, motion: Motion | null, stillRun: boolean): void {
    this.speed = !stillRun && this.lastKept >= 0 ? this.speedOver(index, motion) : null;
    this.lastKept = index;
  }

  /** Records distinct frame `index`'s measured shift from the last kept frame. */
  measured(index: number, motion: Motion): void {
    this.speed = this.speedOver(index, motion);
  }

  /**
   * Whether measuring distinct frame `next` may let the frame before it go: the camera's speed is
   * known, and at that speed `next` lies within `maxShift` of the last kept frame on both axes and
   * at most `maxGap` distinct frames after it.
   */
  mayDrop(next: number): boolean {
    const v = this.speed;
    if (!v) return false;
    const gap = next - this.lastKept;
    return gap <= THIN.maxGap && v.x * gap <= this.limitX && v.y * gap <= this.limitY;
  }

  /** Whether a measured shift from the last kept frame lies within `maxShift` on both axes. */
  within(motion: Motion): boolean {
    return Math.abs(motion.dx) <= this.limitX && Math.abs(motion.dy) <= this.limitY;
  }

  private speedOver(index: number, motion: Motion | null): { x: number; y: number } | null {
    const gap = index - this.lastKept;
    return motion && gap > 0 ? { x: Math.abs(motion.dx) / gap, y: Math.abs(motion.dy) / gap } : null;
  }
}

/** One distinct frame waiting for its decision: its tiles, and its probe against the last kept frame. */
interface Slot {
  index: number;
  time: number;
  readonly half: Float32Array<ArrayBuffer>;
  readonly hp: Float32Array<ArrayBuffer>;
  readonly rgba: Uint8Array<ArrayBuffer>;
  probe: TrackProbe | null;
}

/**
 * Feeds the distinct frames tracking keeps to the tracker and the palette sampler, one frame late:
 * whether a distinct frame starts a still run, and where the next one lies, is known only when the
 * next distinct frame arrives. Holds two frames' half-resolution grey and high-passed tiles and
 * rectified colour tiles, and one set of the planes `frameLines` reads a frame in. Still runs come
 * back indexed by kept frame, the index the solved path uses.
 */
export class KeptFrames {
  /** The kept frames' times, in order. */
  readonly times: number[] = [];
  /** Each kept frame's own line phases (`lattice.ts:frameLines`), NaN where none was read. */
  readonly lines = { x: [] as number[], y: [] as number[] };
  private readonly thinner: MotionThinner;
  private readonly slots: readonly [Slot, Slot];
  /** `frameLines`'s planes, reused for every kept frame. */
  private readonly scratch: LineScratch;
  private pending: Slot | null = null;

  /** `width` and `height` are the full-resolution tile's; past `maxKept` kept frames the scan is
   *  refused as `too-long`. */
  constructor(
    private readonly tracker: Tracker,
    private readonly sampler: PaletteSampler,
    private readonly width: number,
    private readonly height: number,
    private readonly maxKept: number,
  ) {
    this.thinner = new MotionThinner(width, height);
    const slot = (): Slot => {
      const n = (width >> 1) * (height >> 1);
      return { index: -1, time: 0, half: new Float32Array(n), hp: new Float32Array(n), rgba: new Uint8Array(width * height * 4), probe: null };
    };
    this.slots = [slot(), slot()];
    this.scratch = lineScratch((width >> 1) * (height >> 1));
  }

  /** Kept frames so far. */
  get kept(): number {
    return this.tracker.frames;
  }

  /**
   * Takes one map-view frame's verdict from the still-run grouper. For a distinct frame `tile` is
   * its grey tile and `colour` writes its rectified RGBA tile into the buffer given. Returns the
   * still run the frame closed, if any.
   */
  push(verdict: FrameVerdict, tile: GreyImage, color: (out: Uint8Array<ArrayBuffer>) => void, time: number): StillRun | null {
    if (!verdict.distinct) return null;
    const next = this.pending === this.slots[0] ? this.slots[1] : this.slots[0];
    next.index = verdict.index;
    next.time = time;
    next.probe = null;
    halveTile(tile, next.half);
    color(next.rgba);
    const closed = this.settle(verdict.closed, next);
    this.pending = next;
    return closed;
  }

  /** Ends the scan with the run `StillRunGrouper.finish` closed; the last distinct frame is kept. */
  finish(closed: StillRun | null): StillRun | null {
    const run = this.settle(closed, null);
    this.pending = null;
    return run;
  }

  /** Decides the pending frame, whose run `closed` is when it is not null, with `next` after it. */
  private settle(closed: StillRun | null, next: Slot | null): StillRun | null {
    const p = this.pending;
    if (!p) return closed;
    const stillRun = closed !== null;
    if (stillRun || !next || !this.dropFor(next)) this.keep(p, stillRun);
    return closed ? { ...closed, distinct: this.tracker.frames - 1 } : null;
  }

  /** Measures `next` against the last kept frame when its speed allows; true when the frame before
   *  it may go, `next` then holding the measurement for tracking. */
  private dropFor(next: Slot): boolean {
    if (!this.thinner.mayDrop(next.index)) return false;
    const { tracker } = this;
    const probe = tracker.probe({ width: this.width >> 1, height: this.height >> 1, data: next.half }, next.hp);
    const s = tracker.step;
    const motion = probe.direct ? { dx: probe.direct.dx * s, dy: probe.direct.dy * s } : null;
    if (!motion || !this.thinner.within(motion)) return false;
    this.thinner.measured(next.index, motion);
    next.probe = probe;
    return true;
  }

  private keep(p: Slot, stillRun: boolean): void {
    if (this.tracker.frames >= this.maxKept) throw new ScanError('too-long');
    const { tracker } = this;
    tracker.push({ width: this.width >> 1, height: this.height >> 1, data: p.half }, p.probe ?? undefined);
    this.sampler.push({ width: this.width, height: this.height, data: p.rgba }, tracker.position);
    this.times.push(p.time);
    const seen = frameLines({ width: this.width >> 1, height: this.height >> 1, data: p.half }, undefined, this.scratch);
    this.lines.x.push(seen.x ?? Number.NaN);
    this.lines.y.push(seen.y ?? Number.NaN);
    this.thinner.kept(p.index, tracker.lastMotion, stillRun);
  }
}
