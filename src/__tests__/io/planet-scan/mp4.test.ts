/**
 * The MP4 reader against ffprobe on encoded files (B-frames with the moov last, a QuickTime file
 * with the moov first, fragments, HEVC, AV1, VP9), and against boxes built here for the layouts the
 * encoders did not produce: 64-bit sizes and chunk offsets, empty edits, signed composition offsets,
 * one size for every sample, and the files it must leave to playback.
 */
import { describe, expect, it } from 'vitest';
// @ts-ignore node builtins are untyped in this browser-first tree
import { readFileSync } from 'node:fs';
// @ts-ignore
import { join } from 'node:path';
import { VideoUnsupported, type ByteSource } from '../../../io/planet-scan/container';
import { readMp4VideoTrack } from '../../../io/planet-scan/mp4';

const read = (src: ByteSource) => readMp4VideoTrack(src, { maxSamples: 1000 });

declare const __dirname: string;
const DIR = join(__dirname, '../../fixtures/mp4');
const EXPECTED = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as Record<string, {
  codec: string; width: number; height: number; packets: { offset: number; size: number; time: number; key: boolean }[];
}>;

/** A source over `bytes` that counts what it read. */
function source(bytes: Uint8Array) {
  const reads: [number, number][] = [];
  const src: ByteSource = { size: bytes.byteLength, read: async (offset, length) => { reads.push([offset, length]); return bytes.slice(offset, offset + length); } };
  return { src, reads };
}

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(DIR, name)));

describe('reading recorded MP4 files', () => {
  const CODECS: Record<string, RegExp> = {
    'avc-bframes.mp4': /^avc1\.[0-9A-F]{6}$/,
    'avc-faststart.mov': /^avc1\.[0-9A-F]{6}$/,
    'avc-fragmented.mp4': /^avc1\.[0-9A-F]{6}$/,
    'hevc.mp4': /^hvc1\.1\.6\.L\d+(\.[0-9A-F]{2})*$/,
    'av1.mp4': /^av01\.0\.\d{2}M\.08$/,
    'vp9.mp4': /^vp09\.00\.\d{2}\.08$/,
  };
  for (const name of Object.keys(EXPECTED)) {
    it(`reads every packet of ${name} as ffprobe does`, async () => {
      const want = EXPECTED[name]!;
      const track = await read(source(fixture(name)).src);
      const s = track.samples;
      expect([track.codedWidth, track.codedHeight]).toEqual([want.width, want.height]);
      expect(track.codec).toMatch(CODECS[name]!);
      expect(s.count).toBe(want.packets.length);
      const got = Array.from({ length: s.count }, (_, k) => ({ offset: s.offset[k]!, size: s.size[k]!, time: s.time[k]!, key: s.key[k] === 1 }));
      // ffprobe prints presentation times rounded to the stream's time base; ours round the same way.
      for (let k = 0; k < s.count; k++) {
        expect(got[k]!.offset).toBe(want.packets[k]!.offset);
        expect(got[k]!.size).toBe(want.packets[k]!.size);
        expect(got[k]!.key).toBe(want.packets[k]!.key);
        expect(Math.abs(got[k]!.time - want.packets[k]!.time)).toBeLessThanOrEqual(1);
      }
      expect(track.duration).toBeGreaterThan(0);
    });
  }

  it('gives H.264 its avcC record and a codec string from the record\'s profile and level', async () => {
    const track = await read(source(fixture('avc-bframes.mp4')).src);
    const d = track.description!;
    expect(d[0]).toBe(1);
    expect(track.codec).toBe(`avc1.${[d[1]!, d[2]!, d[3]!].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('')}`);
  });

  it('reads a file whose moov follows the media through box headers and the moov alone', async () => {
    const bytes = fixture('avc-bframes.mp4');
    const { src, reads } = source(bytes);
    await read(src);
    const mediaEnd = Math.max(...EXPECTED['avc-bframes.mp4']!.packets.map((p) => p.offset + p.size));
    expect(reads.filter(([, length]) => length > 16).every(([offset]) => offset >= mediaEnd)).toBe(true);
  });
});

// Boxes built in code.

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)];
const i32 = (n: number) => u32(n >>> 0);
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...parts: number[][]) => { const body = parts.flat(); return [...u32(8 + body.length), ...text(type), ...body]; };
const bigBox = (type: string, ...parts: number[][]) => { const body = parts.flat(); return [...u32(1), ...text(type), ...u64(16 + body.length), ...body]; };
const full = (type: string, version: number, ...parts: number[][]) => box(type, [version, 0, 0, 0], ...parts);
/** A track header's identity matrix, or a 90-degree turn. */
const matrix = (turned: boolean) => turned
  ? [...i32(0), ...i32(0x10000), ...i32(0), ...i32(-0x10000), ...i32(0), ...i32(0), ...i32(0), ...i32(0), ...i32(0x40000000)]
  : [...i32(0x10000), ...i32(0), ...i32(0), ...i32(0), ...i32(0x10000), ...i32(0), ...i32(0), ...i32(0), ...i32(0x40000000)];
const avcC = box('avcC', [1, 0x64, 0, 0x28, 0xff, 0xe0, 0, 0]);
const visualEntry = (type: string, ...children: number[][]) => box(type, new Array(6).fill(0), u16(1), new Array(16).fill(0), u16(1920), u16(1080), new Array(50).fill(0), ...children);

interface TrackSpec {
  entry?: number[];
  turned?: boolean;
  handler?: string;
  /** The edit list's entries as [segment duration in movie units, media time]. */
  edits?: [number, number][];
  editVersion?: number;
  stsz: number[];
  chunks: number[];
  co64?: boolean;
  /** stsc entries [first chunk, samples per chunk]. */
  stsc: [number, number][];
  stts: [number, number][];
  ctts?: [number, number][];
  stss?: number[];
  /** The sample count a one-size stsz states, when not one a chunk. */
  count?: number;
  /** A compact stz2 table of this field size instead of stsz. */
  stz2?: number;
  /** Boxes appended to the moov. */
  moovExtra?: number[];
}

function movie(t: TrackSpec, mdatAt: number, bigMoov = false): number[] {
  const tkhd = full('tkhd', 0, new Array(4 * 5).fill(0), new Array(8 + 4 + 4).fill(0), matrix(!!t.turned), u32(1920 << 16), u32(1080 << 16));
  // tkhd v0: creation, modification, track id, reserved, duration (20 bytes), reserved 8, layer, group, volume, reserved 2 = 16, matrix 36.
  tkhd.splice(8 + 4 + 8, 4, ...u32(1));
  const edts = t.edits ? box('edts', full('elst', t.editVersion ?? 0, u32(t.edits.length), ...t.edits.map(([d, m]) => (t.editVersion === 1 ? [...u64(d), ...u64(m >= 0 ? m : 2 ** 64 - 1), 0, 1, 0, 0] : [...u32(d), ...i32(m), 0, 1, 0, 0])))) : [];
  const stbl = box('stbl',
    full('stsd', 0, u32(1), t.entry ?? visualEntry('avc1', avcC)),
    full('stts', 0, u32(t.stts.length), ...t.stts.map(([c, d]) => [...u32(c), ...u32(d)])),
    t.ctts ? full('ctts', 1, u32(t.ctts.length), ...t.ctts.map(([c, o]) => [...u32(c), ...i32(o)])) : [],
    t.stss ? full('stss', 0, u32(t.stss.length), ...t.stss.map(u32)) : [],
    full('stsc', 0, u32(t.stsc.length), ...t.stsc.map(([f, n]) => [...u32(f), ...u32(n), ...u32(1)])),
    t.stz2 !== undefined ? full('stz2', 0, [0, 0, 0, t.stz2], u32(t.stsz.length), t.stsz)
      : full('stsz', 0, u32(t.stsz.length === 1 ? t.stsz[0]! : 0), u32(t.stsz.length === 1 ? t.count ?? t.chunks.length : t.stsz.length), ...(t.stsz.length === 1 ? [] : t.stsz.map(u32))),
    t.co64 ? full('co64', 0, u32(t.chunks.length), ...t.chunks.map((c) => u64(c + mdatAt))) : full('stco', 0, u32(t.chunks.length), ...t.chunks.map((c) => u32(c + mdatAt))),
  );
  const mdia = box('mdia', full('mdhd', 0, new Array(8).fill(0), u32(600), u32(0), [0, 0, 0, 0]), full('hdlr', 0, u32(0), text(t.handler ?? 'vide'), new Array(13).fill(0)), box('minf', stbl));
  const make = bigMoov ? bigBox : box;
  return make('moov', full('mvhd', 0, new Array(8).fill(0), u32(1000), u32(0), new Array(80).fill(0)), box('trak', tkhd, edts, mdia), t.moovExtra ?? []);
}

/** ftyp, mdat of `payload` bytes, then the moov `spec` describes, with chunk offsets relative to the payload. */
function file(spec: TrackSpec, payload: number, bigMoov = false, after: number[] = []): Uint8Array {
  const ftyp = box('ftyp', text('isom'), u32(0), text('isom'));
  const mdat = box('mdat', new Array(payload).fill(7));
  return new Uint8Array([...ftyp, ...mdat, ...movie(spec, ftyp.length + 8, bigMoov), ...after]);
}

/** A fragmented file: an empty sample table, track defaults of `duration` a sample, and one moof
 *  per `trun` (flags, sample count, and the run's fields after them) without a tfdt. */
function fragmented(runs: { flags: number; count: number; fields: number[] }[], duration = 10): Uint8Array {
  const trex = full('trex', 0, u32(1), u32(1), u32(duration), u32(4), u32(0));
  const spec: TrackSpec = { stsz: [], chunks: [], stsc: [], stts: [], moovExtra: box('mvex', trex) };
  const moofs = runs.flatMap((run) => box('moof', box('traf', full('tfhd', 0, u32(1)), box('trun', [0, ...u32(run.flags).slice(1)], u32(run.count), run.fields))));
  return file(spec, 64, false, moofs);
}

describe('reading MP4 boxes built here', () => {
  it('applies an empty edit and the media start of the edit list to composition times', async () => {
    const t = await read(source(file({
      edits: [[500, -1], [5000, 1200]], stsz: [10, 10, 10], chunks: [0], stsc: [[1, 3]], stts: [[3, 600]], ctts: [[1, 1200], [1, 1800], [1, 600]], stss: [1],
    }, 30)).src);
    // 500 movie units of 1000 a second delay by 0.5 s; compositions 1200, 2400 and 1800 at 600 units a
    // second start 1200 units in.
    expect(Array.from(t.samples.time)).toEqual([500000, 2500000, 1500000]);
    expect(Array.from(t.samples.key)).toEqual([1, 0, 0]);
  });

  it('reads version 1 edit lists, signed composition offsets, 64-bit chunk offsets and box sizes', async () => {
    const t = await read(source(file({
      edits: [[5000, 600]], editVersion: 1, stsz: [4, 5, 6, 7], chunks: [0, 9], co64: true, stsc: [[1, 2]], stts: [[4, 600]], ctts: [[1, 600], [1, -600], [2, 0]],
    }, 22, true)).src);
    expect(Array.from(t.samples.offset).map((o) => o - t.samples.offset[0]!)).toEqual([0, 4, 9, 15]);
    expect(Array.from(t.samples.size)).toEqual([4, 5, 6, 7]);
    expect(Array.from(t.samples.time)).toEqual([0, -1000000, 1000000, 2000000]);
    // No sync sample table: every sample is a key frame.
    expect(Array.from(t.samples.key)).toEqual([1, 1, 1, 1]);
  });

  it('reads one size for every sample and chunk runs of changing length', async () => {
    const t = await read(source(file({ stsz: [3], chunks: [0, 6, 9, 12], stsc: [[1, 2], [2, 1]], stts: [[5, 20]], stss: [1, 4] }, 15)).src);
    expect(t.samples.count).toBe(4);
    expect(Array.from(t.samples.offset).map((o) => o - t.samples.offset[0]!)).toEqual([0, 3, 6, 9]);
    expect(Array.from(t.samples.key)).toEqual([1, 0, 0, 1]);
  });

  it('builds HEVC and AV1 codec strings from their configuration records', async () => {
    const hvcC = box('hvcC', [1, 0x01, ...u32(0x60000000), 0x90, 0, 0, 0, 0, 0, 120], new Array(10).fill(0));
    const hevc = await read(source(file({ entry: visualEntry('hev1', hvcC), stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)).src);
    expect(hevc.codec).toBe('hev1.1.6.L120.90');
    const av1C = box('av1C', [0x81, 0x08, 0x0c, 0]);
    const av1 = await read(source(file({ entry: visualEntry('av01', av1C), stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)).src);
    expect(av1.codec).toBe('av01.0.08M.08');
  });

  const refused: [string, Uint8Array][] = [
    ['a rotated track', file({ turned: true, stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)],
    ['an encrypted track', file({ entry: visualEntry('encv', avcC), stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)],
    ['another codec', file({ entry: visualEntry('mp4v'), stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)],
    ['a file without video', file({ handler: 'soun', stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)],
    ['a first sample that is not a key frame', file({ stsz: [3], chunks: [0, 3], stsc: [[1, 1]], stts: [[2, 1]], stss: [2] }, 6)],
    ['samples past the end of the file', file({ stsz: [100000], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)],
    ['a WebM file', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81])],
    ['a truncated moov', file({ stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3).slice(0, -20)],
  ];
  for (const [what, bytes] of refused) {
    it(`leaves ${what} to playback`, async () => {
      await expect(read(source(bytes).src)).rejects.toBeInstanceOf(VideoUnsupported);
    });
  }

  it('refuses a one-size sample table stating more samples than the cap without expanding it', async () => {
    const bytes = file({ stsz: [3], count: 0xffffffff, chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3);
    await expect(read(source(bytes).src)).rejects.toThrow(/more than 1000/);
  });

  it('refuses a fragment run of 2^32 - 1 samples with no per-sample fields', async () => {
    await expect(read(source(fragmented([{ flags: 0, count: 0xffffffff, fields: [] }])).src)).rejects.toThrow(/more than 1000/);
  });

  it('caps the samples of all fragment runs together', async () => {
    await expect(read(source(fragmented([{ flags: 0, count: 600, fields: [] }, { flags: 0, count: 600, fields: [] }])).src)).rejects.toThrow(/more than 1000/);
  });

  it('continues a fragment without a decode time where the samples before it ended', async () => {
    const t = await read(source(fragmented([{ flags: 0x1, count: 2, fields: i32(0) }, { flags: 0x1, count: 2, fields: i32(0) }])).src);
    expect(Array.from(t.samples.time)).toEqual([0, 16667, 33333, 50000]);
  });

  it('refuses samples sharing a presentation time', async () => {
    await expect(read(source(fragmented([{ flags: 0x1, count: 3, fields: i32(0) }], 0)).src)).rejects.toThrow(/presentation time/);
  });

  it('refuses a negative fragment data offset', async () => {
    await expect(read(source(fragmented([{ flags: 0x1, count: 1, fields: i32(-8) }])).src)).rejects.toThrow(/negative/);
  });

  it('reads 4, 8 and 16-bit compact sample sizes and refuses other field sizes', async () => {
    const t = await read(source(file({ stz2: 8, stsz: [2, 3, 4], chunks: [0], stsc: [[1, 3]], stts: [[3, 1]] }, 9)).src);
    expect(Array.from(t.samples.size)).toEqual([2, 3, 4]);
    await expect(read(source(file({ stz2: 12, stsz: [2, 3, 4], chunks: [0], stsc: [[1, 3]], stts: [[3, 1]] }, 9)).src)).rejects.toThrow(/field size/);
  });

  it('names avc3 streams as such and gives no description when the record has no parameter sets', async () => {
    const empty = box('avcC', [1, 0x64, 0, 0x28, 0xff, 0xe0, 0]);
    const t = await read(source(file({ entry: visualEntry('avc3', empty), stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)).src);
    expect(t.codec).toBe('avc3.640028');
    expect(t.description).toBeUndefined();
    const withSets = await read(source(file({ entry: visualEntry('avc3', box('avcC', [1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 0])), stsz: [3], chunks: [0], stsc: [[1, 1]], stts: [[1, 1]] }, 3)).src);
    expect(withSets.description).toBeDefined();
  });
});
