import { SCAN_PROFILE } from './profile';
import type { GreyImage } from './types';

// Distinct frames and still runs. The game moves the camera in jumps and then holds it, so most
// decoded frames repeat the previous view. A frame that differs from the last distinct frame is
// distinct; it and the repeats that follow it form one still run. While the camera holds, the
// region load lines animate over land and sea and the ground does not, so a run's temporal
// standard deviation shows the chunk lattice and its mean is the ground with less noise.
//
// Memory: the last distinct tile and two run accumulators (3 x 816 KB on the 680 x 300 tile),
// plus each closed run's mean and deviation (2 x 816 KB), which the caller owns. Frames are read
// and never kept.

/** Grouping tuning; each value defaults to, and is documented in, `SCAN_PROFILE`. */
export interface StillRunOptions {
  /** Mean absolute grey difference below which a frame repeats the last distinct one. */
  readonly repeatThreshold?: number;
  /** The difference is sampled every this many tile pixels on both axes. */
  readonly sampleStep?: number;
  /** A run shorter than this many frames, its distinct frame included, is not reported. */
  readonly minFrames?: number;
}

/** A closed still run of at least `minFrames` frames. */
export interface StillRun {
  /** Index of the run's distinct frame among the distinct frames, from 0. */
  readonly distinct: number;
  /** Frames in the run, its distinct frame included. */
  readonly frames: number;
  /** Per-pixel temporal mean, in grey levels. */
  readonly mean: GreyImage;
  /** Per-pixel temporal standard deviation, in grey levels. */
  readonly deviation: GreyImage;
}

/** What `StillRunGrouper.push` made of one frame. */
export interface FrameVerdict {
  /** The frame differs from the last distinct frame and opens a new run. */
  readonly distinct: boolean;
  /** Index of the distinct frame whose run this frame belongs to. */
  readonly index: number;
  /** The run this frame closed, when it was long enough. */
  readonly closed: StillRun | null;
}

/** Mean absolute difference of two equal images sampled every `step` pixels on both axes. */
export function meanAbsDiff(a: GreyImage, b: GreyImage, step: number): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('frame difference needs equal images');
  const { width, height } = a;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0, i = y * width; x < width; x += step, i += step) {
      sum += Math.abs(a.data[i]! - b.data[i]!);
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Streams rectified grey tiles of one size and groups them into distinct frames and still runs.
 * Statistics accumulate as deviations from the run's distinct frame, so single precision stays
 * exact for the small temporal changes a still camera sees.
 */
export class StillRunGrouper {
  private readonly threshold: number;
  private readonly step: number;
  private readonly minFrames: number;
  private readonly reference: Float32Array;
  private readonly sum: Float32Array;
  private readonly sumSq: Float32Array;
  private distinctCount = 0;
  private frames = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    options: StillRunOptions = {},
  ) {
    this.threshold = options.repeatThreshold ?? SCAN_PROFILE.repeat.meanAbsDiff;
    this.step = options.sampleStep ?? SCAN_PROFILE.repeat.sampleStep;
    this.minFrames = options.minFrames ?? SCAN_PROFILE.stillRunMinFrames;
    const n = width * height;
    this.reference = new Float32Array(n);
    this.sum = new Float32Array(n);
    this.sumSq = new Float32Array(n);
  }

  /** Distinct frames seen so far. */
  get distinct(): number {
    return this.distinctCount;
  }

  /** Classifies the next frame and folds it into its run. The tile is read, never kept. */
  push(tile: GreyImage): FrameVerdict {
    if (tile.width !== this.width || tile.height !== this.height) {
      throw new Error(`still runs expect ${this.width}x${this.height} tiles`);
    }
    const ref = { width: this.width, height: this.height, data: this.reference };
    const distinct = this.distinctCount === 0 || meanAbsDiff(ref, tile, this.step) >= this.threshold;
    let closed: StillRun | null = null;
    if (distinct) {
      closed = this.close();
      this.reference.set(tile.data);
      this.sum.fill(0);
      this.sumSq.fill(0);
      this.distinctCount++;
      this.frames = 1;
    } else {
      const { reference, sum, sumSq } = this;
      const d = tile.data;
      for (let i = 0; i < d.length; i++) {
        const v = d[i]! - reference[i]!;
        sum[i]! += v;
        sumSq[i]! += v * v;
      }
      this.frames++;
    }
    return { distinct, index: this.distinctCount - 1, closed };
  }

  /** Closes the open run at the end of the recording. */
  finish(): StillRun | null {
    const run = this.close();
    this.frames = 0;
    return run;
  }

  private close(): StillRun | null {
    if (this.frames < this.minFrames) return null;
    const { width, height, reference, sum, sumSq, frames } = this;
    const n = width * height;
    const mean = new Float32Array(n);
    const deviation = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const m = sum[i]! / frames;
      mean[i] = reference[i]! + m;
      deviation[i] = Math.sqrt(Math.max(0, sumSq[i]! / frames - m * m));
    }
    return {
      distinct: this.distinctCount - 1,
      frames,
      mean: { width, height, data: mean },
      deviation: { width, height, data: deviation },
    };
  }
}
