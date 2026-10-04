/**
 * What a container reader (`mp4.ts`, `mkv.ts`) hands the WebCodecs decoder: the first video
 * track's codec string and decoder configuration, and every sample's byte range, presentation time
 * and key flag in decode order. Also the codec strings both readers build from the same
 * configuration records, and the checks every sample table passes.
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

/** The file is not one a container reader can hand to WebCodecs; the caller reads it another way. */
export class VideoUnsupported extends Error {
  constructor(readonly why: string) {
    super(`unsupported video file: ${why}`);
    this.name = 'VideoUnsupported';
  }
}

/** A video track's samples in decode order. Times are presentation times in whole microseconds. */
export interface SampleTable {
  readonly count: number;
  readonly offset: Float64Array;
  readonly size: Uint32Array;
  readonly time: Float64Array;
  /** 1 for a sample decoding can start at. */
  readonly key: Uint8Array;
}

export interface VideoTrack {
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

export interface TrackReadOptions {
  /** Tracks with more samples are refused before their tables are expanded. */
  readonly maxSamples: number;
}

export function capped(n: number, max: number): number {
  if (n > max) throw new VideoUnsupported(`${n} samples, more than ${max}`);
  return n;
}

/** Checks a finished sample table against a file of `fileSize` bytes and returns its last
 *  presentation time in microseconds. */
export function checkSamples(samples: SampleTable, fileSize: number): number {
  const n = samples.count;
  if (n === 0) throw new VideoUnsupported('no samples');
  let end = -Infinity;
  for (let k = 0; k < n; k++) {
    if (samples.offset[k]! + samples.size[k]! > fileSize) throw new VideoUnsupported('sample past the end of the file');
    end = Math.max(end, samples.time[k]!);
  }
  if (samples.key[0] !== 1) throw new VideoUnsupported('the first sample is not a key frame');
  // Frames are told apart by presentation time.
  const order = samples.time.slice(0, n).sort();
  for (let k = 1; k < n; k++) if (order[k] === order[k - 1]) throw new VideoUnsupported('two samples share a presentation time');
  return end;
}

const hex = (n: number, digits = 2) => n.toString(16).toUpperCase().padStart(digits, '0');
const dec = (n: number) => String(n).padStart(2, '0');

function need(record: Uint8Array, length: number, what: string): void {
  if (record.byteLength < length) throw new VideoUnsupported(`short ${what} record`);
}

/** Reverses the 32 bits of `n`, as the HEVC codec string writes the compatibility flags. */
function reverseBits32(n: number): number {
  let out = 0;
  for (let k = 0; k < 32; k++) { out = (out * 2) + (n & 1); n >>>= 1; }
  return out;
}

/** The codec string of an `AVCDecoderConfigurationRecord` under `fourcc` (`avc1` or `avc3`), and
 *  whether the record carries parameter sets; one without configures nothing. */
export function avcCodec(fourcc: string, record: Uint8Array): { codec: string; parameterSets: boolean } {
  need(record, 6, 'avcC');
  return { codec: `${fourcc}.${hex(record[1]!)}${hex(record[2]!)}${hex(record[3]!)}`, parameterSets: (record[5]! & 31) > 0 };
}

/** The codec string of an `HEVCDecoderConfigurationRecord` under `fourcc` (`hvc1` or `hev1`). */
export function hevcCodec(fourcc: string, record: Uint8Array): string {
  need(record, 13, 'hvcC');
  const b1 = record[1]!;
  const space = ['', 'A', 'B', 'C'][b1 >> 6]!;
  const tier = (b1 >> 5) & 1 ? 'H' : 'L';
  const flags = ((record[2]! << 24) | (record[3]! << 16) | (record[4]! << 8) | record[5]!) >>> 0;
  const compat = reverseBits32(flags).toString(16).toUpperCase();
  const constraints = Array.from(record.subarray(6, 12));
  while (constraints.length > 0 && constraints[constraints.length - 1] === 0) constraints.pop();
  const tail = constraints.map((v) => `.${hex(v)}`).join('');
  return `${fourcc}.${space}${b1 & 31}.${compat}.${tier}${record[12]!}${tail}`;
}

/** The codec string of an `AV1CodecConfigurationRecord`. */
export function av1Codec(record: Uint8Array): string {
  need(record, 4, 'av1C');
  const b1 = record[1]!;
  const b2 = record[2]!;
  const depth = (b2 & 0x40) ? ((b2 & 0x20) ? 12 : 10) : 8;
  return `av01.${b1 >> 5}.${dec(b1 & 31)}${(b2 & 0x80) ? 'H' : 'M'}.${dec(depth)}`;
}

export const vp9Codec = (profile: number, level: number, depth: number) => `vp09.${dec(profile)}.${dec(level)}.${dec(depth)}`;
