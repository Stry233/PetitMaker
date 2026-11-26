// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { pngSize } from '../../../../io/share';
import { PngStream } from '../../../../io/export/png-stream';

function streamed(width: number, height: number): Blob {
  const png = new PngStream(width, height);
  png.addRows(new Uint8Array(width * height * 4), height);
  return png.finish();
}

describe('PNG header size', () => {
  it('reads the size a written PNG names', async () => {
    expect(await pngSize(streamed(7, 3))).toEqual({ width: 7, height: 3 });
  });

  it('names no size for other bytes, a cut header or a zero width', async () => {
    const bytes = new Uint8Array(await streamed(7, 3).arrayBuffer());
    expect(await pngSize(new Blob([new Uint8Array(24).fill(1)]))).toBeNull();
    expect(await pngSize(new Blob([bytes.slice(0, 20)]))).toBeNull();
    const zero = bytes.slice();
    zero.fill(0, 16, 20);
    expect(await pngSize(new Blob([zero]))).toBeNull();
  });
});
