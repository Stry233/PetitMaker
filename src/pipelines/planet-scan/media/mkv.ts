/**
 * The first video track of a Matroska or WebM file, read for WebCodecs into the same sample table
 * `mp4.ts` builds. The file is read once through windows of `SCAN_WINDOW` bytes: the EBML header,
 * the segment's `Info` and `Tracks`, then every cluster's block headers, skipping block payloads
 * that do not fit the current window. Cues are not needed: they name key frames only, while the
 * scan sees every block. Elements of unknown size, as a recorder writes while recording, are read
 * too: a segment of unknown size runs to the end of the file and a cluster of unknown size ends at
 * the next element of the segment's level. A block cut off by the end of the file ends the table.
 *
 * Supported codecs: H.264 (`V_MPEG4/ISO/AVC`), HEVC (`V_MPEGH/ISO/HEVC`), AV1 (`V_AV1`), VP9
 * (`V_VP9`) and VP8 (`V_VP8`). Laced video blocks, encoded or encrypted tracks, and a rotated
 * projection throw `VideoUnsupported`, and the caller reads the file another way.
 */
import { av1Codec, avcCodec, capped, checkSamples, hevcCodec, vp9Codec, VideoUnsupported, type ByteSource, type SampleTable, type TrackReadOptions, type VideoTrack } from './container';


const ID = {
  EBML: 0x1a45dfa3,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  ContentEncodings: 0x6d80,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Projection: 0x7670,
  ProjectionPoseRoll: 0x7675,
  Cues: 0x1c53bb6b,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Attachments: 0x1941a469,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  EncryptedBlock: 0xaf,
} as const;

/** The elements of the segment's level, any of which ends a cluster of unknown size. */
const SEGMENT_LEVEL = new Set<number>([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues, ID.Chapters, ID.Tags, ID.Attachments, ID.Cluster, ID.EBML, ID.Segment]);

/** Bytes read at once while scanning the clusters. */
export const SCAN_WINDOW = 4 << 20;
/** The largest EBML header, `Info` or `Tracks` element read whole, in bytes. */
const MAX_HEAD = 16 << 20;
/** The most elements the scan visits: an hour at 60 fps with 48 kHz AAC has about 400,000 blocks,
 *  while a file of two-byte empty elements could hold hundreds of millions. */
const MAX_ELEMENTS = 4_000_000;
/** The tracks' TrackType of video. */
const VIDEO = 1;
/** A size field with every value bit set: the element's size is unknown. */
const UNKNOWN = -1;

interface Header {
  readonly id: number;
  /** The payload's size, or `UNKNOWN`. */
  readonly size: number;
  /** The payload's file offset. */
  readonly start: number;
}

/** The length of a variable-length integer from its first byte, 0 for an invalid one. */
function vintLength(first: number): number {
  for (let n = 1; n <= 8; n++) if (first & (0x100 >> n)) return n;
  return 0;
}

/** Reads the file through one window at a time. */
class Window {
  private start = 0;
  private bytes: Uint8Array = new Uint8Array(0);

  constructor(private readonly src: ByteSource, private readonly chunk: number) {}

  has(at: number, n: number): boolean {
    return at >= this.start && at + n <= this.start + this.bytes.byteLength;
  }

  /** Makes [at, at + n) readable, as much of it as the file holds. */
  async fill(at: number, n: number): Promise<void> {
    const length = Math.min(Math.max(n, this.chunk), this.src.size - at);
    if (this.has(at, Math.min(n, length))) return;
    this.bytes = length > 0 ? await this.src.read(at, length) : new Uint8Array(0);
    this.start = at;
  }

  /** The byte at file offset `at`, which `fill` made readable. */
  byte(at: number): number {
    const b = this.bytes[at - this.start];
    if (b === undefined) throw new VideoUnsupported('truncated element');
    return b;
  }

  /** A copy of [at, at + n), which `fill` made readable. */
  slice(at: number, n: number): Uint8Array {
    if (!this.has(at, n)) throw new VideoUnsupported('truncated element');
    return this.bytes.slice(at - this.start, at - this.start + n);
  }

  /** The element header at `at`, null where the file ends inside it. */
  async header(at: number): Promise<Header | null> {
    const room = Math.min(12, this.src.size - at);
    if (room < 2) return null;
    if (!this.has(at, room)) await this.fill(at, room);
    const idLength = vintLength(this.byte(at));
    if (idLength === 0 || idLength > 4) throw new VideoUnsupported('bad element id');
    if (idLength >= room) return null;
    let id = 0;
    for (let k = 0; k < idLength; k++) id = id * 256 + this.byte(at + k);
    const sizeAt = at + idLength;
    const sizeLength = vintLength(this.byte(sizeAt));
    if (sizeLength === 0) throw new VideoUnsupported('bad element size');
    if (idLength + sizeLength > room) return null;
    let size = this.byte(sizeAt) & (0xff >> sizeLength);
    let ones = size === 0xff >> sizeLength;
    for (let k = 1; k < sizeLength; k++) {
      const b = this.byte(sizeAt + k);
      ones &&= b === 0xff;
      size = size * 256 + b;
    }
    if (!ones && !Number.isSafeInteger(size)) throw new VideoUnsupported('element too large');
    return { id, size: ones ? UNKNOWN : size, start: sizeAt + sizeLength };
  }
}

/** One element's payload in memory, for the small elements read whole. */
class Payload {
  constructor(readonly bytes: Uint8Array) {}

  /** The child elements of [start, end) as id, payload start and end. */
  children(start = 0, end = this.bytes.byteLength): { id: number; start: number; end: number }[] {
    const out: { id: number; start: number; end: number }[] = [];
    const b = this.bytes;
    let at = start;
    while (at < end) {
      const idLength = vintLength(b[at]!);
      if (idLength === 0 || idLength > 4 || at + idLength >= end) throw new VideoUnsupported('bad element id');
      let id = 0;
      for (let k = 0; k < idLength; k++) id = id * 256 + b[at + k]!;
      const sizeAt = at + idLength;
      const sizeLength = vintLength(b[sizeAt]!);
      if (sizeLength === 0 || sizeAt + sizeLength > end) throw new VideoUnsupported('bad element size');
      let size = b[sizeAt]! & (0xff >> sizeLength);
      for (let k = 1; k < sizeLength; k++) size = size * 256 + b[sizeAt + k]!;
      const from = sizeAt + sizeLength;
      if (from + size > end) throw new VideoUnsupported('element overruns its parent');
      out.push({ id, start: from, end: from + size });
      at = from + size;
    }
    return out;
  }

  uint(start: number, end: number): number {
    if (end - start > 7) throw new VideoUnsupported('integer too large');
    let v = 0;
    for (let k = start; k < end; k++) v = v * 256 + this.bytes[k]!;
    return v;
  }

  float(start: number, end: number): number {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + start, end - start);
    if (end - start === 4) return view.getFloat32(0);
    if (end - start === 8) return view.getFloat64(0);
    if (end === start) return 0;
    throw new VideoUnsupported('bad float');
  }

  text(start: number, end: number): string {
    let s = '';
    for (let k = start; k < end && this.bytes[k] !== 0; k++) s += String.fromCharCode(this.bytes[k]!);
    return s;
  }
}

async function readWhole(w: Window, h: Header, what: string): Promise<Payload> {
  if (h.size === UNKNOWN || h.size > MAX_HEAD) throw new VideoUnsupported(`${what} too large`);
  await w.fill(h.start, h.size);
  return new Payload(w.slice(h.start, h.size));
}

function checkEbmlHeader(p: Payload): void {
  let docType = '';
  for (const c of p.children()) {
    const v = () => p.uint(c.start, c.end);
    if (c.id === ID.DocType) docType = p.text(c.start, c.end);
    else if (c.id === ID.EBMLReadVersion && v() > 1) throw new VideoUnsupported('EBML read version');
    else if (c.id === ID.DocTypeReadVersion && v() > 4) throw new VideoUnsupported('Matroska read version');
    else if (c.id === ID.EBMLMaxIDLength && v() > 4) throw new VideoUnsupported('EBML id length');
    else if (c.id === ID.EBMLMaxSizeLength && v() > 8) throw new VideoUnsupported('EBML size length');
  }
  if (docType !== 'matroska' && docType !== 'webm') throw new VideoUnsupported(`document type ${docType || 'missing'}`);
}

interface TrackHead {
  readonly number: number;
  readonly codecId: string;
  readonly codecPrivate?: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** The first video track of a `Tracks` element. */
function videoTrackOf(p: Payload): TrackHead {
  for (const entry of p.children()) {
    if (entry.id !== ID.TrackEntry) continue;
    const fields = p.children(entry.start, entry.end);
    const field = (id: number) => fields.find((c) => c.id === id);
    const type = field(ID.TrackType);
    if (!type || p.uint(type.start, type.end) !== VIDEO) continue;
    if (field(ID.ContentEncodings)) throw new VideoUnsupported('encoded track');
    const number = field(ID.TrackNumber);
    const codec = field(ID.CodecID);
    if (!number || !codec) throw new VideoUnsupported('incomplete track entry');
    const priv = field(ID.CodecPrivate);
    let width = 0;
    let height = 0;
    const video = field(ID.Video);
    if (video) {
      for (const c of p.children(video.start, video.end)) {
        if (c.id === ID.PixelWidth) width = p.uint(c.start, c.end);
        else if (c.id === ID.PixelHeight) height = p.uint(c.start, c.end);
        else if (c.id === ID.Projection) {
          for (const q of p.children(c.start, c.end)) if (q.id === ID.ProjectionPoseRoll && p.float(q.start, q.end) !== 0) throw new VideoUnsupported('rotated track');
        }
      }
    }
    if (!(width > 0 && height > 0)) throw new VideoUnsupported('no picture size');
    return {
      number: p.uint(number.start, number.end),
      codecId: p.text(codec.start, codec.end),
      ...(priv && priv.end > priv.start ? { codecPrivate: p.bytes.slice(priv.start, priv.end) } : {}),
      width,
      height,
    };
  }
  throw new VideoUnsupported('no video track');
}

/** The profile and bit depth in a VP9 key frame's uncompressed header, null if it shows none. */
export function vp9FrameProfile(frame: Uint8Array): { profile: number; depth: number } | null {
  let bit = 0;
  const read = (n: number) => {
    let v = 0;
    for (let k = 0; k < n; k++, bit++) {
      const byte = frame[bit >> 3];
      if (byte === undefined) throw new VideoUnsupported('short VP9 frame');
      v = (v << 1) | ((byte >> (7 - (bit & 7))) & 1);
    }
    return v;
  };
  try {
    if (read(2) !== 2) return null;
    const low = read(1);
    const profile = (read(1) << 1) | low;
    if (profile === 3) read(1);
    if (read(1)) return null; // show_existing_frame
    if (read(1) !== 0) return null; // not a key frame
    read(2); // show_frame, error_resilient_mode
    if (read(24) !== 0x498342) return null;
    return { profile, depth: profile >= 2 ? (read(1) ? 12 : 10) : 8 };
  } catch {
    return null;
  }
}

/** The VP9 codec string from Matroska's CodecPrivate features (profile 1, level 2, bit depth 3),
 *  else from the first key frame. */
function vp9CodecOf(priv: Uint8Array | undefined, firstFrame: Uint8Array): string {
  let profile: number | undefined;
  let level = 10;
  let depth: number | undefined;
  if (priv) {
    for (let at = 0; at + 2 <= priv.byteLength;) {
      const id = priv[at]!;
      const length = priv[at + 1]!;
      const value = priv[at + 2];
      if (length === 1 && value !== undefined) {
        if (id === 1) profile = value;
        else if (id === 2) level = value;
        else if (id === 3) depth = value;
      }
      at += 2 + length;
    }
  }
  if (profile === undefined || depth === undefined) {
    const seen = vp9FrameProfile(firstFrame);
    if (!seen) throw new VideoUnsupported('no VP9 profile');
    profile ??= seen.profile;
    depth ??= seen.depth;
  }
  return vp9Codec(profile, level, depth);
}

/** The codec string and description of `track`; the first frame names a VP9 profile CodecPrivate leaves out. */
function codecOf(
  track: TrackHead, firstFrame: () => Promise<Uint8Array>,
): Promise<{ codec: string; description?: Uint8Array }> | { codec: string; description?: Uint8Array } {
  const priv = track.codecPrivate;
  switch (track.codecId) {
    case 'V_MPEG4/ISO/AVC': {
      if (!priv) throw new VideoUnsupported('no avcC record');
      // A record without parameter sets leaves them in band, as an avc3 stream carries them.
      const { codec, parameterSets } = avcCodec('avc1', priv);
      return parameterSets ? { codec, description: priv } : { codec: avcCodec('avc3', priv).codec };
    }
    case 'V_MPEGH/ISO/HEVC': {
      if (!priv) throw new VideoUnsupported('no hvcC record');
      // The record's parameter set arrays follow its 23 fixed bytes.
      return (priv[22] ?? 0) > 0 ? { codec: hevcCodec('hvc1', priv), description: priv } : { codec: hevcCodec('hev1', priv) };
    }
    case 'V_AV1':
      if (!priv) throw new VideoUnsupported('no av1C record');
      return { codec: av1Codec(priv), description: priv };
    case 'V_VP9':
      return firstFrame().then((frame) => ({ codec: vp9CodecOf(priv, frame) }));
    case 'V_VP8':
      return { codec: 'vp8' };
    default:
      throw new VideoUnsupported(`codec ${track.codecId}`);
  }
}

/** A sample table grown as the clusters are scanned, its times in segment ticks until `finish`. */
class Samples {
  count = 0;
  offset = new Float64Array(1024);
  size = new Uint32Array(1024);
  time = new Float64Array(1024);
  key = new Uint8Array(1024);

  constructor(private readonly max: number) {}

  push(offset: number, size: number, ticks: number, key: boolean): void {
    capped(this.count + 1, this.max);
    if (this.count === this.offset.length) {
      const n = Math.min(this.max, this.count * 2);
      const grow = <T extends Float64Array | Uint32Array | Uint8Array>(a: T, make: (n: number) => T): T => { const b = make(n); b.set(a); return b; };
      this.offset = grow(this.offset, (m) => new Float64Array(m));
      this.size = grow(this.size, (m) => new Uint32Array(m));
      this.time = grow(this.time, (m) => new Float64Array(m));
      this.key = grow(this.key, (m) => new Uint8Array(m));
    }
    const k = this.count++;
    this.offset[k] = offset;
    this.size[k] = size;
    this.time[k] = ticks;
    this.key[k] = key ? 1 : 0;
  }

  /** The table with times in microseconds, `scale` nanoseconds a tick. */
  finish(scale: number): SampleTable {
    const n = this.count;
    const time = this.time.slice(0, n);
    for (let k = 0; k < n; k++) time[k] = Math.round((time[k]! * scale) / 1000);
    return { count: n, offset: this.offset.slice(0, n), size: this.size.slice(0, n), time, key: this.key.slice(0, n) };
  }
}

/** A block's header: its track, timestamp relative to the cluster, flags and payload start. */
async function blockHeader(w: Window, h: Header): Promise<{ track: number; relative: number; flags: number; data: number }> {
  const n = Math.min(h.size, 11);
  if (!w.has(h.start, n)) await w.fill(h.start, n);
  const trackLength = vintLength(w.byte(h.start));
  if (trackLength === 0 || trackLength + 3 > h.size) throw new VideoUnsupported('bad block');
  let track = w.byte(h.start) & (0xff >> trackLength);
  for (let k = 1; k < trackLength; k++) track = track * 256 + w.byte(h.start + k);
  const at = h.start + trackLength;
  const relative = ((w.byte(at) << 24) >> 16) | w.byte(at + 1);
  return { track, relative, flags: w.byte(at + 2), data: at + 3 };
}

/** Reads the first video track of the Matroska or WebM file in `src`. Throws `VideoUnsupported`
 *  for anything else. */
export async function readMkvVideoTrack(src: ByteSource, { maxSamples }: TrackReadOptions): Promise<VideoTrack> {
  const w = new Window(src, SCAN_WINDOW);
  const ebml = await w.header(0);
  if (!ebml || ebml.id !== ID.EBML) throw new VideoUnsupported('not a Matroska file');
  checkEbmlHeader(await readWhole(w, ebml, 'EBML header'));

  let elements = 0;
  const visit = () => { if (++elements > MAX_ELEMENTS) throw new VideoUnsupported('too many elements'); };

  let at = ebml.start + ebml.size;
  let segment: Header | null = null;
  while (!segment) {
    visit();
    const h = await w.header(at);
    if (!h) throw new VideoUnsupported('no segment');
    if (h.id === ID.Segment) segment = h;
    else if (h.size === UNKNOWN) throw new VideoUnsupported('unknown-size element');
    else at = h.start + h.size;
  }
  const segmentEnd = segment.size === UNKNOWN ? src.size : Math.min(src.size, segment.start + segment.size);

  let scale = 1_000_000;
  let infoDuration = 0;
  let track: TrackHead | null = null;
  const samples = new Samples(maxSamples);
  let truncated = false;

  /** Scans the cluster `cluster` and returns the offset after it. */
  const scanCluster = async (cluster: Header): Promise<number> => {
    if (!track) throw new VideoUnsupported('a cluster before the tracks');
    const open = cluster.size === UNKNOWN;
    const end = open ? segmentEnd : cluster.start + cluster.size;
    let clusterTime: number | null = null;
    let p = cluster.start;
    while (p < end) {
      visit();
      const h = await w.header(p);
      if (!h) { truncated = true; return src.size; }
      if (open && SEGMENT_LEVEL.has(h.id)) return p;
      if (h.size === UNKNOWN) throw new VideoUnsupported('unknown-size element in a cluster');
      const next = h.start + h.size;
      if (next > src.size) { truncated = true; return src.size; }
      if (next > end) throw new VideoUnsupported('element overruns its cluster');
      if (h.id === ID.Timestamp) {
        if (h.size > 7) throw new VideoUnsupported('bad cluster timestamp');
        await w.fill(h.start, h.size);
        clusterTime = new Payload(w.slice(h.start, h.size)).uint(0, h.size);
      } else if (h.id === ID.SimpleBlock || h.id === ID.BlockGroup) {
        let block: Header | null = h.id === ID.SimpleBlock ? h : null;
        let referenced = false;
        if (h.id === ID.BlockGroup) {
          for (let q = h.start; q < next;) {
            visit();
            const c = await w.header(q);
            if (!c || c.size === UNKNOWN || c.start + c.size > next) throw new VideoUnsupported('bad block group');
            if (c.id === ID.Block) block = c;
            else if (c.id === ID.ReferenceBlock) referenced = true;
            else if (c.id === ID.EncryptedBlock) throw new VideoUnsupported('encrypted block');
            q = c.start + c.size;
          }
        }
        if (block) {
          const b = await blockHeader(w, block);
          if (b.track === track.number) {
            if (b.flags & 0x06) throw new VideoUnsupported('laced video frames');
            if (clusterTime === null) throw new VideoUnsupported('a block before its cluster timestamp');
            const key = h.id === ID.SimpleBlock ? (b.flags & 0x80) !== 0 : !referenced;
            samples.push(b.data, block.start + block.size - b.data, clusterTime + b.relative, key);
          }
        }
      }
      p = next;
    }
    return end;
  };

  at = segment.start;
  while (at < segmentEnd && !truncated) {
    visit();
    const h = await w.header(at);
    if (!h) break;
    if (h.id === ID.Cluster) { at = await scanCluster(h); continue; }
    if (h.size === UNKNOWN) throw new VideoUnsupported('unknown-size element');
    if (h.id === ID.Info) {
      const p = await readWhole(w, h, 'Info');
      for (const c of p.children()) {
        if (c.id === ID.TimestampScale) scale = p.uint(c.start, c.end);
        else if (c.id === ID.Duration) infoDuration = p.float(c.start, c.end);
      }
      if (!(scale > 0)) throw new VideoUnsupported('no timestamp scale');
    } else if (h.id === ID.Tracks && !track) {
      track = videoTrackOf(await readWhole(w, h, 'Tracks'));
    }
    at = h.start + h.size;
  }
  if (!track) throw new VideoUnsupported('no video track');
  const table = samples.finish(scale);
  if (table.count === 0) throw new VideoUnsupported('no samples');
  const head = track;
  const { codec, description } = await codecOf(head, async () => {
    const n = Math.min(table.size[0]!, 64);
    return src.read(table.offset[0]!, n);
  });
  const end = checkSamples(table, src.size);
  const duration = Math.max((infoDuration * scale) / 1e9, end / 1e6);
  return { codec, ...(description ? { description } : {}), codedWidth: head.width, codedHeight: head.height, duration, samples: table };
}
