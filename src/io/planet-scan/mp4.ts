/**
 * The first video track of an MP4 or QuickTime file (ISO base media), read for WebCodecs: its codec
 * string and decoder configuration, and every sample's byte range, presentation time and key flag
 * in decode order. Files are read through ranged reads, so a recording whose `moov` follows its
 * media data costs a few header reads and the `moov` itself, never the whole file. Fragmented files
 * (`moof` boxes) are read too.
 *
 * Supported codecs: H.264 (`avc1`, `avc3`), HEVC (`hvc1`, `hev1`), AV1 (`av01`) and VP9 (`vp09`).
 * A file this reader cannot hand to WebCodecs as recorded (another container or codec, encryption,
 * a rotated track) throws `Mp4Unsupported`, and the caller reads it another way.
 */

/** Random access to a file's bytes. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}

/** The file is not an MP4 this reader can hand to WebCodecs. */
export class Mp4Unsupported extends Error {
  constructor(readonly why: string) {
    super(`unsupported video file: ${why}`);
    this.name = 'Mp4Unsupported';
  }
}

/** A video track's samples in decode order. Times are presentation times in whole microseconds,
 *  with the track's edit list applied. */
export interface SampleTable {
  readonly count: number;
  readonly offset: Float64Array;
  readonly size: Uint32Array;
  readonly time: Float64Array;
  /** 1 for a sample decoding can start at. */
  readonly key: Uint8Array;
}

export interface Mp4VideoTrack {
  /** The WebCodecs codec string. */
  readonly codec: string;
  /** The decoder configuration record, for `VideoDecoderConfig.description`. */
  readonly description?: Uint8Array;
  readonly codedWidth: number;
  readonly codedHeight: number;
  /** In seconds. */
  readonly duration: number;
  readonly samples: SampleTable;
}

/** The largest `moov` or `moof` read, in bytes: a 10-hour recording's sample tables fit well within. */
const MAX_BOX = 64 << 20;
/** The most top-level boxes read: a fragmented recording has two a fragment. */
const MAX_TOP_BOXES = 100_000;

export interface Mp4ReadOptions {
  /** Tracks with more samples are refused before their tables are expanded. */
  readonly maxSamples: number;
}

interface Box {
  readonly type: string;
  /** The payload's offset and length within the buffer. */
  readonly start: number;
  readonly end: number;
}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

class Reader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(at: number): number { this.check(at, 1); return this.view.getUint8(at); }
  u16(at: number): number { this.check(at, 2); return this.view.getUint16(at); }
  u32(at: number): number { this.check(at, 4); return this.view.getUint32(at); }
  i32(at: number): number { this.check(at, 4); return this.view.getInt32(at); }
  u64(at: number): number { return this.u32(at) * 2 ** 32 + this.u32(at + 4); }
  i64(at: number): number { return this.i32(at) * 2 ** 32 + this.u32(at + 4); }
  private check(at: number, n: number): void {
    if (at < 0 || at + n > this.bytes.byteLength) throw new Mp4Unsupported('truncated box');
  }

  /** The child boxes of the payload [start, end). */
  children(start: number, end: number): Box[] {
    const out: Box[] = [];
    let at = start;
    while (at + 8 <= end) {
      let size = this.u32(at);
      const type = fourcc(this.bytes, at + 4);
      let header = 8;
      if (size === 1) { size = this.u64(at + 8); header = 16; } else if (size === 0) size = end - at;
      if (size < header || at + size > end) throw new Mp4Unsupported(`bad ${type} box`);
      out.push({ type, start: at + header, end: at + size });
      at += size;
    }
    return out;
  }

  child(parent: Box, type: string): Box | undefined {
    return this.children(parent.start, parent.end).find((b) => b.type === type);
  }

  need(parent: Box, type: string): Box {
    const box = this.child(parent, type);
    if (!box) throw new Mp4Unsupported(`no ${type} box`);
    return box;
  }

  payload(box: Box): Uint8Array {
    return this.bytes.slice(box.start, box.end);
  }
}

/** A top-level box of the file: its type, file offset and size including the header. */
interface TopBox { readonly type: string; readonly offset: number; readonly size: number; readonly header: number }

async function topLevelBoxes(src: ByteSource): Promise<TopBox[]> {
  const out: TopBox[] = [];
  let at = 0;
  while (at + 8 <= src.size) {
    const head = new Reader(await src.read(at, Math.min(16, src.size - at)));
    let size = head.u32(0);
    const type = fourcc(head.bytes, 4);
    let header = 8;
    if (size === 1) { size = head.u64(8); header = 16; } else if (size === 0) size = src.size - at;
    if (size < header) throw new Mp4Unsupported(`bad ${type} box`);
    if (out.length === 0 && type !== 'ftyp' && type !== 'moov' && type !== 'mdat' && type !== 'free' && type !== 'skip' && type !== 'wide') throw new Mp4Unsupported('not an MP4 file');
    out.push({ type, offset: at, size: Math.min(size, src.size - at), header });
    if (out.length > MAX_TOP_BOXES) throw new Mp4Unsupported('too many boxes');
    at += size;
  }
  return out;
}

async function readTop(src: ByteSource, box: TopBox): Promise<{ r: Reader; box: Box }> {
  if (box.size > MAX_BOX) throw new Mp4Unsupported(`${box.type} box too large`);
  const r = new Reader(await src.read(box.offset, box.size));
  return { r, box: { type: box.type, start: box.header, end: box.size } };
}

const hex = (n: number, digits = 2) => n.toString(16).toUpperCase().padStart(digits, '0');

/** Reverses the 32 bits of `n`, as the HEVC codec string writes the compatibility flags. */
function reverseBits32(n: number): number {
  let out = 0;
  for (let k = 0; k < 32; k++) { out = (out * 2) + (n & 1); n >>>= 1; }
  return out;
}

/** The WebCodecs codec string and description of a sample entry, or a reason it has none. */
function codecOf(r: Reader, entry: Box): { codec: string; description?: Uint8Array } {
  // A visual sample entry: 8 bytes of SampleEntry, 70 of VisualSampleEntry, then its boxes.
  const boxes = r.children(entry.start + 78, entry.end);
  const find = (type: string) => boxes.find((b) => b.type === type);
  switch (entry.type) {
    case 'avc1':
    case 'avc3': {
      const c = find('avcC');
      if (!c) throw new Mp4Unsupported('no avcC box');
      const codec = `${entry.type}.${hex(r.u8(c.start + 1))}${hex(r.u8(c.start + 2))}${hex(r.u8(c.start + 3))}`;
      // An avc3 stream carries its parameter sets in band; a record without any configures nothing.
      const parameterSets = r.u8(c.start + 5) & 31;
      return parameterSets > 0 ? { codec, description: r.payload(c) } : { codec };
    }
    case 'hvc1':
    case 'hev1': {
      const c = find('hvcC');
      if (!c) throw new Mp4Unsupported('no hvcC box');
      const b1 = r.u8(c.start + 1);
      const space = ['', 'A', 'B', 'C'][b1 >> 6]!;
      const tier = (b1 >> 5) & 1 ? 'H' : 'L';
      const compat = reverseBits32(r.u32(c.start + 2)).toString(16).toUpperCase();
      const constraints: number[] = [];
      for (let k = 0; k < 6; k++) constraints.push(r.u8(c.start + 6 + k));
      while (constraints.length > 0 && constraints[constraints.length - 1] === 0) constraints.pop();
      const level = r.u8(c.start + 12);
      const tail = constraints.map((v) => `.${hex(v)}`).join('');
      return { codec: `${entry.type}.${space}${b1 & 31}.${compat}.${tier}${level}${tail}`, description: r.payload(c) };
    }
    case 'av01': {
      const c = find('av1C');
      if (!c) throw new Mp4Unsupported('no av1C box');
      const b1 = r.u8(c.start + 1);
      const b2 = r.u8(c.start + 2);
      const depth = (b2 & 0x40) ? ((b2 & 0x20) ? 12 : 10) : 8;
      return { codec: `av01.${b1 >> 5}.${String(b1 & 31).padStart(2, '0')}${(b2 & 0x80) ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`, description: r.payload(c) };
    }
    case 'vp09': {
      const c = find('vpcC');
      if (!c) throw new Mp4Unsupported('no vpcC box');
      // A full box: version and flags, then profile, level and bit depth.
      return { codec: `vp09.${String(r.u8(c.start + 4)).padStart(2, '0')}.${String(r.u8(c.start + 5)).padStart(2, '0')}.${String(r.u8(c.start + 6) >> 4).padStart(2, '0')}` };
    }
    default:
      throw new Mp4Unsupported(`codec ${entry.type}`);
  }
}

/** Whether a track header's matrix shows the picture as decoded (no rotation or flip). */
function upright(r: Reader, tkhd: Box): boolean {
  const version = r.u8(tkhd.start);
  const m = tkhd.start + (version === 1 ? 52 : 40);
  const a = r.i32(m), b = r.i32(m + 4), c = r.i32(m + 12), d = r.i32(m + 16);
  return b === 0 && c === 0 && a > 0 && d > 0;
}

interface TrackInfo {
  readonly id: number;
  readonly timescale: number;
  readonly mdhdDuration: number;
  /** Media time the presentation starts at, and the empty time before it, both in the media timescale. */
  readonly editStart: number;
  readonly editDelay: number;
  readonly codec: string;
  readonly description?: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly stbl: Box;
}

function videoTrack(r: Reader, moov: Box): TrackInfo {
  const mvhd = r.need(moov, 'mvhd');
  const movieScale = r.u32(mvhd.start + (r.u8(mvhd.start) === 1 ? 20 : 12));
  for (const trak of r.children(moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = r.need(trak, 'mdia');
    const hdlr = r.need(mdia, 'hdlr');
    if (fourcc(r.bytes, hdlr.start + 8) !== 'vide') continue;
    const tkhd = r.need(trak, 'tkhd');
    if (!upright(r, tkhd)) throw new Mp4Unsupported('rotated track');
    const id = r.u32(tkhd.start + (r.u8(tkhd.start) === 1 ? 20 : 12));
    const mdhd = r.need(mdia, 'mdhd');
    const v1 = r.u8(mdhd.start) === 1;
    const timescale = r.u32(mdhd.start + (v1 ? 20 : 12));
    const mdhdDuration = v1 ? r.u64(mdhd.start + 24) : r.u32(mdhd.start + 16);
    if (!(timescale > 0)) throw new Mp4Unsupported('no timescale');
    let editStart = 0;
    let editDelay = 0;
    const elst = r.child(r.child(trak, 'edts') ?? { type: '', start: 0, end: 0 }, 'elst');
    if (elst) {
      const ev1 = r.u8(elst.start) === 1;
      const n = r.u32(elst.start + 4);
      let at = elst.start + 8;
      for (let k = 0; k < n; k++, at += ev1 ? 20 : 12) {
        const duration = ev1 ? r.u64(at) : r.u32(at);
        const mediaTime = ev1 ? r.i64(at + 8) : r.i32(at + 4);
        if (mediaTime === -1) { editDelay += movieScale > 0 ? (duration * timescale) / movieScale : 0; continue; }
        editStart = mediaTime;
        break;
      }
    }
    const stbl = r.need(r.need(mdia, 'minf'), 'stbl');
    const stsd = r.need(stbl, 'stsd');
    const entries = r.children(stsd.start + 8, stsd.end);
    const entry = entries[0];
    if (!entry) throw new Mp4Unsupported('no sample entry');
    if (entry.type === 'encv') throw new Mp4Unsupported('encrypted track');
    const { codec, description } = codecOf(r, entry);
    const width = r.u16(entry.start + 24);
    const height = r.u16(entry.start + 26);
    return { id, timescale, mdhdDuration, editStart, editDelay, codec, ...(description ? { description } : {}), width, height, stbl };
  }
  throw new Mp4Unsupported('no video track');
}

/** Decode-order samples before times are converted: offsets, sizes, decode and composition times
 *  in the media timescale, and key flags. */
interface RawSamples {
  offset: number[];
  size: number[];
  dts: number[];
  cts: number[];
  key: number[];
  /** The decode time after the last sample, where fragments continue. */
  end: number;
}

function capped(n: number, max: number): number {
  if (n > max) throw new Mp4Unsupported(`${n} samples, more than ${max}`);
  return n;
}

function stblSamples(r: Reader, stbl: Box, maxSamples: number): RawSamples {
  const stsz = r.child(stbl, 'stsz');
  const stz2 = r.child(stbl, 'stz2');
  const sizes: number[] = [];
  if (stsz) {
    const fixed = r.u32(stsz.start + 4);
    const n = capped(r.u32(stsz.start + 8), maxSamples);
    for (let k = 0; k < n; k++) sizes.push(fixed || r.u32(stsz.start + 12 + 4 * k));
  } else if (stz2) {
    const bits = r.u8(stz2.start + 7);
    if (bits !== 4 && bits !== 8 && bits !== 16) throw new Mp4Unsupported(`stz2 field size ${bits}`);
    const n = capped(r.u32(stz2.start + 8), maxSamples);
    for (let k = 0; k < n; k++) {
      const at = stz2.start + 12;
      sizes.push(bits === 16 ? r.u16(at + 2 * k) : bits === 8 ? r.u8(at + k) : (r.u8(at + (k >> 1)) >> ((k & 1) ? 0 : 4)) & 15);
    }
  } else throw new Mp4Unsupported('no stsz box');
  const n = sizes.length;

  const stco = r.child(stbl, 'stco');
  const co64 = r.child(stbl, 'co64');
  const chunks: number[] = [];
  if (stco) for (let k = 0, m = r.u32(stco.start + 4); k < m; k++) chunks.push(r.u32(stco.start + 8 + 4 * k));
  else if (co64) for (let k = 0, m = r.u32(co64.start + 4); k < m; k++) chunks.push(r.u64(co64.start + 8 + 8 * k));
  else if (n > 0) throw new Mp4Unsupported('no chunk offsets');

  const stsc = r.need(stbl, 'stsc');
  const runs: { first: number; per: number }[] = [];
  for (let k = 0, m = r.u32(stsc.start + 4); k < m; k++) runs.push({ first: r.u32(stsc.start + 8 + 12 * k), per: r.u32(stsc.start + 12 + 12 * k) });
  const offset: number[] = [];
  let sample = 0;
  let run = -1;
  for (let c = 0; c < chunks.length && sample < n; c++) {
    while (run + 1 < runs.length && runs[run + 1]!.first <= c + 1) run++;
    const per = run >= 0 ? runs[run]!.per : 0;
    let at = chunks[c]!;
    for (let k = 0; k < per && sample < n; k++, sample++) {
      offset.push(at);
      at += sizes[sample]!;
    }
  }
  if (offset.length !== n) throw new Mp4Unsupported('sample table does not cover its samples');

  const stts = r.need(stbl, 'stts');
  const dts: number[] = [];
  let t = 0;
  for (let k = 0, m = r.u32(stts.start + 4); k < m; k++) {
    const count = r.u32(stts.start + 8 + 8 * k);
    const delta = r.u32(stts.start + 12 + 8 * k);
    for (let j = 0; j < count && dts.length < n; j++) { dts.push(t); t += delta; }
  }
  while (dts.length < n) dts.push(t);

  const cts = dts.slice();
  const ctts = r.child(stbl, 'ctts');
  if (ctts) {
    let s = 0;
    for (let k = 0, m = r.u32(ctts.start + 4); k < m && s < n; k++) {
      const count = r.u32(ctts.start + 8 + 8 * k);
      // Signed in version 1; writers put negative offsets in version 0 too.
      const off = r.i32(ctts.start + 12 + 8 * k);
      for (let j = 0; j < count && s < n; j++, s++) cts[s] = dts[s]! + off;
    }
  }

  const stss = r.child(stbl, 'stss');
  const key = new Array<number>(n).fill(stss ? 0 : 1);
  if (stss) for (let k = 0, m = r.u32(stss.start + 4); k < m; k++) {
    const s = r.u32(stss.start + 8 + 4 * k) - 1;
    if (s >= 0 && s < n) key[s] = 1;
  }
  return { offset, size: sizes, dts, cts, key, end: t };
}

interface TrackDefaults { duration: number; size: number; flags: number }

/** Whether fragment sample flags mark a sample decoding can start at. */
const syncFlags = (flags: number) => (flags & 0x10000) === 0;

/** Appends the samples of track `id` in one `moof` at file offset `moofOffset`. */
function fragmentSamples(r: Reader, moof: Box, moofOffset: number, id: number, trex: TrackDefaults, out: RawSamples, maxSamples: number): void {
  for (const traf of r.children(moof.start, moof.end).filter((b) => b.type === 'traf')) {
    const tfhd = r.need(traf, 'tfhd');
    const tf = r.u32(tfhd.start) & 0xffffff;
    if (r.u32(tfhd.start + 4) !== id) continue;
    let at = tfhd.start + 8;
    let base = moofOffset;
    if (tf & 0x1) { base = r.u64(at); at += 8; }
    if (tf & 0x2) at += 4;
    let duration = trex.duration, size = trex.size, flags = trex.flags;
    if (tf & 0x8) { duration = r.u32(at); at += 4; }
    if (tf & 0x10) { size = r.u32(at); at += 4; }
    if (tf & 0x20) { flags = r.u32(at); at += 4; }
    // Without a decode time the fragment continues where the previous samples ended.
    const tfdt = r.child(traf, 'tfdt');
    if (tfdt) out.end = r.u8(tfdt.start) === 1 ? r.u64(tfdt.start + 4) : r.u32(tfdt.start + 4);
    let dataEnd = base;
    for (const trun of r.children(traf.start, traf.end).filter((b) => b.type === 'trun')) {
      const version = r.u8(trun.start);
      const rf = r.u32(trun.start) & 0xffffff;
      const n = capped(out.offset.length + r.u32(trun.start + 4), maxSamples) - out.offset.length;
      let p = trun.start + 8;
      let data = dataEnd;
      if (rf & 0x1) {
        const offset = r.i32(p);
        if (offset < 0) throw new Mp4Unsupported('negative fragment data offset');
        data = base + offset;
        p += 4;
      }
      let firstFlags: number | null = null;
      if (rf & 0x4) { firstFlags = r.u32(p); p += 4; }
      for (let k = 0; k < n; k++) {
        const d = rf & 0x100 ? r.u32((p += 4) - 4) : duration;
        const s = rf & 0x200 ? r.u32((p += 4) - 4) : size;
        const f = rf & 0x400 ? r.u32((p += 4) - 4) : k === 0 && firstFlags !== null ? firstFlags : flags;
        const c = rf & 0x800 ? (version === 0 ? r.u32((p += 4) - 4) : r.i32((p += 4) - 4)) : 0;
        out.offset.push(data);
        out.size.push(s);
        out.dts.push(out.end);
        out.cts.push(out.end + c);
        out.key.push(syncFlags(f) ? 1 : 0);
        data += s;
        out.end += d;
      }
      dataEnd = data;
    }
  }
}

/** Reads the first video track of the MP4 in `src`. Throws `Mp4Unsupported` for anything else. */
export async function readMp4VideoTrack(src: ByteSource, { maxSamples }: Mp4ReadOptions): Promise<Mp4VideoTrack> {
  const top = await topLevelBoxes(src);
  const moovBox = top.find((b) => b.type === 'moov');
  if (!moovBox) throw new Mp4Unsupported('no moov box');
  const { r, box: moov } = await readTop(src, moovBox);
  const track = videoTrack(r, moov);
  const raw = stblSamples(r, track.stbl, maxSamples);

  const mvex = r.child(moov, 'mvex');
  const moofs = top.filter((b) => b.type === 'moof');
  if (mvex && moofs.length > 0) {
    let trex: TrackDefaults = { duration: 0, size: 0, flags: 0 };
    for (const b of r.children(mvex.start, mvex.end)) {
      if (b.type === 'trex' && r.u32(b.start + 4) === track.id) trex = { duration: r.u32(b.start + 12), size: r.u32(b.start + 16), flags: r.u32(b.start + 20) };
    }
    for (const moof of moofs) {
      const f = await readTop(src, moof);
      fragmentSamples(f.r, f.box, moof.offset, track.id, trex, raw, maxSamples);
    }
  }
  const n = raw.offset.length;
  if (n === 0) throw new Mp4Unsupported('no samples');

  const samples: SampleTable = {
    count: n,
    offset: new Float64Array(raw.offset),
    size: new Uint32Array(raw.size),
    time: new Float64Array(n),
    key: new Uint8Array(raw.key),
  };
  const shift = track.editDelay - track.editStart;
  let end = 0;
  for (let k = 0; k < n; k++) {
    if (samples.offset[k]! + samples.size[k]! > src.size) throw new Mp4Unsupported('sample past the end of the file');
    samples.time[k] = Math.round(((raw.cts[k]! + shift) * 1e6) / track.timescale);
    end = Math.max(end, samples.time[k]!);
  }
  if (samples.key[0] !== 1) throw new Mp4Unsupported('the first sample is not a key frame');
  // Frames are told apart by presentation time.
  const order = Float64Array.from(samples.time).sort();
  for (let k = 1; k < n; k++) if (order[k] === order[k - 1]) throw new Mp4Unsupported('two samples share a presentation time');
  const duration = Math.max(track.mdhdDuration / track.timescale, end / 1e6);
  return { codec: track.codec, ...(track.description ? { description: track.description } : {}), codedWidth: track.width, codedHeight: track.height, duration, samples };
}
