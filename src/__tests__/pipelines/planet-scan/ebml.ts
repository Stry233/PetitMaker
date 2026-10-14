/**
 * Matroska files built in code for the demuxer's tests: EBML elements with known or unknown sizes,
 * blocks, and a whole file from a track list and clusters.
 */

export type Bytes = number[];

/** An element id's bytes; ids keep their length marker, so the number's bytes are the id. */
function idBytes(id: number): Bytes {
  const out: Bytes = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return out;
}

/** `n` as an EBML size of `length` bytes (the shortest that holds it when omitted). */
export function vint(n: number, length?: number): Bytes {
  let len = length ?? 1;
  while (length === undefined && n >= 2 ** (7 * len) - 1) len++;
  const out: Bytes = [];
  let v = n;
  for (let k = 0; k < len; k++) { out.unshift(v % 256); v = Math.floor(v / 256); }
  out[0]! |= 0x100 >> len;
  return out;
}

/** The 8-byte size of an element whose size is unknown. */
export const UNKNOWN_SIZE: Bytes = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

export function el(id: number, ...parts: Bytes[]): Bytes {
  const body = parts.flat();
  return [...idBytes(id), ...vint(body.length), ...body];
}

/** An element with an unknown size, as a recorder writes it before it knows the size. */
export function open(id: number, ...parts: Bytes[]): Bytes {
  return [...idBytes(id), ...UNKNOWN_SIZE, ...parts.flat()];
}

/** An element whose header states `size` whatever follows. */
export function claimed(id: number, size: Bytes, ...parts: Bytes[]): Bytes {
  return [...idBytes(id), ...size, ...parts.flat()];
}

export function uint(n: number): Bytes {
  const out: Bytes = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return out.length ? out : [0];
}

export function float64(x: number): Bytes {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return Array.from(new Uint8Array(view.buffer));
}

export const str = (s: string): Bytes => [...s].map((c) => c.charCodeAt(0));

export const ID = {
  EBML: 0x1a45dfa3, DocType: 0x4282, DocTypeReadVersion: 0x4285, EBMLReadVersion: 0x42f7,
  Segment: 0x18538067, SeekHead: 0x114d9b74, Void: 0xec,
  Info: 0x1549a966, TimestampScale: 0x2ad7b1, Duration: 0x4489,
  Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2,
  ContentEncodings: 0x6d80, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Projection: 0x7670, ProjectionPoseRoll: 0x7675,
  Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3,
  Cluster: 0x1f43b675, Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb, BlockDuration: 0x9b,
  Tags: 0x1254c367,
} as const;

/** A block's body: track number, timestamp relative to the cluster, flags, then the frame. */
export function blockBody(track: number, relative: number, flags: number, frame: Bytes): Bytes {
  return [...vint(track), (relative >> 8) & 255, relative & 255, flags, ...frame];
}

/** A SimpleBlock; key frames set the flag's top bit. */
export const simpleBlock = (track: number, relative: number, key: boolean, frame: Bytes, flags = 0): Bytes =>
  el(ID.SimpleBlock, blockBody(track, relative, (key ? 0x80 : 0) | flags, frame));

/** A BlockGroup, a delta frame when `reference` (relative ticks of the frame it refers to) is given. */
export const blockGroup = (track: number, relative: number, frame: Bytes, reference?: number): Bytes =>
  el(
    ID.BlockGroup, el(ID.Block, blockBody(track, relative, 0, frame)), el(ID.BlockDuration, uint(1)),
    reference === undefined ? [] : el(ID.ReferenceBlock, [(reference >> 8) & 255, reference & 255]),
  );

export interface TrackSpec {
  number: number;
  /** 1 video, 2 audio. */
  type?: number;
  codec?: string;
  codecPrivate?: Bytes;
  width?: number;
  height?: number;
  extra?: Bytes;
  videoExtra?: Bytes;
}

export const avcC: Bytes = [1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80];

export function trackEntry(t: TrackSpec): Bytes {
  const video = (t.type ?? 1) === 1;
  const codec = t.codec ?? (video ? 'V_MPEG4/ISO/AVC' : 'A_AAC');
  const priv = t.codecPrivate ?? (codec === 'V_MPEG4/ISO/AVC' ? avcC : undefined);
  return el(ID.TrackEntry,
    el(ID.TrackNumber, uint(t.number)),
    el(ID.TrackType, uint(t.type ?? 1)),
    el(ID.CodecID, str(codec)),
    priv ? el(ID.CodecPrivate, priv) : [],
    video ? el(ID.Video, el(ID.PixelWidth, uint(t.width ?? 1920)), el(ID.PixelHeight, uint(t.height ?? 1080)), t.videoExtra ?? []) : [],
    t.extra ?? []);
}

export interface FileSpec {
  docType?: string;
  /** Nanoseconds a tick; omitted, the default of 1 ms. */
  scale?: number;
  /** In ticks. */
  duration?: number;
  tracks?: TrackSpec[];
  /** Each cluster's bytes, from `cluster` or `openCluster`. */
  clusters: Bytes[];
  /** Elements before the tracks (a seek head, voids). */
  before?: Bytes;
  /** Elements after the clusters (cues, tags). */
  after?: Bytes;
  /** A segment of unknown size, as a recorder writes while recording. */
  openSegment?: boolean;
  /** Tracks after the first cluster. */
  tracksLast?: boolean;
}

export const cluster = (timestamp: number, ...blocks: Bytes[]): Bytes => el(ID.Cluster, el(ID.Timestamp, uint(timestamp)), ...blocks);
export const openCluster = (timestamp: number, ...blocks: Bytes[]): Bytes => open(ID.Cluster, el(ID.Timestamp, uint(timestamp)), ...blocks);

export const ebmlHeader = (docType = 'matroska'): Bytes => el(ID.EBML, el(ID.EBMLReadVersion, [1]), el(ID.DocType, str(docType)), el(ID.DocTypeReadVersion, [2]));

export function mkvFile(spec: FileSpec): Uint8Array<ArrayBuffer> {
  const info = el(
    ID.Info, spec.scale === undefined ? [] : el(ID.TimestampScale, uint(spec.scale)),
    spec.duration === undefined ? [] : el(ID.Duration, float64(spec.duration)),
  );
  const tracks = el(ID.Tracks, ...(spec.tracks ?? [{ number: 1 }]).map(trackEntry));
  const body = spec.tracksLast
    ? [...(spec.before ?? []), ...info, ...spec.clusters.flat(), ...tracks, ...(spec.after ?? [])]
    : [...(spec.before ?? []), ...info, ...tracks, ...spec.clusters.flat(), ...(spec.after ?? [])];
  const segment = spec.openSegment ? open(ID.Segment, body) : el(ID.Segment, body);
  return new Uint8Array([...ebmlHeader(spec.docType), ...segment]);
}

/** A frame of `n` bytes all `fill`, so a sample's bytes show which frame it is. */
export const frame = (fill: number, n = 6): Bytes => new Array<number>(n).fill(fill);
