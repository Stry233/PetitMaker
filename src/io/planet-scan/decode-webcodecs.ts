/**
 * Decoded frames of an MP4 through WebCodecs, as fast as the decoder runs and independent of
 * playback, in the decode worker. Samples are read from the file in windows of a few megabytes and
 * fed in decode order with at most `DECODE_QUEUE` waiting in the decoder, and no further while the
 * consumer holds; each decoded frame is drawn at the scan's frame size and closed within the
 * decoder's output callback, so the decoder's frame pool never waits on the consumer and nothing
 * but the frame being read is held.
 *
 * `decodeFrames` reads every frame in presentation order; `decodeTimes` reads only the frames at
 * given presentation times, decoding from the key frame before each one (one earlier where a
 * leading picture may refer to the group before) and drawing only the wanted frames.
 */
import { canvasScaler, webglScaler } from './frame-scaler';
import type { ByteSource, Mp4VideoTrack } from './mp4';
import type { RgbaImage } from './types';

/** The parts of a `VideoFrame` decoding reads. */
export interface DecodedFrame {
  readonly timestamp: number;
  close(): void;
}

/** The parts of a `VideoDecoder` decoding drives; the platform's is one. */
export interface FrameDecoder {
  readonly decodeQueueSize: number;
  readonly state: string;
  configure(config: VideoDecoderConfig): void;
  decode(chunk: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array }): void;
  flush(): Promise<void>;
  close(): void;
  /** Resolves once the decode queue shrinks; polled where missing. */
  dequeued?(): Promise<void>;
}

export interface CodecPlatform {
  /** Builds a decoder calling `output` with each frame in presentation order and `error` once on failure. */
  createDecoder(output: (frame: DecodedFrame) => void, error: (e: unknown) => void): FrameDecoder;
  isConfigSupported(config: VideoDecoderConfig): Promise<boolean>;
  /** Draws a decoded frame at the scan's frame size; the image is valid until the next draw. */
  draw(frame: DecodedFrame): RgbaImage;
}

/** The decoder or its input failed after the file was accepted. */
export class DecodeError extends Error {
  constructor(readonly detail?: unknown) {
    super('the video could not be decoded');
    this.name = 'DecodeError';
  }
}

/** Chunks waiting in the decoder, at most; with the frames it holds back for reordering, this bounds
 *  the frames that come out after the consumer's `hold` last let a chunk through. */
export const DECODE_QUEUE = 4;
/** Bytes of the file read at once, at most, unless one sample is larger. */
const WINDOW = 4 << 20;

/** The decoder configuration of `track`. */
export function decoderConfig(track: Mp4VideoTrack): VideoDecoderConfig {
  return {
    codec: track.codec,
    codedWidth: track.codedWidth,
    codedHeight: track.codedHeight,
    ...(track.description ? { description: track.description } : {}),
    optimizeForLatency: false,
  };
}

/** The platform's WebCodecs in this realm, drawing at `width` x `height` (`frame-scaler.ts`); null
 *  where WebCodecs or an `OffscreenCanvas` to draw on is missing. */
export function platformCodecs(width: number, height: number): CodecPlatform | null {
  if (typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof EncodedVideoChunk === 'undefined') return null;
  const draw = webglScaler(width, height) ?? canvasScaler(width, height);
  if (!draw) return null;
  return {
    createDecoder(output, error) {
      let wake: (() => void) | null = null;
      const woken = () => { const w = wake; wake = null; w?.(); };
      // A failed decoder fires no more dequeue events, so its error wakes the feeder too.
      const decoder = new VideoDecoder({ output: (frame) => output(frame), error: (e) => { error(e); woken(); } });
      decoder.addEventListener('dequeue', woken);
      return {
        dequeued: () => new Promise<void>((resolve) => { wake = resolve; }),
        get decodeQueueSize() { return decoder.decodeQueueSize; },
        get state() { return decoder.state; },
        configure: (config) => decoder.configure(config),
        decode: (chunk) => decoder.decode(new EncodedVideoChunk(chunk)),
        flush: () => decoder.flush(),
        close: () => { if (decoder.state !== 'closed') decoder.close(); },
      };
    },
    async isConfigSupported(config) {
      try {
        return (await VideoDecoder.isConfigSupported(config)).supported === true;
      } catch {
        return false;
      }
    },
    draw: (frame) => draw(frame as unknown as VideoFrame),
  };
}

/** Reads samples' bytes in windows of consecutive file ranges, the next window read ahead. */
class SampleReader {
  private start = 0;
  private bytes: Uint8Array | null = null;
  private ahead: { start: number; bytes: Promise<Uint8Array> } | null = null;

  constructor(private readonly src: ByteSource, private readonly track: Mp4VideoTrack) {}

  /** The window starting at sample `k`'s offset, over the samples after it in decode order while
   *  they lie within `WINDOW` bytes of it. */
  private span(k: number): { start: number; length: number } {
    const { offset, size, count } = this.track.samples;
    const start = offset[k]!;
    let end = start + size[k]!;
    for (let j = k + 1; j < count; j++) {
      const o = offset[j]!;
      const e = o + size[j]!;
      if (o < start || e - start > WINDOW) break;
      end = Math.max(end, e);
    }
    return { start, length: end - start };
  }

  private fetch(k: number): { start: number; bytes: Promise<Uint8Array> } {
    const { start, length } = this.span(k);
    return { start, bytes: this.src.read(start, length) };
  }

  /** Sample `k`'s bytes. */
  async sample(k: number): Promise<Uint8Array> {
    const { offset, size, count } = this.track.samples;
    const o = offset[k]!;
    const s = size[k]!;
    if (!this.bytes || o < this.start || o + s > this.start + this.bytes.byteLength) {
      const next = this.ahead && this.ahead.start === o ? this.ahead : this.fetch(k);
      this.ahead = null;
      this.bytes = await next.bytes;
      this.start = next.start;
      if (this.bytes.byteLength < o + s - this.start) throw new DecodeError('short read');
      // The next window starts at the first sample this one does not hold.
      const end = this.start + this.bytes.byteLength;
      for (let j = k + 1; j < count; j++) {
        if (offset[j]! + size[j]! > end || offset[j]! < this.start) { this.ahead = this.fetch(j); break; }
      }
    }
    return this.bytes.subarray(o - this.start, o - this.start + s);
  }
}

/** Receives a drawn frame, valid only during the call, and its presentation time in seconds;
 *  returning false stops decoding. */
export type DrawnFrameSink = (frame: RgbaImage, time: number) => boolean | void;

interface Run {
  /** Decode-order sample ranges [from, to), each starting at a key frame. */
  readonly ranges: readonly (readonly [number, number])[];
  /** Whether the frame at this presentation time, in microseconds, is drawn. */
  readonly wanted: (timestamp: number) => boolean;
  readonly sink: DrawnFrameSink;
  readonly options: DecodeOptions;
}

export interface DecodeOptions {
  readonly signal?: AbortSignal;
  /** Awaited before each chunk is decoded: the consumer's backpressure. */
  readonly hold?: () => void | Promise<void>;
  /** A decoder holding chunks this long without a frame out has stalled, in ms. */
  readonly stallMs?: number;
}

/** How long a decoder may hold chunks without putting a frame out before it counts as stalled, in
 *  ms: well past a hardware decoder's start-up. */
const STALL_MS = 5000;

const abortError = () => new DOMException('Cancelled', 'AbortError');

async function waitForRoom(decoder: FrameDecoder, failed: () => unknown): Promise<void> {
  while (failed() === undefined && decoder.decodeQueueSize >= DECODE_QUEUE && decoder.state === 'configured') {
    await (decoder.dequeued ? decoder.dequeued() : new Promise((r) => setTimeout(r, 1)));
  }
}

async function decodeRun(platform: CodecPlatform, src: ByteSource, track: Mp4VideoTrack, run: Run): Promise<void> {
  const { samples } = track;
  let stopped = false;
  let failure: unknown;
  // The watchdog: chunks fed and frames out, and when one last came out. Time spent waiting on the
  // consumer or the file does not count against the decoder.
  let fed = 0;
  let out = 0;
  let lastOut = Date.now();
  let waiting = false;
  let stall: (error: DecodeError) => void = () => {};
  const stalled = new Promise<never>((_, reject) => { stall = reject; });
  stalled.catch(() => {});
  const stallMs = run.options.stallMs ?? STALL_MS;
  const watchdog = setInterval(() => {
    if (failure !== undefined || waiting || fed <= out || Date.now() - lastOut < stallMs) return;
    failure = new DecodeError('the decoder stopped putting out frames');
    stall(failure as DecodeError);
  }, Math.max(10, Math.min(500, stallMs / 4)));
  const decoder = platform.createDecoder((frame) => {
    out++;
    lastOut = Date.now();
    try {
      if (stopped || failure !== undefined || !run.wanted(frame.timestamp)) return;
      const image = platform.draw(frame);
      if (run.sink(image, frame.timestamp / 1e6) === false) stopped = true;
    } catch (error) {
      failure ??= error;
    } finally {
      frame.close();
    }
  }, (error) => { failure ??= new DecodeError(error); });
  const reader = new SampleReader(src, track);
  try {
    decoder.configure(decoderConfig(track));
    for (const [from, to] of run.ranges) {
      for (let k = from; k < to; k++) {
        await Promise.race([waitForRoom(decoder, () => failure), stalled]);
        waiting = true;
        const waitedFrom = Date.now();
        await run.options.hold?.();
        if (run.options.signal?.aborted) throw abortError();
        if (failure !== undefined) throw failure;
        if (stopped) return;
        const data = await reader.sample(k);
        waiting = false;
        // The wait does not count as the decoder's: the clock since the last frame resumes.
        lastOut = fed === out ? Date.now() : lastOut + (Date.now() - waitedFrom);
        decoder.decode({ type: samples.key[k] ? 'key' : 'delta', timestamp: samples.time[k]!, data });
        fed++;
      }
      // Frames held back for reordering come out on flush; the next range starts at a key frame.
      try {
        await Promise.race([decoder.flush(), stalled]);
      } catch (error) {
        failure ??= new DecodeError(error);
      }
      if (failure !== undefined) throw failure;
      if (stopped) return;
    }
  } finally {
    stopped = true;
    clearInterval(watchdog);
    decoder.close();
  }
}

/** Whether the platform decodes `track`. */
export async function checkSupported(platform: CodecPlatform, track: Mp4VideoTrack): Promise<boolean> {
  return platform.isConfigSupported(decoderConfig(track));
}

/** Every frame of `track` in presentation order, until `sink` returns false. */
export function decodeFrames(platform: CodecPlatform, src: ByteSource, track: Mp4VideoTrack, sink: DrawnFrameSink, options: DecodeOptions = {}): Promise<void> {
  return decodeRun(platform, src, track, { ranges: [[0, track.samples.count]], wanted: () => true, sink, options });
}

/**
 * The decode-order ranges that decode the samples at `indices`: each from the key frame at or
 * before the sample in decode order, or the one before that when the sample shows before its key
 * frame (a leading picture may refer to the previous group). Overlapping and touching ranges merge.
 */
export function rangesFor(track: Mp4VideoTrack, indices: Iterable<number>): [number, number][] {
  const { key, time } = track.samples;
  const keyBefore = (k: number) => { let j = k; while (j > 0 && !key[j]) j--; return j; };
  const raw: [number, number][] = [];
  for (const s of indices) {
    let from = keyBefore(s);
    if (from > 0 && time[s]! < time[from]!) from = keyBefore(from - 1);
    raw.push([from, s + 1]);
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * The frames of `track` at the presentation times `times` (seconds, as `decodeFrames` gave them),
 * each handed to `sink` with its index in `times`. A decoder failing or leaving frames out gets one
 * more pass from the first frame; throws `DecodeError` when a frame still never came out.
 */
export async function decodeTimes(platform: CodecPlatform, src: ByteSource, track: Mp4VideoTrack, times: readonly number[], sink: (index: number, frame: RgbaImage) => void, options: DecodeOptions = {}): Promise<void> {
  const { samples } = track;
  const sampleAt = new Map<number, number>();
  for (let k = 0; k < samples.count; k++) sampleAt.set(samples.time[k]!, k);
  const want = new Map<number, number>();
  const indices: number[] = [];
  times.forEach((t, index) => {
    const timestamp = Math.round(t * 1e6);
    const k = sampleAt.get(timestamp);
    if (k === undefined) throw new DecodeError(`no frame at ${t}`);
    want.set(timestamp, index);
    indices.push(k);
  });
  const decode = (ranges: readonly (readonly [number, number])[]) => decodeRun(platform, src, track, {
    ranges,
    wanted: (timestamp) => want.has(timestamp),
    sink: (frame, time) => {
      const timestamp = Math.round(time * 1e6);
      const index = want.get(timestamp)!;
      want.delete(timestamp);
      sink(index, frame);
    },
    options,
  });
  try {
    await decode(rangesFor(track, indices));
  } catch (error) {
    if (!(error instanceof DecodeError)) throw error;
  }
  if (want.size > 0) {
    // Once more in one range from the file's first frame, for decoders that cannot start at every
    // key frame the sample table names.
    let last = 0;
    for (const k of indices) if (want.has(samples.time[k]!)) last = Math.max(last, k);
    await decode([[0, last + 1]]);
  }
  if (want.size > 0) throw new DecodeError(`${want.size} frames did not decode`);
}
