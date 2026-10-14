import { describe, expect, it, vi } from 'vitest';
import { importFromRaster } from '../../../io/share/import';

vi.mock('../../../io/share/glyph/decode-async', () => ({
  decodeGlyphAsync: async () => { throw new TypeError('reader fault'); },
}));

describe('share import', () => {
  it('lets a fault in the reader through instead of reporting it as a refused input', async () => {
    await expect(importFromRaster(new Uint8Array(16), 2, 2)).rejects.toBeInstanceOf(TypeError);
  });
});
