/**
 * Decoded frames of a video file in the browser, scaled to the scan's frame size: the fallback for
 * browsers without WebCodecs.
 *
 * The file plays muted in a detached video element and each presented frame is drawn, placed where
 * the recording's framing puts it (`framing.ts`), onto a canvas
 * at the frame size and read back as RGBA, so a 4K recording costs no more than a 1080p one past
 * the decoder. `requestVideoFrameCallback` hands over every frame the element presents; while the
 * consumer is busy the element pauses. A page too busy to present every frame slows the playback,
 * and the frames it skipped are fetched by seeking before playback goes on, so the consumer sees
 * every frame in order; when seeking cannot fetch them either, playback fails with
 * `VideoBusyError`. A browser without the callback steps through the file by seeking at its
 * measured frame rate. Nothing leaves the page: the file is read through an object URL that is
 * revoked on close.
 */
import { median } from '../../../core/base/math';
import { surveyPlacement, type Placement } from '../frame/framing';
import { SCAN_PROFILE } from '../profile';
import type { RgbaImage } from '../types';
import { abortError, throwIfAborted } from '../../../platform/async/abort';

/** The video could not be opened or decoded. */
export class VideoReadError extends Error {
  constructor(readonly detail?: unknown) {
    super('the video cannot be read');
    this.name = 'VideoReadError';
  }
}

/** The page could not present or fetch enough of the video's frames to read it. */
export class VideoBusyError extends Error {
  constructor(readonly missed: number, readonly frames: number) {
    super(`the page missed ${missed} of ${frames} frames`);
    this.name = 'VideoBusyError';
  }
}

/** A frame as read back from the canvas. */
export type VideoFrameImage = RgbaImage & { readonly data: Uint8ClampedArray };

/**
 * Receives one frame and its presentation time in seconds. Returning a promise holds playback
 * until it settles; returning false (or a promise of false) stops it.
 */
export type FrameSink = (frame: VideoFrameImage, time: number) => boolean | void | Promise<boolean | void>;

export interface PlayOptions {
  readonly signal: AbortSignal;
  /** Only frames at these times are drawn and handed over; the others are skipped unread, and
   *  frames playback skips are not fetched: the caller seeks for those it still wants. */
  readonly wanted?: (time: number) => boolean;
  /** Playback rate to start at; 1 presents every frame on a display at least as fast as the video. */
  readonly rate?: number;
}

export interface VideoFrames {
  /** In seconds. */
  readonly duration: number;
  /** The decoded picture's size, before it is placed in the scan's frame. */
  readonly picture?: { readonly width: number; readonly height: number };
  /** Plays the file from its start, handing every frame to `sink` in order. Resolves at the end or
   *  once the sink stops it; rejects with an `AbortError` when the signal aborts. */
  play(sink: FrameSink, options: PlayOptions): Promise<void>;
  /** The frame the file shows at presentation time `time`. */
  frameAt(time: number, signal: AbortSignal): Promise<VideoFrameImage>;
  /** Where the next frames' pictures land in the scan's frame; the whole picture, fit, until then. */
  place(at: Placement): void;
  close(): void;
}

/** The parts of a video element playback reads; an `HTMLVideoElement` is one. */
export interface PlaybackElement extends EventTarget {
  readonly duration: number;
  readonly ended: boolean;
  readonly readyState: number;
  currentTime: number;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  requestVideoFrameCallback?(callback: (now: number, meta: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
  getVideoPlaybackQuality?(): { totalVideoFrames: number };
}

/** Frame interval assumed until the gaps between presented frames have measured one, in seconds. */
const DEFAULT_INTERVAL = 1 / 60;
/** The frame interval is the median of the last `GAP_SAMPLES` gaps between presented frames, read
 *  once `GAP_MIN` were seen: it holds while fewer than half the frames go unpresented, and follows
 *  a variable frame rate within a few frames, too few to slow the playback. */
const GAP_SAMPLES = 9;
const GAP_MIN = 5;
/** A gap longer than this many frame intervals skipped frames. */
const GAP_SKIP = 1.5;
/** Over each `DROP_WINDOW` presented frames, playback slows by half, down to `MIN_RATE`, when more
 *  than `DROP_SHARE` of the frames went unpresented; a pass that could neither present nor fetch
 *  more than that share fails as busy. */
const DROP_WINDOW = 120;
const DROP_SHARE = 0.05;
const MIN_RATE = 0.125;
/** A video whose first frame has not loaded within this long cannot be read here, in ms. */
export const OPEN_TIMEOUT_MS = 15_000;
/** A seek that does not land within this long fetches nothing, in ms. */
const SEEK_TIMEOUT_MS = 4000;

function once(
  target: EventTarget, type: string, signal: AbortSignal, timeoutMs?: number, timedOut: () => Error = () => new VideoBusyError(1, 1),
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new VideoReadError()); };
    const abort = () => { cleanup(); reject(abortError()); };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(type, done);
      target.removeEventListener('error', fail);
      signal.removeEventListener('abort', abort);
    };
    target.addEventListener(type, done, { once: true });
    target.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    if (timeoutMs !== undefined) timer = setTimeout(() => { cleanup(); reject(timedOut()); }, timeoutMs);
  });
}

/**
 * Reads the frames playback presents: the frame interval, the frames each gap skipped, when
 * playback should slow, and how many frames a pass missed. Where the browser counts the frames it
 * decoded (`decoded`), that count says how many went unpresented whatever the frame rate; the gaps
 * say where. Pure, so it is tested on its own.
 */
export class FramePacer {
  private readonly gaps: number[] = [];
  private last = -1;
  private seen = 0;
  private dropped = 0;
  private decodedAtWindow: number | null = null;
  private decodedAtStart: number | null = null;
  private decodedLast: number | null = null;
  /** Frames presented, and frames the gaps located as skipped, over the whole pass. */
  presented = 0;
  skipped = 0;
  rate: number;

  constructor(rate = 1) {
    this.rate = rate;
  }

  /** The frame interval in seconds. */
  get interval(): number {
    if (this.gaps.length < GAP_MIN) return DEFAULT_INTERVAL;
    return median(this.gaps, 'upper');
  }

  /** Leaves `frames` the decoder counted while playback was held (frames decoded by seeking) out. */
  exclude(frames: number): void {
    if (this.decodedAtStart !== null) this.decodedAtStart += frames;
    if (this.decodedAtWindow !== null) this.decodedAtWindow += frames;
  }

  /** Frames of the pass so far: presented plus every frame known to be skipped. */
  get frames(): number {
    return this.presented + Math.max(this.skipped, this.unpresentedByCount());
  }

  /** Frames the decoder counted beyond those presented, or 0 where it does not count. */
  unpresentedByCount(): number {
    if (this.decodedAtStart === null || this.decodedLast === null) return 0;
    return Math.max(0, this.decodedLast - this.decodedAtStart + 1 - this.presented);
  }

  /**
   * Reads the frame presented at `time`, with the decoder's running frame count where it has one:
   * the presentation times of the frames skipped since the last one, and whether the playback rate
   * changed (`rate` holds the new one).
   */
  present(time: number, decoded?: number): { missing: number[]; slowed: boolean } {
    if (decoded !== undefined) {
      this.decodedAtStart ??= decoded;
      this.decodedAtWindow ??= decoded;
      this.decodedLast = decoded;
    }
    const delta = time - this.last;
    const first = this.last < 0;
    this.last = time;
    this.presented++;
    if (first || !(delta > 0)) return { missing: [], slowed: false };
    const interval = this.interval;
    const missing: number[] = [];
    if (this.gaps.length >= GAP_MIN && delta > GAP_SKIP * interval) {
      const n = Math.round(delta / interval) - 1;
      for (let k = 1; k <= n; k++) missing.push(time - delta + (k * delta) / (n + 1));
    }
    this.gaps.push(delta);
    if (this.gaps.length > GAP_SAMPLES) this.gaps.shift();
    this.skipped += missing.length;
    this.dropped += missing.length;
    this.seen++;
    let slowed = false;
    if (this.seen >= DROP_WINDOW) {
      const counted = decoded !== undefined && this.decodedAtWindow !== null ? Math.max(0, decoded - this.decodedAtWindow - this.seen) : this.dropped;
      if (counted > DROP_SHARE * (this.seen + counted) && this.rate > MIN_RATE) {
        this.rate = Math.max(MIN_RATE, this.rate / 2);
        slowed = true;
      }
      this.seen = 0;
      this.dropped = 0;
      this.decodedAtWindow = decoded ?? null;
    }
    return { missing, slowed };
  }
}

/** The element's running count of decoded frames, where the browser keeps one. */
function decodedFrames(el: PlaybackElement): number | undefined {
  return el.getVideoPlaybackQuality?.().totalVideoFrames;
}

/** Seeks so the element shows the frame presented at `time`: half a frame past its start, clear of
 *  the boundary with the frame before. */
async function seekTo(el: PlaybackElement, time: number, interval: number, signal: AbortSignal): Promise<void> {
  const target = Math.min(Math.max(0, time + interval / 2), Math.max(0, el.duration - 1e-3));
  if (Math.abs(el.currentTime - target) < 1e-6 && el.readyState >= 2) return;
  const seeked = once(el, 'seeked', signal, SEEK_TIMEOUT_MS);
  el.currentTime = target;
  await seeked;
}

/**
 * Plays `el` from the start and hands `sink` every frame in order, `draw` reading the frame the
 * element shows. Frames the page did not present are fetched by seeking before the next presented
 * one is handed over, unless `wanted` filters the frames; when more than `DROP_SHARE` of the
 * frames could be neither presented nor fetched, it rejects with `VideoBusyError`.
 */
export function playFrames(
  el: PlaybackElement, draw: () => VideoFrameImage, sink: FrameSink, options: PlayOptions, pacer = new FramePacer(options.rate),
): Promise<void> {
  const request = el.requestVideoFrameCallback!.bind(el);
  const fill = !options.wanted;
  return new Promise<void>((resolve, reject) => {
    let handle = 0;
    let finished = false;
    /** The consumer is working through frames; playback stays paused meanwhile. */
    let working = false;
    let unfetched = 0;
    // A hidden page stops presenting frames; the element waits with it rather than run ahead.
    let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    /** Presented frames drawn and not yet handed over, with the frames skipped before each. */
    const queue: { time: number; frame: VideoFrameImage; missing: number[] }[] = [];

    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      el.cancelVideoFrameCallback?.(handle);
      el.pause();
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      options.signal.removeEventListener('abort', onAbort);
      // Frames neither presented nor fetched: those a seek could not fetch, and those the decoder
      // counted that no gap located (more than half the frames gone, or a filtered pass).
      const missed = unfetched + (fill ? Math.max(0, pacer.unpresentedByCount() - pacer.skipped) : 0);
      if (error !== undefined) reject(error);
      else if (missed > DROP_SHARE * pacer.frames) reject(new VideoBusyError(missed, pacer.frames));
      else resolve();
    };
    const resume = () => {
      if (finished || working || hidden || el.ended) return;
      void el.play().catch((error: unknown) => finish(new VideoReadError(error)));
    };
    const hand = async (frame: VideoFrameImage, time: number): Promise<boolean> => {
      const go = await sink(frame, time);
      return go !== false;
    };
    const work = async () => {
      working = true;
      el.pause();
      const decodedBefore = decodedFrames(el);
      try {
        while (queue.length > 0 && !finished) {
          const next = queue.shift()!;
          if (fill && next.missing.length > 0) {
            for (const time of next.missing) {
              let frame: VideoFrameImage | null = null;
              try {
                await seekTo(el, time, pacer.interval, options.signal);
                frame = draw();
              } catch (error) {
                if (!(error instanceof VideoBusyError)) throw error;
                unfetched++;
              }
              if (frame && !(await hand(frame, time))) { finish(); return; }
            }
            // Back where playback left off, past the frame already drawn.
            await seekTo(el, next.time, pacer.interval, options.signal);
          }
          if (!(await hand(next.frame, next.time))) { finish(); return; }
        }
      } catch (error) {
        finish(error);
        return;
      } finally {
        working = false;
        const decodedAfter = decodedFrames(el);
        if (decodedBefore !== undefined && decodedAfter !== undefined) pacer.exclude(decodedAfter - decodedBefore);
      }
      if (el.ended) finish();
      else resume();
    };
    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (finished) return;
      handle = request(onFrame);
      const time = meta.mediaTime;
      const { missing, slowed } = pacer.present(time, decodedFrames(el));
      if (slowed) el.playbackRate = pacer.rate;
      if (options.wanted && !options.wanted(time)) return;
      // A frame presented while the consumer works, before the pause took hold, joins the queue
      // in order rather than overtaking the frames ahead of it.
      queue.push({ time, frame: draw(), missing: fill ? missing : [] });
      if (!working) void work();
    };
    const onEnded = () => { if (!working && queue.length === 0) finish(); };
    const onError = () => finish(new VideoReadError());
    const onAbort = () => finish(abortError());
    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden';
      if (hidden) el.pause();
      else resume();
    };
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    options.signal.addEventListener('abort', onAbort, { once: true });
    handle = request(onFrame);
    el.playbackRate = pacer.rate;
    seekTo(el, 0, 0, options.signal).then(resume, (error: unknown) => finish(error));
  });
}

/** Frames per second the element decodes while it plays briefly, for stepping without frame
 *  callbacks; `DEFAULT_INTERVAL`'s rate where the browser cannot tell. */
async function measuredInterval(video: HTMLVideoElement, signal: AbortSignal): Promise<number> {
  const quality = () => (typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality().totalVideoFrames : 0);
  const start = quality();
  try {
    await video.play();
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    return DEFAULT_INTERVAL;
  } finally {
    video.pause();
  }
  throwIfAborted(signal);
  const frames = quality() - start;
  return frames > 5 && video.currentTime > 0 ? video.currentTime / frames : DEFAULT_INTERVAL;
}

/** Opens `file` for reading frames. Rejects with `VideoReadError` when the browser cannot decode it. */
export async function openVideo(file: Blob, signal: AbortSignal): Promise<VideoFrames> {
  const { width, height } = SCAN_PROFILE.frame;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(file);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  const close = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  if (!ctx) { close(); throw new VideoReadError(); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try {
    const loaded = once(video, 'loadeddata', signal, OPEN_TIMEOUT_MS, () => new VideoReadError('timeout'));
    video.src = url;
    await loaded;
  } catch (error) {
    close();
    throw error;
  }
  if (!(video.videoWidth > 0 && video.videoHeight > 0 && Number.isFinite(video.duration))) { close(); throw new VideoReadError(); }

  let at = surveyPlacement({ width: video.videoWidth, height: video.videoHeight });
  ctx.fillStyle = '#000';
  const draw = (): VideoFrameImage => {
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(video, at.x, at.y, video.videoWidth * at.scale, video.videoHeight * at.scale);
    const img = ctx.getImageData(0, 0, width, height);
    return { width, height, data: img.data };
  };
  /** The frame interval the last playback measured; seeks land half of it past a frame's start. */
  let interval = DEFAULT_INTERVAL;

  async function playStepping(sink: FrameSink, options: PlayOptions): Promise<void> {
    interval = await measuredInterval(video, options.signal);
    for (let k = 0; k * interval < video.duration; k++) {
      const t = k * interval;
      throwIfAborted(options.signal);
      if (options.wanted && !options.wanted(t)) continue;
      await seekTo(video, t, interval, options.signal);
      if ((await sink(draw(), t)) === false) return;
    }
  }

  return {
    duration: video.duration,
    picture: { width: video.videoWidth, height: video.videoHeight },
    async play(sink, options) {
      throwIfAborted(options.signal);
      if (!('requestVideoFrameCallback' in video)) return playStepping(sink, options);
      const pacer = new FramePacer(options.rate);
      try {
        await playFrames(video, draw, sink, options, pacer);
      } finally {
        interval = pacer.interval;
      }
    },
    async frameAt(time, signal) {
      await seekTo(video, time, interval, signal);
      return draw();
    },
    place(placement) { at = placement; },
    close,
  };
}
