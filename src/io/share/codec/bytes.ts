// Minimal little-endian byte writer and reader for payload frames and their records.
import { ImportError } from '../../save/import-error';

export class ByteWriter {
  private out: number[] = [];
  u8(v: number): void { this.out.push(v & 0xff); }
  u16(v: number): void { this.out.push(v & 0xff, (v >>> 8) & 0xff); }
  /** Two's complement in 16 bits. */
  i16(v: number): void { this.u16(v & 0xffff); }
  u32(v: number): void {
    this.out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  raw(bytes: Uint8Array): void { for (let i = 0; i < bytes.length; i++) this.out.push(bytes[i]! & 0xff); }
  /** u8 length prefix + utf8 bytes. Throws if the encoded string exceeds 255 bytes. */
  str8(s: string): void {
    const b = new TextEncoder().encode(s);
    if (b.length > 0xff) throw new Error('payload: string exceeds u8 length prefix');
    this.u8(b.length);
    this.raw(b);
  }
  /** u16 length prefix + utf8 bytes. */
  str16(s: string): void { this.blob16(new TextEncoder().encode(s)); }
  /** u8 length prefix + raw bytes. */
  blob8(b: Uint8Array): void {
    if (b.length > 0xff) throw new Error('payload: blob exceeds u8 length prefix');
    this.u8(b.length);
    this.raw(b);
  }
  /** u16 length prefix + raw bytes. */
  blob16(b: Uint8Array): void {
    if (b.length > 0xffff) throw new Error('payload: blob exceeds u16 length prefix');
    this.u16(b.length);
    this.raw(b);
  }
  toBytes(): Uint8Array { return Uint8Array.from(this.out); }
}

export class ByteReader {
  private pos = 0;
  constructor(private buf: Uint8Array) {}
  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new ImportError('decode-failed', 'Payload ends unexpectedly.');
  }
  u8(): number { this.need(1); return this.buf[this.pos++]!; }
  u16(): number {
    this.need(2);
    const v = this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8);
    this.pos += 2;
    return v >>> 0;
  }
  i16(): number { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  u32(): number {
    this.need(4);
    const v = (this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8) | (this.buf[this.pos + 2]! << 16) | (this.buf[this.pos + 3]! << 24)) >>> 0;
    this.pos += 4;
    return v;
  }
  raw(n: number): Uint8Array { this.need(n); const out = this.buf.slice(this.pos, this.pos + n); this.pos += n; return out; }
  str8(): string { const len = this.u8(); return new TextDecoder().decode(this.raw(len)); }
  str16(): string { return new TextDecoder().decode(this.blob16()); }
  blob8(): Uint8Array { const len = this.u8(); return this.raw(len); }
  blob16(): Uint8Array { const len = this.u16(); return this.raw(len); }
  rest(): Uint8Array { const out = this.buf.slice(this.pos); this.pos = this.buf.length; return out; }
}
