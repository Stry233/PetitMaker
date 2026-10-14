import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VideoUnsupported, type ByteSource, type VideoTrack } from '../../../../pipelines/planet-scan/media/container';
import { readVideoTrack } from '../../../../pipelines/planet-scan/media/demux';

const DIR = join(__dirname, '../../../fixtures/mp4');
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(DIR, name)));

function source(bytes: Uint8Array): ByteSource {
  return { size: bytes.byteLength, read: async (offset, length) => bytes.slice(offset, Math.min(bytes.byteLength, offset + length)) };
}

async function outcome(bytes: Uint8Array): Promise<VideoTrack | VideoUnsupported> {
  try {
    return await readVideoTrack(source(bytes), { maxSamples: 100_000 });
  } catch (e) {
    expect(e, `a ${bytes.byteLength}-byte file`).toBeInstanceOf(VideoUnsupported);
    return e as VideoUnsupported;
  }
}

describe('damaged recordings', () => {
  it.each([[0], [1], [3], [4], [8], [16]])('a %s-byte file is left to playback', async (n) => {
    expect(await outcome(fixture('avc-faststart.mov').slice(0, n))).toBeInstanceOf(VideoUnsupported);
    expect(await outcome(new Uint8Array(n).fill(0xff))).toBeInstanceOf(VideoUnsupported);
  });

  it.each(['avc-faststart.mov', 'avc-bframes.mp4', 'avc-fragmented.mp4', 'hevc.mp4'])(
    '%s cut anywhere is refused or reads only samples inside what is left', async (name) => {
      const bytes = fixture(name);
      const cuts = new Set([24, 64, 256, 1024, ...[0.1, 0.25, 0.5, 0.75, 0.9, 0.99].map((f) => Math.floor(bytes.byteLength * f)), bytes.byteLength - 1]);
      for (const cut of cuts) {
        const result = await outcome(bytes.slice(0, cut));
        if (result instanceof VideoUnsupported) continue;
        const { samples } = result;
        expect(samples.count, `${name} cut at ${cut}`).toBeGreaterThan(0);
        for (let i = 0; i < samples.count; i++) {
          expect(samples.offset[i]! + samples.size[i]!, `${name} cut at ${cut}, sample ${i}`).toBeLessThanOrEqual(cut);
        }
      }
    });

  it('an EBML header with nothing after it is left to playback', async () => {
    expect(await outcome(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBeInstanceOf(VideoUnsupported);
    expect(await outcome(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff]))).toBeInstanceOf(VideoUnsupported);
  });

  it('a box claiming more bytes than the file holds is refused without reading them', async () => {
    const box = new Uint8Array(16);
    const view = new DataView(box.buffer);
    view.setUint32(0, 1); // 64-bit size follows
    box.set([0x6d, 0x6f, 0x6f, 0x76], 4); // 'moov'
    view.setUint32(8, 0x7fffffff); view.setUint32(12, 0xffffffff);
    let largest = 0;
    const src: ByteSource = {
      size: box.byteLength, read: async (offset, length) => { largest = Math.max(largest, length); return box.slice(offset, offset + length); },
    };
    await expect(readVideoTrack(src, { maxSamples: 1000 })).rejects.toBeInstanceOf(VideoUnsupported);
    expect(largest).toBeLessThanOrEqual(box.byteLength);
  });
});
