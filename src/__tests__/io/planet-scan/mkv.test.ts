/**
 * The Matroska and WebM reader on files built in code: SimpleBlocks and BlockGroups with their key
 * flags, the segment's timestamp scale, elements of unknown size as a recorder leaves them, files
 * with and without cues, other tracks' blocks, the codec strings of each supported codec, the
 * variants it leaves to playback, and hostile sizes and counts refused without reading the file.
 * Dispatch reads the container from the first bytes, whatever the file is called.
 */
import { describe, expect, it } from 'vitest';
// @ts-ignore node builtins are untyped in this browser-first tree
import { readFileSync } from 'node:fs';
// @ts-ignore
import { join } from 'node:path';
import { VideoUnsupported, type ByteSource } from '../../../io/planet-scan/container';
import { readVideoTrack } from '../../../io/planet-scan/demux';
import { readMkvVideoTrack, SCAN_WINDOW, vp9FrameProfile } from '../../../io/planet-scan/mkv';
import {
  blockGroup, claimed, cluster, el, float64, frame, ID, mkvFile, open, openCluster, simpleBlock, str, trackEntry, uint, vint, type Bytes,
} from './ebml';

declare const __dirname: string;

const read = (src: ByteSource, maxSamples = 1000) => readMkvVideoTrack(src, { maxSamples });

function source(bytes: Uint8Array) {
  const reads: [number, number][] = [];
  const src: ByteSource = { size: bytes.byteLength, read: async (offset, length) => { reads.push([offset, length]); return bytes.slice(offset, offset + length); } };
  return { src, reads };
}

/** A file of literal bytes and long runs of a repeated pattern, read without building it. */
function virtual(parts: (Bytes | { pattern: Bytes; length: number })[]) {
  const spans: { start: number; part: Bytes | { pattern: Bytes; length: number } }[] = [];
  let size = 0;
  for (const part of parts) { spans.push({ start: size, part }); size += Array.isArray(part) ? part.length : part.length; }
  const reads: [number, number][] = [];
  const src: ByteSource = {
    size,
    read: async (offset, length) => {
      reads.push([offset, length]);
      const out = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
      for (const { start, part } of spans) {
        const n = Array.isArray(part) ? part.length : part.length;
        const from = Math.max(offset, start);
        const to = Math.min(offset + out.length, start + n);
        for (let p = from; p < to; p++) out[p - offset] = Array.isArray(part) ? part[p - start]! : part.pattern[(p - start) % part.pattern.length]!;
      }
      return out;
    },
  };
  return { src, reads };
}

const table = (t: Awaited<ReturnType<typeof read>>) => Array.from({ length: t.samples.count }, (_, k) => ({ time: t.samples.time[k]!, key: t.samples.key[k] === 1, size: t.samples.size[k]! }));

describe('reading Matroska blocks', () => {
  it('reads SimpleBlocks in file order with their key flags, times and frame bytes', async () => {
    const bytes = mkvFile({ duration: 100, clusters: [
      cluster(0, simpleBlock(1, 0, true, frame(1)), simpleBlock(1, 33, false, frame(2, 9)), simpleBlock(1, 17, false, frame(3))),
      cluster(50, simpleBlock(1, 0, true, frame(4)), simpleBlock(1, 17, false, frame(5))),
    ] });
    const t = await read(source(bytes).src);
    expect(table(t)).toEqual([
      { time: 0, key: true, size: 6 }, { time: 33000, key: false, size: 9 }, { time: 17000, key: false, size: 6 },
      { time: 50000, key: true, size: 6 }, { time: 67000, key: false, size: 6 },
    ]);
    for (let k = 0; k < t.samples.count; k++) expect(bytes[t.samples.offset[k]!]).toBe(k + 1);
    expect(t.duration).toBeCloseTo(0.1);
    expect(t.codec).toBe('avc1.640028');
    expect(t.description?.byteLength).toBeGreaterThan(6);
    expect([t.codedWidth, t.codedHeight]).toEqual([1920, 1080]);
  });

  it('converts ticks of the segment\'s timestamp scale and reads negative block offsets', async () => {
    // 100 microseconds a tick.
    const t = await read(source(mkvFile({ scale: 100_000, duration: 400, clusters: [cluster(100, simpleBlock(1, -100, true, frame(1)), simpleBlock(1, 167, false, frame(2)))] })).src);
    expect(table(t).map((s) => s.time)).toEqual([0, 26700]);
    expect(t.duration).toBeCloseTo(0.04);
  });

  it('marks a BlockGroup without a ReferenceBlock a key frame and one with it a delta', async () => {
    const t = await read(source(mkvFile({ clusters: [cluster(0,
      blockGroup(1, 0, frame(1)), blockGroup(1, 17, frame(2), -17), simpleBlock(1, 33, false, frame(3)), blockGroup(1, 50, frame(4)),
    )] })).src);
    expect(table(t).map((s) => s.key)).toEqual([true, false, false, true]);
    expect(table(t).map((s) => s.time)).toEqual([0, 17000, 33000, 50000]);
  });

  it('skips other tracks\' blocks and reads the first video track by its number', async () => {
    const t = await read(source(mkvFile({
      tracks: [{ number: 1, type: 2 }, { number: 2 }],
      clusters: [cluster(0, simpleBlock(1, 0, true, frame(9, 40)), simpleBlock(2, 0, true, frame(1)), simpleBlock(1, 5, true, frame(9)), simpleBlock(2, 17, false, frame(2)))],
    })).src);
    expect(table(t).map((s) => s.time)).toEqual([0, 17000]);
  });

  it('reads a recording left with an unknown-size segment and clusters and no cues', async () => {
    const blocks = (base: number) => [simpleBlock(1, 0, true, frame(base)), simpleBlock(1, 17, false, frame(base + 1))];
    const t = await read(source(mkvFile({ openSegment: true, clusters: [openCluster(0, ...blocks(1)), openCluster(33, ...blocks(3)), openCluster(66, ...blocks(5))] })).src);
    expect(table(t).map((s) => s.time)).toEqual([0, 17000, 33000, 50000, 66000, 83000]);
    expect(table(t).map((s) => s.key)).toEqual([true, false, true, false, true, false]);
  });

  it('ends an unknown-size cluster at the next element of the segment\'s level', async () => {
    const t = await read(source(mkvFile({
      clusters: [openCluster(0, simpleBlock(1, 0, true, frame(1)))],
      after: [...el(ID.Cues, el(ID.CuePoint, el(ID.CueTime, uint(0)))), ...el(ID.Tags), ...openCluster(17, simpleBlock(1, 0, false, frame(2)))],
    })).src);
    expect(table(t).map((s) => s.time)).toEqual([0, 17000]);
  });

  it('reads the same table with a seek head, voids and cues as without them', async () => {
    const clusters = [cluster(0, simpleBlock(1, 0, true, frame(1)), simpleBlock(1, 17, false, frame(2))), cluster(33, simpleBlock(1, 0, true, frame(3)))];
    const plain = await read(source(mkvFile({ clusters })).src);
    const indexed = await read(source(mkvFile({
      clusters,
      before: [...el(ID.SeekHead, el(0x4dbb, el(0x53ab, [0x1f, 0x43, 0xb6, 0x75]), el(0x53ac, uint(0)))), ...el(ID.Void, new Array(20).fill(0))],
      after: el(ID.Cues, el(ID.CuePoint, el(ID.CueTime, uint(0))), el(ID.CuePoint, el(ID.CueTime, uint(33)))),
    })).src);
    expect(table(indexed)).toEqual(table(plain));
  });

  it('ends the table at a block the end of the file cuts off', async () => {
    const bytes = mkvFile({ openSegment: true, clusters: [openCluster(0, simpleBlock(1, 0, true, frame(1)), simpleBlock(1, 17, false, frame(2)), simpleBlock(1, 33, false, frame(3, 40)))] });
    const t = await read(source(bytes.slice(0, bytes.byteLength - 10)).src);
    expect(table(t).map((s) => s.time)).toEqual([0, 17000]);
  });
});

describe('Matroska codecs', () => {
  const one = (track: Partial<Parameters<typeof trackEntry>[0]>, data: Bytes = frame(1), docType?: string) =>
    read(source(mkvFile({ ...(docType ? { docType } : {}), tracks: [{ number: 1, ...track }], clusters: [cluster(0, simpleBlock(1, 0, true, data))] })).src);

  it('names H.264 from its avcC record, and an avcC without parameter sets avc3 without a description', async () => {
    const empty = await one({ codecPrivate: [1, 0x42, 0xc0, 0x1e, 0xff, 0xe0, 0] });
    expect(empty.codec).toBe('avc3.42C01E');
    expect(empty.description).toBeUndefined();
  });

  it('names HEVC from its hvcC record, hvc1 with parameter sets and hev1 without', async () => {
    const hvcC = (arrays: number) => [1, 0x01, 0x60, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 120, 0xf0, 0, 0xfc, 0xfd, 0xf8, 0xf8, 0, 0, 0x0f, arrays];
    const withSets = await one({ codec: 'V_MPEGH/ISO/HEVC', codecPrivate: [...hvcC(1), 0x20, 0, 1, 0, 2, 0x40, 1] });
    expect(withSets.codec).toBe('hvc1.1.6.L120.90');
    expect(withSets.description).toBeDefined();
    const without = await one({ codec: 'V_MPEGH/ISO/HEVC', codecPrivate: hvcC(0) });
    expect(without.codec).toBe('hev1.1.6.L120.90');
    expect(without.description).toBeUndefined();
  });

  it('names AV1 from its av1C record', async () => {
    const t = await one({ codec: 'V_AV1', codecPrivate: [0x81, 0x08, 0x0c, 0] }, frame(1), 'webm');
    expect(t.codec).toBe('av01.0.08M.08');
    expect(Array.from(t.description!)).toEqual([0x81, 0x08, 0x0c, 0]);
  });

  it('names VP9 from CodecPrivate features, else from the first key frame\'s header', async () => {
    expect((await one({ codec: 'V_VP9', codecPrivate: [1, 1, 1, 2, 1, 31, 3, 1, 8] }, frame(1), 'webm')).codec).toBe('vp09.01.31.08');
    expect((await one({ codec: 'V_VP9' }, [0x82, 0x49, 0x83, 0x42, 0], 'webm')).codec).toBe('vp09.00.10.08');
    expect((await one({ codec: 'V_VP9' }, [0x92, 0x49, 0x83, 0x42, 0], 'webm')).codec).toBe('vp09.02.10.10');
    expect(vp9FrameProfile(new Uint8Array([0x86, 0x49, 0x83, 0x42]))).toBeNull();
  });

  it('names VP8', async () => {
    expect((await one({ codec: 'V_VP8' }, frame(1), 'webm')).codec).toBe('vp8');
  });
});

describe('Matroska files left to playback', () => {
  const key = (rel: number, data = frame(1)) => simpleBlock(1, rel, true, data);
  const refused: [string, Uint8Array, RegExp][] = [
    ['laced video frames', mkvFile({ clusters: [cluster(0, simpleBlock(1, 0, true, [1, 3, 3, 3], 0x02))] }), /laced/],
    ['an encoded track', mkvFile({ tracks: [{ number: 1, extra: el(ID.ContentEncodings) }], clusters: [cluster(0, key(0))] }), /encoded/],
    ['a rotated projection', mkvFile({ tracks: [{ number: 1, videoExtra: el(ID.Projection, el(ID.ProjectionPoseRoll, float64(90))) }], clusters: [cluster(0, key(0))] }), /rotated/],
    ['another codec', mkvFile({ tracks: [{ number: 1, codec: 'V_MPEG2' }], clusters: [cluster(0, key(0))] }), /codec V_MPEG2/],
    ['H.264 without its avcC', mkvFile({ tracks: [{ number: 1, codec: 'V_MPEG4/ISO/AVC', codecPrivate: [] }], clusters: [cluster(0, key(0))] }), /avcC/],
    ['a file without video', mkvFile({ tracks: [{ number: 1, type: 2 }], clusters: [cluster(0, key(0))] }), /no video track/],
    ['a file without blocks', mkvFile({ clusters: [] }), /no samples/],
    ['a first frame that is not a key frame', mkvFile({ clusters: [cluster(0, simpleBlock(1, 0, false, frame(1)), key(17))] }), /first sample/],
    ['frames sharing a presentation time', mkvFile({ clusters: [cluster(0, key(0), simpleBlock(1, 0, false, frame(2)))] }), /presentation time/],
    ['another document type', mkvFile({ docType: 'other', clusters: [cluster(0, key(0))] }), /document type/],
    ['tracks after the first cluster', mkvFile({ tracksLast: true, clusters: [cluster(0, key(0))] }), /before the tracks/],
    ['a block before its cluster\'s timestamp', mkvFile({ clusters: [el(ID.Cluster, key(0), el(ID.Timestamp, uint(0)))] }), /cluster timestamp/],
    ['an unknown-size element inside a cluster', mkvFile({ clusters: [cluster(0, open(ID.BlockGroup, el(ID.Block, [0x81, 0, 0, 0, 1])))] }), /unknown-size/],
    ['an element overrunning its cluster', mkvFile({ clusters: [[...cluster(0, claimed(ID.SimpleBlock, vint(40), [0x81, 0, 0, 0x80])), ...new Array(60).fill(0)]] }), /overruns/],
    ['a size beyond exact integers', mkvFile({ clusters: [cluster(0, claimed(ID.SimpleBlock, [0x01, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], [0x81]))] }), /too large/],
    ['an invalid size field', mkvFile({ clusters: [cluster(0, [0xa3, 0x00, 0x81])] }), /bad element size/],
  ];
  for (const [what, bytes, why] of refused) {
    it(`leaves ${what} to playback`, async () => {
      const failure = read(source(bytes).src);
      await expect(failure).rejects.toBeInstanceOf(VideoUnsupported);
      await expect(failure).rejects.toThrow(why);
    });
  }

  it('refuses a Tracks element claiming a gigabyte without reading it', async () => {
    const tracks = claimed(ID.Tracks, vint(1 << 30, 8), trackEntry({ number: 1 }));
    const bytes = new Uint8Array([...el(ID.EBML, el(ID.DocType, str('matroska'))), ...open(ID.Segment, tracks)]);
    const { src, reads } = source(bytes);
    await expect(read(src)).rejects.toThrow(/Tracks too large/);
    expect(Math.max(...reads.map(([, n]) => n))).toBeLessThanOrEqual(SCAN_WINDOW);
  });

  it('refuses more video frames than the cap as it scans', async () => {
    const blocks = Array.from({ length: 6 }, (_, k) => simpleBlock(1, k, k === 0, frame(k)));
    await expect(read(source(mkvFile({ clusters: [cluster(0, ...blocks)] })).src, 5)).rejects.toThrow(/more than 5/);
  });

  it('refuses a cluster of millions of empty elements', async () => {
    const head = mkvFile({ openSegment: true, clusters: [openCluster(0, key(0))] });
    const { src } = virtual([Array.from(head), { pattern: [ID.Void, 0x80], length: 2 * 4_000_100 }]);
    await expect(read(src)).rejects.toThrow(/too many elements/);
  }, 30_000);
});

describe('reading Matroska in bounded windows', () => {
  it('reads block headers and skips frames larger than its window', async () => {
    const big = 2 * SCAN_WINDOW + 7;
    const n = 12;
    const head = mkvFile({ openSegment: true, clusters: [] });
    const parts: (Bytes | { pattern: Bytes; length: number })[] = [Array.from(head), [...open(ID.Cluster), ...el(ID.Timestamp, uint(0))]];
    for (let k = 0; k < n; k++) {
      parts.push([ID.SimpleBlock, ...vint(4 + big, 8), 0x81, 0, k, k === 0 ? 0x80 : 0]);
      parts.push({ pattern: [k], length: big });
    }
    const { src, reads } = virtual(parts);
    const t = await read(src);
    expect(t.samples.count).toBe(n);
    expect(Array.from(t.samples.size)).toEqual(new Array(n).fill(big));
    expect(Math.max(...reads.map(([, length]) => length))).toBeLessThanOrEqual(SCAN_WINDOW);
    const total = reads.reduce((sum, [, length]) => sum + length, 0);
    expect(total).toBeLessThan(src.size / 2);
  });
});

describe('telling containers apart', () => {
  const mp4 = new Uint8Array(readFileSync(join(__dirname, '../../fixtures/mp4/avc-bframes.mp4')));

  it('reads a Matroska file by its EBML magic and an MP4 by its boxes, whatever either is called', async () => {
    const mkv = await readVideoTrack(source(mkvFile({ clusters: [cluster(0, simpleBlock(1, 0, true, frame(1)))] })).src, { maxSamples: 1000 });
    expect(mkv.samples.count).toBe(1);
    const iso = await readVideoTrack(source(mp4).src, { maxSamples: 1000 });
    expect(iso.codec).toMatch(/^avc1\./);
  });

  it('leaves a file that is neither to playback', async () => {
    await expect(readVideoTrack(source(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])).src, { maxSamples: 10 })).rejects.toBeInstanceOf(VideoUnsupported);
    await expect(readVideoTrack(source(new Uint8Array([0x1a, 0x45])).src, { maxSamples: 10 })).rejects.toBeInstanceOf(VideoUnsupported);
  });
});
