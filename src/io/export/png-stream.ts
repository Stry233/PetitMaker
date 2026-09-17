/**
 * A PNG written a band of rows at a time, so an image larger than any canvas the device can hold
 * is still one file. Rows are filtered as they arrive and compressed by a streaming zlib; the file
 * keeps only its compressed bytes, never the whole picture.
 */
import { Zlib } from 'fflate';
import { crc32 } from '../share/crypto/crc32';

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/** Filter types tried per band: None, Sub, Up, Paeth. Average rarely wins on flat art. */
const FILTERS = [0, 1, 2, 4] as const;
/** Rows a band's filter is chosen on; the winner filters the whole band. */
const SAMPLE_ROWS = 8;
const BPP = 4;

function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

/** One chunk: length, type, data, and the CRC over type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(be32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(be32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
}

/** 8-bit RGBA, no interlace. */
function ihdr(width: number, height: number): Uint8Array {
  const out = new Uint8Array(13);
  out.set(be32(width), 0);
  out.set(be32(height), 4);
  out[8] = 8; out[9] = 6; out[10] = 0; out[11] = 0; out[12] = 0;
  return out;
}

/** Writes `row` filtered by `type` into `out`; `prev` is the unfiltered row above, or null on the first row. */
function filterRow(type: number, row: Uint8Array, prev: Uint8Array | null, out: Uint8Array): void {
  for (let i = 0; i < row.length; i++) {
    const a = i >= BPP ? row[i - BPP]! : 0;
    const b = prev ? prev[i]! : 0;
    let pred = 0;
    if (type === 1) pred = a;
    else if (type === 2) pred = b;
    else if (type === 4) {
      const c = prev && i >= BPP ? prev[i - BPP]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i] = (row[i]! - pred) & 255;
  }
}

export class PngStream {
  private readonly stride: number;
  private rowsDone = 0;
  /** The last row written, unfiltered: the next band's first row predicts from it. */
  private prev: Uint8Array | null = null;
  private readonly parts: Uint8Array[] = [];
  private readonly zlib: Zlib;
  private finished = false;

  constructor(readonly width: number, readonly height: number, opts: { level?: number } = {}) {
    if (!(width > 0 && height > 0)) throw new RangeError('a PNG needs a positive size');
    this.stride = width * BPP;
    this.parts.push(SIGNATURE, chunk('IHDR', ihdr(width, height)));
    this.zlib = new Zlib({ level: (opts.level ?? 6) as 6 });
    this.zlib.ondata = (data) => { if (data.length) this.parts.push(chunk('IDAT', data)); };
  }

  /** Appends `rows` scanlines of RGBA from the start of `rgba`. The buffer may be reused afterwards. */
  addRows(rgba: Uint8Array | Uint8ClampedArray, rows: number): void {
    if (this.finished) throw new Error('the PNG is finished');
    if (rgba.length < rows * this.stride) throw new RangeError('fewer bytes than rows');
    if (this.rowsDone + rows > this.height) throw new RangeError('more rows than the height');
    const src = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const type = this.chooseFilter(src, rows);
    const line = this.stride + 1;
    const out = new Uint8Array(rows * line);
    let prev = this.prev;
    for (let y = 0; y < rows; y++) {
      const row = src.subarray(y * this.stride, (y + 1) * this.stride);
      out[y * line] = type;
      filterRow(type, row, prev, out.subarray(y * line + 1, (y + 1) * line));
      prev = row;
    }
    this.prev = prev ? prev.slice() : null;
    this.rowsDone += rows;
    this.zlib.push(out, false);
  }

  /** Closes the stream. Every announced row must have arrived. */
  finish(): Blob {
    if (this.rowsDone !== this.height) throw new Error(`${this.rowsDone} of ${this.height} rows written`);
    this.finished = true;
    this.zlib.push(new Uint8Array(0), true);
    this.parts.push(chunk('IEND', new Uint8Array(0)));
    return new Blob(this.parts as BlobPart[], { type: 'image/png' });
  }

  /** The PNG reference heuristic, the sum of absolute signed residuals, over the band's first rows. */
  private chooseFilter(src: Uint8Array, rows: number): number {
    const sample = Math.min(rows, SAMPLE_ROWS);
    const scratch = new Uint8Array(this.stride);
    let best = 0;
    let bestCost = Infinity;
    for (const type of FILTERS) {
      let cost = 0;
      let prev = this.prev;
      for (let y = 0; y < sample && cost < bestCost; y++) {
        const row = src.subarray(y * this.stride, (y + 1) * this.stride);
        filterRow(type, row, prev, scratch);
        for (let i = 0; i < scratch.length; i++) { const v = scratch[i]!; cost += v < 128 ? v : 256 - v; }
        prev = row;
      }
      if (cost < bestCost) { bestCost = cost; best = type; }
    }
    return best;
  }
}
