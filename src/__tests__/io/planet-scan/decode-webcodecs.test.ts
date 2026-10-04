/**
 * WebCodecs decoding on a scripted decoder that reorders like a B-frame decoder: every frame reaches
 * the consumer in presentation order and is closed, the decoder's queue and the consumer's hold
 * bound what is in flight, the file is read in windows, and decoding chosen frames starts at the
 * key frame each needs and draws only those frames.
 */
import { describe, expect, it } from 'vitest';
import { DecodeError, decodeFrames, decodeTimes, rangesFor, type CodecPlatform, type DecodedFrame, type FrameDecoder } from '../../../io/planet-scan/decode-webcodecs';
import type { ByteSource, Mp4VideoTrack } from '../../../io/planet-scan/mp4';

/** A track of `n` samples, 4 bytes each laid out in decode order, with key frames every `gop` and
 *  each group shown in the order I P B B (decode order 0 1 2 3 shows as 0 3 1 2). */
function track(n: number, gop = 8, lead = false): Mp4VideoTrack {
  const show = [0, 3, 1, 2];
  const time = new Float64Array(n);
  const key = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const g = Math.floor(k / 4) * 4;
    time[k] = (g + show[k % 4]!) * 1000;
    key[k] = k % gop === 0 ? 1 : 0;
  }
  // A leading picture: the sample after a key frame shows before it.
  if (lead) time[gop + 1] = (gop - 0.5) * 1000;
  return {
    codec: 'avc1.640028', codedWidth: 8, codedHeight: 8, duration: n / 1000,
    samples: { count: n, offset: Float64Array.from({ length: n }, (_, k) => 4 * k), size: new Uint32Array(n).fill(4), time, key },
  };
}

function bytes(n: number) {
  const data = new Uint8Array(4 * n);
  for (let k = 0; k < n; k++) data[4 * k] = k & 255;
  const reads: [number, number][] = [];
  const src: ByteSource = { size: data.byteLength, read: async (offset, length) => { reads.push([offset, length]); return data.slice(offset, offset + length); } };
  return { src, reads };
}

interface Options {
  failAt?: number;
  /** Fails at `failAt` in the first decoder only. */
  failOnce?: boolean;
  /** Swallows every chunk from this decode index on without a frame or an error. */
  stallAt?: number;
  /** Outputs this many frames late, as reordering does. */
  delay?: number;
}

/** A platform whose decoder outputs frames in presentation order `delay` chunks late, needs a key
 *  frame after configure and flush, and records what it saw. */
function platform(opts: Options = {}) {
  const seen = { decoded: [] as number[], drawn: [] as number[], open: 0, closed: 0, mostQueued: 0, flushes: 0, keysAfterFlush: [] as boolean[], decoders: 0 };
  const p: CodecPlatform = {
    createDecoder(output, error) {
      const first = seen.decoders++ === 0;
      let held: number[] = [];
      let queued = 0;
      let needKey = true;
      let state = 'unconfigured';
      const emit = (t: number) => {
        seen.open++;
        const frame: DecodedFrame = { timestamp: t, close: () => { seen.closed++; } };
        output(frame);
      };
      const release = (all: boolean) => {
        held.sort((a, b) => a - b);
        while (held.length > (all ? 0 : opts.delay ?? 2)) emit(held.shift()!);
      };
      const d: FrameDecoder = {
        get decodeQueueSize() { return queued; },
        get state() { return state; },
        configure() { state = 'configured'; },
        decode(chunk) {
          if (needKey) { seen.keysAfterFlush.push(chunk.type === 'key'); needKey = false; }
          const index = chunk.data[0]!;
          seen.decoded.push(index);
          queued++;
          seen.mostQueued = Math.max(seen.mostQueued, queued);
          if (opts.stallAt !== undefined && index >= opts.stallAt) return;
          setTimeout(() => {
            queued--;
            if (state === 'closed') return;
            if (opts.failAt === index && (first || !opts.failOnce)) { state = 'closed'; error(new Error('decoder failed')); return; }
            held.push(chunk.timestamp);
            release(false);
          }, 0);
        },
        async flush() {
          while (queued > 0) await new Promise((r) => setTimeout(r, 0));
          if (state === 'closed') throw new Error('closed');
          release(true);
          seen.flushes++;
          needKey = true;
        },
        close() { state = 'closed'; held = []; },
      };
      return d;
    },
    isConfigSupported: async () => true,
    draw(frame) {
      seen.drawn.push(frame.timestamp);
      return { width: 1, height: 1, data: new Uint8Array(4) };
    },
  };
  return { p, seen };
}

describe('decoding every frame', () => {
  it('hands every frame over in presentation order and closes each', async () => {
    const t = track(40);
    const { src } = bytes(40);
    const { p, seen } = platform();
    const times: number[] = [];
    await decodeFrames(p, src, t, (_, time) => { times.push(time); });
    expect(times).toEqual(Array.from(t.samples.time).sort((a, b) => a - b).map((x) => x / 1e6));
    expect(seen.closed).toBe(seen.open);
    expect(seen.mostQueued).toBeLessThanOrEqual(4);
    expect(seen.decoded).toEqual(Array.from({ length: 40 }, (_, k) => k));
  });

  it('reads the file in windows, not a read a sample', async () => {
    const { src, reads } = bytes(40);
    await decodeFrames(platform().p, src, track(40), () => {});
    expect(reads.length).toBe(1);
    expect(reads[0]).toEqual([0, 160]);
  });

  it('stops once the consumer says so, closing the frames still coming out', async () => {
    const { src } = bytes(40);
    const { p, seen } = platform();
    let n = 0;
    await decodeFrames(p, src, track(40), () => ++n < 5);
    expect(n).toBe(5);
    expect(seen.decoded.length).toBeLessThan(40);
    expect(seen.closed).toBe(seen.open);
  });

  it('waits for the consumer\'s hold before each chunk', async () => {
    const { src } = bytes(12);
    const { p, seen } = platform();
    let holds = 0;
    await decodeFrames(p, src, track(12), () => {}, { hold: async () => { holds++; expect(seen.decoded.length).toBe(holds - 1); await new Promise((r) => setTimeout(r, 1)); } });
    expect(holds).toBe(12);
  });

  it('fails with DecodeError when the decoder fails', async () => {
    const { src } = bytes(40);
    const { p } = platform({ failAt: 9 });
    await expect(decodeFrames(p, src, track(40), () => {})).rejects.toBeInstanceOf(DecodeError);
  });

  it('stops with an AbortError when cancelled', async () => {
    const { src } = bytes(40);
    const controller = new AbortController();
    let n = 0;
    const running = decodeFrames(platform().p, src, track(40), () => { if (++n === 3) controller.abort(); }, { signal: controller.signal });
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('decoding chosen frames', () => {
  it('starts each range at the key frame before its frames and merges ranges that meet', () => {
    const t = track(32, 8);
    // Samples 2 and 3 share the first group; 13 needs the key frame at 8; 26 the one at 24.
    expect(rangesFor(t, [3, 13, 2, 26])).toEqual([[0, 4], [8, 14], [24, 27]]);
    expect(rangesFor(t, [7, 8])).toEqual([[0, 9]]);
  });

  it('starts a leading picture\'s range at the key frame before its own', () => {
    const t = track(24, 8, true);
    expect(rangesFor(t, [9])).toEqual([[0, 10]]);
    expect(rangesFor(t, [10])).toEqual([[8, 11]]);
  });

  it('draws only the wanted frames, each handed over with its index, and starts after each flush at a key frame', async () => {
    const t = track(32, 8);
    const { src } = bytes(32);
    const { p, seen } = platform();
    const wanted = [5, 13, 26].map((k) => t.samples.time[k]! / 1e6);
    const got: [number, number][] = [];
    await decodeTimes(p, src, t, wanted, (index) => { got.push([index, seen.drawn[seen.drawn.length - 1]!]); });
    expect(got.map(([i]) => i).sort()).toEqual([0, 1, 2]);
    for (const [i, drawn] of got) expect(drawn / 1e6).toBe(wanted[i]);
    expect(seen.drawn.length).toBe(3);
    expect(seen.keysAfterFlush.every(Boolean)).toBe(true);
    expect(seen.decoded).toEqual([0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 24, 25, 26]);
    expect(seen.closed).toBe(seen.open);
  });

  it('refuses a time no sample shows', async () => {
    const { src } = bytes(8);
    await expect(decodeTimes(platform().p, src, track(8), [0.0005], () => {})).rejects.toBeInstanceOf(DecodeError);
  });

  it('fails when a wanted frame never comes out', async () => {
    const t = track(8);
    const { src } = bytes(8);
    const { p } = platform();
    const lossy: CodecPlatform = {
      ...p,
      createDecoder: (output, error) => p.createDecoder((frame) => { if (frame.timestamp === t.samples.time[2]) frame.close(); else output(frame); }, error),
    };
    await expect(decodeTimes(lossy, src, t, [t.samples.time[2]! / 1e6, t.samples.time[1]! / 1e6], () => {})).rejects.toBeInstanceOf(DecodeError);
  });

  it('decodes once more from the first frame in one range when the decoder fails on a chosen range', async () => {
    const t = track(32, 8);
    const { src } = bytes(32);
    const { p, seen } = platform({ failAt: 25, failOnce: true });
    const wanted = [5, 26].map((k) => t.samples.time[k]! / 1e6);
    const got: number[] = [];
    await decodeTimes(p, src, t, wanted, (index) => { got.push(index); });
    expect(got.sort()).toEqual([0, 1]);
    expect(seen.decoders).toBe(2);
    expect(seen.decoded.slice(-27)).toEqual(Array.from({ length: 27 }, (_, k) => k));
  });

  it('fails with DecodeError when the retry fails too', async () => {
    const t = track(32, 8);
    const { src } = bytes(32);
    await expect(decodeTimes(platform({ failAt: 25 }).p, src, t, [t.samples.time[26]! / 1e6], () => {})).rejects.toBeInstanceOf(DecodeError);
  });
});

describe('a stalled decoder', () => {
  it('fails pass 1 with DecodeError when chunks wait with no frame out', async () => {
    const { src } = bytes(40);
    const { p } = platform({ stallAt: 10 });
    await expect(decodeFrames(p, src, track(40), () => {}, { stallMs: 100 })).rejects.toBeInstanceOf(DecodeError);
  });

  it('does not count time the consumer holds against the decoder', async () => {
    const { src } = bytes(12);
    let n = 0;
    await decodeFrames(platform().p, src, track(12), () => { n++; }, { stallMs: 50, hold: () => new Promise((r) => setTimeout(r, 100)) });
    expect(n).toBe(12);
  });
});
